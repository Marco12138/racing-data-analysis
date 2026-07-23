"""Local-only video library and analysis endpoints."""

from __future__ import annotations

import csv
import io
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse

from ..analysis.video_analysis import VideoAnalysisError, analyze_video, format_timestamp
from ..core.task_dispatcher import task_dispatcher
from ..models.video import VideoJobCreate, VideoMarkerCreate
from ..utils.storage import (
    add_video_marker,
    complete_video_job,
    create_video_job,
    delete_video_job,
    delete_video_marker,
    get_video_job,
    update_video_job,
)
from ..utils.video_library import (
    VIDEO_CACHE_ROOT,
    VideoSourceError,
    delete_job_cache,
    list_video_sources,
    prepare_media,
    resolve_source,
)


def _require_local_video_mode(request: Request) -> None:
    """Reject filesystem video routes when the API runs in public cloud mode."""
    if not request.app.state.settings.local_video_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "The local video library is disabled in cloud mode. "
                "Use the future direct-upload API backed by object storage."
            ),
        )


router = APIRouter(
    prefix="/video",
    tags=["video"],
    dependencies=[Depends(_require_local_video_mode)],
)


@router.get("/library")
def video_library() -> dict:
    """List supported files inside configured local video directories."""
    return {"sources": list_video_sources()}


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
def create_job(
    payload: VideoJobCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    response: Response,
) -> dict:
    """Queue local ZIP extraction and sparse OpenCV analysis."""
    try:
        source = resolve_source(payload.source_id)
    except VideoSourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job_id = uuid.uuid4().hex
    create_video_job(job_id, payload.source_id, source.name, str(source))
    settings = request.app.state.settings
    task_dispatcher(settings, background_tasks).enqueue(_run_analysis, job_id, source)
    response.headers["Location"] = f"{settings.api_v1_prefix}/video/jobs/{job_id}"
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    """Return job progress, results, and saved timeline markers."""
    job = _require_job(job_id)
    return _public_job(job)


@router.get("/jobs/{job_id}/stream")
def stream_video(job_id: str) -> FileResponse:
    """Stream completed media with Starlette byte-range support."""
    job = _require_completed_job(job_id)
    path = _resolve_media_path(job_id, job.get("media_path"))
    if path is None:
        raise HTTPException(status_code=410, detail="The cached video is no longer available.")
    media_type = mimetypes.guess_type(path.name)[0] or "video/mp4"
    return FileResponse(path, media_type=media_type, filename=path.name, content_disposition_type="inline")


@router.get("/jobs/{job_id}/frames/{filename}")
def keyframe(job_id: str, filename: str) -> FileResponse:
    """Serve an extracted JPEG only when it belongs to the requested job."""
    job = _require_completed_job(job_id)
    allowed = {frame["filename"] for frame in job["keyframes"]}
    if filename not in allowed or Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="Keyframe not found.")
    path = VIDEO_CACHE_ROOT / job_id / "keyframes" / filename
    if not path.is_file():
        raise HTTPException(status_code=410, detail="The cached keyframe is no longer available.")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/jobs/{job_id}/markers", status_code=status.HTTP_201_CREATED)
def create_marker(job_id: str, payload: VideoMarkerCreate) -> dict:
    """Validate and save a manual lap or review marker."""
    job = _require_completed_job(job_id)
    duration = float(job["metadata"]["duration_seconds"])
    if payload.timestamp > duration:
        raise HTTPException(status_code=400, detail="Marker timestamp exceeds video duration.")
    if payload.marker_type in {"lap_start", "lap_end"} and payload.lap is None:
        raise HTTPException(status_code=400, detail="Lap markers require a lap number.")
    marker = add_video_marker(job_id, payload.marker_type, payload.timestamp, payload.lap, payload.notes.strip())
    return {"marker": marker}


@router.delete("/jobs/{job_id}/markers/{marker_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_marker(job_id: str, marker_id: int) -> Response:
    """Remove one incorrect manual marker."""
    _require_job(job_id)
    if not delete_video_marker(job_id, marker_id):
        raise HTTPException(status_code=404, detail="Marker not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/jobs/{job_id}/markers.csv")
def export_markers(job_id: str) -> StreamingResponse:
    """Export paired lap start/end markers in the documented CSV format."""
    job = _require_completed_job(job_id)
    rows = _lap_rows(job["markers"])
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["lap", "video_start_time", "video_end_time", "notes"])
    writer.writeheader()
    writer.writerows(rows)
    headers = {"Content-Disposition": f'attachment; filename="{job_id}_video_laps.csv"'}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers=headers)


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def clear_job(job_id: str) -> Response:
    """Clear one analysis record and only its extracted cache."""
    _require_job(job_id)
    delete_job_cache(job_id)
    delete_video_job(job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _run_analysis(job_id: str, source: Path) -> None:
    """Run extraction and OpenCV work outside the response lifecycle."""
    try:
        update_video_job(job_id, status="extracting", progress=15)
        media_path, warnings = prepare_media(source, job_id)
        update_video_job(job_id, status="analyzing", progress=45, media_path=str(media_path))
        result = analyze_video(media_path, VIDEO_CACHE_ROOT / job_id / "keyframes")
        if result["metadata"]["codec"].lower() in {"hevc", "hvc1", "hev1"}:
            warnings.append("HEVC playback depends on browser codec support; keyframes remain available if playback fails.")
        complete_video_job(
            job_id,
            str(media_path),
            result["metadata"],
            result["keyframes"],
            warnings,
            result["report"],
        )
    except (VideoSourceError, VideoAnalysisError, OSError) as exc:
        update_video_job(job_id, status="failed", progress=100, error=str(exc))
    except Exception as exc:  # pragma: no cover - last-resort job containment
        update_video_job(job_id, status="failed", progress=100, error=f"Unexpected video analysis error: {exc}")


def _require_job(job_id: str) -> dict:
    """Return a video job or raise a consistent 404 response."""
    job = get_video_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video analysis job not found.")
    return job


def _require_completed_job(job_id: str) -> dict:
    """Require a completed job before accessing generated assets."""
    job = _require_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Video analysis is not complete.")
    return job


def _public_job(job: dict) -> dict:
    """Remove local filesystem paths from API responses."""
    return {
        key: value
        for key, value in job.items()
        if key not in {"source_path", "media_path"}
    }


def _resolve_media_path(job_id: str, stored_path: str | None) -> Path | None:
    """Find cached media after a project directory has been moved."""
    if stored_path:
        path = Path(stored_path)
        if path.is_file():
            return path
    cache_dir = VIDEO_CACHE_ROOT / job_id
    candidates = [
        path
        for path in cache_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".mp4", ".mov"}
    ] if cache_dir.is_dir() else []
    return candidates[0] if len(candidates) == 1 else None


def _lap_rows(markers: list[dict]) -> list[dict]:
    """Pair manual lap start/end markers for CSV export."""
    laps: dict[int, dict] = {}
    for marker in markers:
        lap = marker.get("lap")
        if lap is None or marker["marker_type"] not in {"lap_start", "lap_end"}:
            continue
        row = laps.setdefault(lap, {"lap": lap, "video_start_time": "", "video_end_time": "", "notes": []})
        field = "video_start_time" if marker["marker_type"] == "lap_start" else "video_end_time"
        row[field] = format_timestamp(float(marker["timestamp"]))
        if marker.get("notes"):
            row["notes"].append(marker["notes"])
    return [
        {**row, "notes": " | ".join(row["notes"])}
        for _, row in sorted(laps.items())
    ]
