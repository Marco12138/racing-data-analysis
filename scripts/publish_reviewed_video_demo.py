"""Export an explicitly approved, anonymous real-session demo and short video excerpts.

Run locally, never in the web server. Original XRK/video files are not copied.
Publication approval does not imply that estimated video alignment is validated.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
from pathlib import Path

import numpy as np


def anonymize(value):
    """Remove absolute coordinates and private identifiers without changing measurements."""
    if isinstance(value, list):
        return [anonymize(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: anonymize(item) for key, item in value.items()
            if not re.search(r"gps_(lat|lon)|latitude|longitude|filename|file_path|temporary_path", key, re.I)}


def build_review(analysis: dict, gps: dict, anchor_lap: int, anchor_s: float) -> dict:
    """Use one common GPS-distance start per sector and a fixed five-second preview."""
    ranges = analysis["video_sync"]["lap_video_ranges"]
    anchor = next(row for row in ranges if row["lap"] == anchor_lap)
    offset = anchor_s - anchor["telemetry_start_s"]
    rows = analysis["top_laps_comparison"]["aligned"]
    laps = [row["lap"] for row in analysis["lap_quality"]["top_valid_laps"][:3]]
    segments = copy.deepcopy(analysis["top_lap_segments"]["segments"])
    anomalies = [row["session_range_s"] for row in gps["evidence"]["segmented_check"]["segments"]
                 if row["status"] == "gps_inconsistent"]
    clips = []
    for sector in segments:
        reference = sector["winner_laps"][0]
        available = [r for r in rows if sector["entry_m"] <= r["distance_m"] <= sector["exit_m"]
                     and r.get(f"lap_{reference}_speed") is not None]
        minimum = min(available, key=lambda r: r[f"lap_{reference}_speed"])
        # Choose a common physical start before the reference minimum; never stitch lap traces.
        start_time = minimum[f"lap_{reference}_session_time_s"] - 2.5
        start_row = min(available, key=lambda r: abs(r[f"lap_{reference}_session_time_s"] - start_time))
        distance = start_row["distance_m"]
        for lap in laps:
            valid = [r for r in rows if r.get(f"lap_{lap}_session_time_s") is not None]
            session_s = float(np.interp(distance, [r["distance_m"] for r in valid],
                                       [r[f"lap_{lap}_session_time_s"] for r in valid]))
            start_index = next(i for i, r in enumerate(rows) if r["distance_m"] >= distance)
            end_index = next((i for i, r in enumerate(rows) if i >= start_index
                              and r.get(f"lap_{lap}_session_time_s") is not None
                              and r[f"lap_{lap}_session_time_s"] >= session_s + 5), None)
            if end_index is None:
                raise ValueError("Clip ends outside available telemetry.")
            window = rows[start_index:end_index + 1]
            times = [r.get(f"lap_{lap}_session_time_s") for r in window]
            if (not times or any(t is None for t in times)
                    or np.any(np.diff(times) <= 0) or np.any(np.diff(times) > .5)
                    or valid[-1][f"lap_{lap}_session_time_s"] < session_s + 5):
                raise ValueError("Clip crosses missing or nonmonotonic telemetry; no excerpt exported.")
            stem = f"sector-{sector['number']}-lap-{lap}"
            clips.append({"sector_id": sector["id"], "lap": lap,
                          "url": f"/demo/video/{stem}.mp4", "poster": f"/demo/video/{stem}.jpg",
                          "duration_s": 5, "source_start_s": round(session_s + offset, 6),
                          "telemetry_start_s": session_s, "start_distance_m": distance,
                          "gps_warning": any(session_s - .5 < end and session_s + 5.5 > start
                                             for start, end in anomalies),
                          "alignment_status": "manual_anchor_extrapolated"})
    return {"version": 1, "anchor_lap": anchor_lap, "anchor_video_start_s": anchor_s,
            "anchor_uncertainty_s": .5, "offset_s": offset, "whole_recording_verified": False,
            "audio_removed": True, "metadata_removed": True, "segments": segments, "clips": clips}


def main() -> None:
    """Generate only approved short excerpts; require a separate visual review before release."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("analysis", "gps", "video", "ffmpeg"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--anchor-lap", type=int, required=True)
    parser.add_argument("--anchor-start", type=float, required=True)
    parser.add_argument("--approved-for-publication", action="store_true", required=True)
    parser.add_argument("--output", type=Path, default=Path("public/demo/reviewed-real-session.json"))
    args = parser.parse_args()
    analysis = json.loads(args.analysis.read_text())
    review = build_review(analysis, json.loads(args.gps.read_text()), args.anchor_lap, args.anchor_start)
    media = args.output.parent / "video"
    media.mkdir(parents=True, exist_ok=True)
    for clip in review["clips"]:
        output = media / Path(clip["url"]).name
        subprocess.run([str(args.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", str(clip["source_start_s"]), "-i", str(args.video), "-t", "5",
                        "-map", "0:v:0", "-an", "-map_metadata", "-1", "-map_chapters", "-1",
                        "-vf", "scale=960:-2,fps=30", "-c:v", "libx264", "-crf", "25",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)], check=True)
        subprocess.run([str(args.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(output), "-frames:v", "1", str(media / Path(clip["poster"]).name)], check=True)
    analysis = anonymize(analysis)
    analysis.update(inspection_id="published-demo", file_fingerprint="redacted", expires_at=None,
                    metadata={"data_source": "Anonymized real session"}, video_review=review)
    analysis["track"]["track_id"] = "anonymous-circuit"
    # Never publish free-form source metadata, cache URLs, clock epochs, or model prompts.
    text = json.dumps(analysis, ensure_ascii=False)
    if re.search(r"/Users/|martin|WSK-WUHAN|GH010681|\.xrk|\.xrz", text, re.I):
        raise ValueError("Private identifiers remain; review before publication.")
    payload = {"schema_version": 1, "provenance": {
        "dataset_kind": "anonymized_real_session", "derived_from_real_session": True,
        "publication_permission": "confirmed", "telemetry_values": "measured_or_backend_calculated_only"},
        "privacy_review": {"status": "passed", "private_identifiers_removed": True, "free_text_reviewed": True},
        "display": {"driver": "Anonymous Driver", "vehicle": "Anonymous Kart", "track": "Anonymous Circuit", "date": "Private"},
        "analysis": analysis}
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Exported {len(review['clips'])} five-second excerpts. Review frames before release.")


if __name__ == "__main__":
    main()
