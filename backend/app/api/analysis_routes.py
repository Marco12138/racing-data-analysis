"""Lap and telemetry analysis API routes."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from ..analysis.handling_analysis import generate_handling_flags
from ..analysis.lap_analysis import analyze_laps
from ..analysis.report_generator import generate_report
from ..analysis.telemetry_analysis import analyze_telemetry
from ..utils.csv_utils import CsvUploadError, read_upload_csv
from ..utils.storage import save_session_record

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("")
async def analyze_session(
    request: Request,
    lap_file: UploadFile = File(...),
    telemetry_file: UploadFile | None = File(default=None),
) -> dict:
    """Analyze uploaded lap data and optional telemetry CSV data."""
    settings = request.app.state.settings
    try:
        lap_df = await read_upload_csv(lap_file, settings.max_csv_upload_bytes)
        telemetry_df = (
            await read_upload_csv(telemetry_file, settings.max_csv_upload_bytes)
            if telemetry_file
            else None
        )
        lap_result = analyze_laps(lap_df)
        telemetry_result = analyze_telemetry(telemetry_df) if telemetry_df is not None else None
        handling_flags = generate_handling_flags(telemetry_df) if telemetry_df is not None else []
    except (CsvUploadError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    report = generate_report(lap_result, telemetry_result, handling_flags)
    session_id = save_session_record(
        lap_filename=lap_file.filename or "lap.csv",
        telemetry_filename=telemetry_file.filename if telemetry_file else None,
        report=report,
    )
    return {
        "session_id": session_id,
        "lap_analysis": lap_result,
        "telemetry_analysis": telemetry_result,
        "handling_flags": handling_flags,
        "report": report,
    }
