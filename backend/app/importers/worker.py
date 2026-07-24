"""Subprocess entrypoint for parsing one untrusted AiM logger file."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .xrk import XrkImportError, convert_xrk_file
from .xrk_registry import ParserUnavailableError, XrkParserRegistry


def emit_error(
    error_code: str,
    message: str,
    *,
    status_code: int,
    error_type: str,
) -> None:
    """Write one machine-readable error object for the parent process."""
    print(
        json.dumps(
            {
                "status": "error",
                "status_code": status_code,
                "error_code": error_code,
                "message": message,
                "error_type": error_type,
            }
        ),
        file=sys.stderr,
    )


def main() -> int:
    """Convert the provided source path into the provided output directory."""
    if len(sys.argv) not in {3, 4}:
        print(
            "Usage: python -m app.importers.worker SOURCE OUTPUT_DIR [convert|inspect]",
            file=sys.stderr,
        )
        return 2
    try:
        mode = sys.argv[3] if len(sys.argv) == 4 else "convert"
        if mode == "inspect":
            registry = XrkParserRegistry(
                configured_parser=os.getenv("XRK_PARSER", "auto"),
                enabled=os.getenv("XRK_SERVER_IMPORT_ENABLED", "true").lower()
                not in {"0", "false", "no"},
            )
            registry.require_available().inspect_and_extract(
                Path(sys.argv[1]),
                Path(sys.argv[2]),
            )
        elif mode == "convert":
            convert_xrk_file(Path(sys.argv[1]), Path(sys.argv[2]))
        else:
            print(f"Unsupported worker mode: {mode}", file=sys.stderr)
            return 2
    except ParserUnavailableError as exc:
        probe = exc.probe
        emit_error(
            probe.error_code or "XRK_PARSER_NOT_INSTALLED",
            probe.message or str(exc),
            status_code=503,
            error_type="parser_capability",
        )
        return 2
    except XrkImportError as exc:
        message = str(exc)
        if "No usable numeric telemetry channels" in message:
            code, status_code, error_type = (
                "XRK_NO_CHANNELS_FOUND",
                422,
                "data_quality",
            )
        elif (
            "missing required GPS channels" in message
            or "No complete timed laps" in message
        ):
            code, status_code, error_type = (
                "XRK_NO_CHANNELS_FOUND",
                422,
                "data_quality",
            )
        elif "support is not installed" in message:
            code, status_code, error_type = (
                "XRK_PARSER_NOT_INSTALLED",
                503,
                "parser_capability",
            )
        else:
            code, status_code, error_type = "XRK_PARSE_FAILED", 400, "parser_error"
            message = "Unable to parse this XRK/XRZ file."
        emit_error(
            code,
            message,
            status_code=status_code,
            error_type=error_type,
        )
        return 2
    except Exception as exc:
        emit_error(
            "XRK_PARSE_FAILED",
            "Unexpected XRK parser failure.",
            status_code=400,
            error_type=type(exc).__name__,
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
