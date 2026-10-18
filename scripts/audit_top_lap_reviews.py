"""Audit a private XRK locally; keep results under ignored tmp/, never publish it."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.analysis.xrk_session_analysis import analyze_xrk_session
from backend.app.importers.xrk_inspection import inspect_xrk_file


def main() -> None:
    """Reparse native input and save the exact API analysis and concise findings."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=os.getenv("XRK_TEST_FILE_PATH"))
    parser.add_argument("--output", type=Path, default=Path("tmp/top-lap-review-audit"))
    args = parser.parse_args()
    if not args.file or not args.output.resolve().is_relative_to(Path("tmp").resolve()):
        parser.error("A private --file (or XRK_TEST_FILE_PATH) and output under tmp/ are required.")
    with tempfile.TemporaryDirectory(prefix="top-lap-review-") as temp:
        manifest = inspect_xrk_file(args.file.expanduser(), Path(temp))
        analysis = analyze_xrk_session(pd.read_parquet(Path(temp)/"telemetry.parquet"), manifest, language="zh")
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    (args.output/"analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, allow_nan=False)+"\n")
    (args.output/"summary.json").write_text(json.dumps(analysis.get("top_lap_segments"), ensure_ascii=False, indent=2)+"\n")
    (args.output/"report.md").write_text(analysis["report"]+"\n")
    print(json.dumps(analysis.get("top_lap_segments"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
