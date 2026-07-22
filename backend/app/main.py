"""FastAPI application entry point."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .analysis.lap_analysis import analyze_laps
from .analysis.telemetry_analysis import analyze_telemetry
from .analysis.handling_analysis import generate_handling_flags
from .analysis.report_generator import generate_report
from .utils.csv_utils import read_upload_csv
from .utils.storage import init_db, save_session_record

app = FastAPI(title="AI Racing Telemetry Analysis Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    """Initialize local SQLite storage."""
    init_db()


@app.get("/health")
def health() -> dict:
    """Return a basic service health check."""
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(
    lap_file: UploadFile = File(...),
    telemetry_file: UploadFile | None = File(default=None),
) -> dict:
    """Analyze uploaded lap and optional telemetry CSV files."""
    lap_df = await read_upload_csv(lap_file)
    telemetry_df = await read_upload_csv(telemetry_file) if telemetry_file else None

    lap_result = analyze_laps(lap_df)
    telemetry_result = analyze_telemetry(telemetry_df) if telemetry_df is not None else None
    handling_flags = generate_handling_flags(telemetry_df) if telemetry_df is not None else []
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

