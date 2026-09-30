"""Check private GoPro metadata against a private XRK; no media leaves this host."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.analysis.gnss_sync import read_gnss_reference, verify_gnss_alignment
from backend.app.importers.inspection_store import InspectionRecord
from backend.app.importers.xrk_inspection import inspect_xrk_file


def main() -> int:
    """Write reproducible candidate evidence, not a claim of frame-level accuracy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=Path, required=True)
    parser.add_argument("--file", type=Path, default=os.getenv("XRK_TEST_FILE_PATH"))
    parser.add_argument("--output", type=Path, default=Path("tmp/gpmf-audit/pair"))
    args = parser.parse_args()
    if not args.file:
        parser.error("Use --file or XRK_TEST_FILE_PATH for a private XRK.")
    output = args.output.resolve()
    if not output.is_relative_to(Path("tmp").resolve()):
        parser.error("Output must stay under ignored tmp/.")
    camera = json.loads(args.camera.read_text())
    with tempfile.TemporaryDirectory(prefix="gnss-audit-") as temp:
        directory = Path(temp)
        manifest = inspect_xrk_file(args.file.expanduser(), directory)
        record = InspectionRecord("local-audit", directory, manifest, datetime.now(UTC)+timedelta(minutes=30))
        result = verify_gnss_alignment(camera["video_clock"], camera["video_gps"], read_gnss_reference(record))
    result["camera_summary"] = camera["summary"]
    result["xrk_fingerprint"] = manifest["fingerprint"]
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    (output/"summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)+"\n")
    evidence = result["evidence"]
    lines = ["# Private GNSS synchronization audit", "", "Local evidence only. Human visual confirmation is still required.",
             f"- Status: {result['status']}", f"- Candidate offset: {result['offset_ms']/1000:.3f} s",
             f"- Clock-only offset: {evidence['clock_offset_ms']/1000:.3f} s",
             "- Convention: video = telemetry session time + offset",
             f"- Held-out speed check: {json.dumps(evidence['speed_check'])}",
             f"- Spatial check (no translation): {json.dumps(evidence['spatial_check'])}",
             f"- Lap coverage: {json.dumps(evidence['lap_coverage'])}",
             f"- Warnings: {', '.join(evidence['reason_codes'])}",
             "- No inferred body axes, frame-accuracy guarantee, or automatic calibration overwrite."]
    (output/"report.md").write_text("\n".join(lines)+"\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
