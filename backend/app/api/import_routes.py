"""Anonymous, temporary telemetry file import endpoints."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from ..importers.service import (
    AimImportError,
    build_import_response,
    run_xrk_conversion,
    save_limited_upload,
)

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/aim")
async def import_aim_session(
    request: Request,
    file: UploadFile = File(...),
) -> dict:
    """Temporarily parse one AiM XRK/XRZ file and return normalized data."""
    settings = request.app.state.settings
    client_key = request.client.host if request.client else "unknown"
    try:
        parser_probe = request.app.state.xrk_parser_registry.probe()
        if not parser_probe.available:
            raise AimImportError(
                parser_probe.message or "XRK parser is unavailable on this server.",
                status_code=(
                    400
                    if parser_probe.error_code == "XRK_UPLOAD_REJECTED"
                    else 503
                ),
                error_code=parser_probe.error_code or "XRK_PARSER_NOT_INSTALLED",
                error_type="parser_capability",
            )
        await request.app.state.xrk_rate_limiter.check(client_key)
        async with request.app.state.xrk_import_semaphore:
            with tempfile.TemporaryDirectory(prefix="racing-aim-import-") as temp:
                temp_dir = Path(temp)
                original_name = Path(file.filename or "session.xrk").name
                suffix = Path(original_name).suffix.lower()
                source = temp_dir / f"source{suffix}"
                output_dir = temp_dir / "output"
                size_bytes = await save_limited_upload(
                    file,
                    source,
                    settings.max_xrk_upload_bytes,
                )
                await run_xrk_conversion(
                    source,
                    output_dir,
                    settings.xrk_parse_timeout_seconds,
                )
                response = build_import_response(
                    output_dir,
                    max_telemetry_rows=settings.xrk_max_response_rows,
                )
                response["source"]["name"] = original_name
                response["source"]["size_bytes"] = size_bytes
                return response
    except AimImportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
