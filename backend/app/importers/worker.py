"""Subprocess entrypoint for parsing one untrusted AiM logger file."""

from __future__ import annotations

import sys
from pathlib import Path

from .xrk import XrkImportError, convert_xrk_file


def main() -> int:
    """Convert the provided source path into the provided output directory."""
    if len(sys.argv) != 3:
        print("Usage: python -m app.importers.worker SOURCE OUTPUT_DIR", file=sys.stderr)
        return 2
    try:
        convert_xrk_file(Path(sys.argv[1]), Path(sys.argv[2]))
    except XrkImportError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Unexpected XRK parser failure: {exc}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
