"""Subprocess entrypoint for parsing one untrusted AiM logger file."""

from __future__ import annotations

import sys
from pathlib import Path

from .xrk import XrkImportError, convert_xrk_file
from .xrk_inspection import LibXrkAdapter


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
            LibXrkAdapter().inspect_and_extract(
                Path(sys.argv[1]),
                Path(sys.argv[2]),
            )
        elif mode == "convert":
            convert_xrk_file(Path(sys.argv[1]), Path(sys.argv[2]))
        else:
            print(f"Unsupported worker mode: {mode}", file=sys.stderr)
            return 2
    except XrkImportError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Unexpected XRK parser failure: {exc}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
