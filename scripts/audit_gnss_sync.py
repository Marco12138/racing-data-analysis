"""Check private GoPro metadata against a private XRK; no media leaves this host."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.analysis.gnss_sync import read_gnss_reference, verify_gnss_alignment
from backend.app.importers.inspection_store import InspectionRecord
from backend.app.importers.xrk_inspection import inspect_xrk_file


def native_packet_comparison(native: dict, camera: dict, reference: dict, result: dict) -> dict:
    """Check unaveraged GPS5 and packet clocks, never tune against this sample."""
    direct = verify_gnss_alignment(camera["video_clock"], native["gps"], reference)
    check = result["evidence"]["speed_check"]
    window = check.get("window_diagnostic")
    if window is None:
        return {"unaveraged_speed_check": direct["evidence"]["speed_check"], "failed_window": None}
    start, end = window["video_range_s"]
    packets = [p for p in native["packets"] if start <= p["start"] <= end]
    counts = np.array([p["count"] for p in packets])
    totals = np.array([p["TSMP"] for p in packets])
    epochs = [datetime.strptime(p["GPSU"], "%y%m%d%H%M%S.%f").replace(tzinfo=UTC).timestamp()-p["start"] for p in packets]
    samples = [p for p in native["gps"] if start <= p["time_s"] <= end]
    return {"unaveraged_speed_check": direct["evidence"]["speed_check"],
            "failed_window": {"video_range_s": [start, end], "packet_count": len(packets),
                "packet_durations_s": sorted(set(p["duration"] for p in packets)),
                "sample_count_discontinuities": int(np.sum(np.diff(totals) != counts[1:])),
                "fix_states": sorted(set(p["GPSF"] for p in packets)),
                "dop_range": [min(p["GPSP"] for p in packets)/100, max(p["GPSP"] for p in packets)/100] if packets else None,
                "clock_epoch_span_s": round(float(np.ptp(epochs)), 6) if epochs else None,
                "minimum_recorded_speed_kmh": min(p["speed_kmh"] for p in samples) if samples else None},
            "interpretation": "unaveraged_values_check_boxcar_artifacts_not_independent_sensor_truth"}


def main() -> int:
    """Write reproducible candidate evidence, not a claim of frame-level accuracy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=Path, required=True)
    parser.add_argument("--camera-native", type=Path, help="Optional private unaveraged GPS5 packet audit")
    parser.add_argument("--file", type=Path, default=os.getenv("XRK_TEST_FILE_PATH"))
    parser.add_argument("--output", type=Path, default=Path("tmp/gpmf-audit/pair"))
    parser.add_argument("--baseline-offset-s", type=float, help="Previously recorded candidate; comparison only, never ground truth")
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
        reference = read_gnss_reference(record)
        result = verify_gnss_alignment(camera["video_clock"], camera["video_gps"], reference)
        if args.camera_native:
            result["native_packet_comparison"] = native_packet_comparison(
                json.loads(args.camera_native.read_text()), camera, reference, result)
    result["camera_summary"] = camera["summary"]
    result["xrk_fingerprint"] = manifest["fingerprint"]
    if args.baseline_offset_s is not None:
        result["baseline_comparison"] = {
            "baseline_offset_s": args.baseline_offset_s,
            "difference_s": round(result["offset_ms"]/1000-args.baseline_offset_s, 6),
            "baseline_is_ground_truth": False,
            "interpretation": "different_estimators_do_not_establish_clock_drift",
        }
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    (output/"summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)+"\n")
    evidence = result["evidence"]
    lines = ["# Private GNSS synchronization audit", "", "Local evidence only. Human visual confirmation is still required.",
             f"- Status: {result['status']}", f"- Candidate offset: {result['offset_ms']/1000:.3f} s",
             f"- Clock-only offset: {evidence['clock_offset_ms']/1000:.3f} s",
             f"- Estimator diagnostics: {json.dumps(evidence['offset_diagnostics'])}",
             f"- Prior candidate comparison: {json.dumps(result.get('baseline_comparison'))}",
             "- Convention: video = telemetry session time + offset",
             f"- Held-out speed check: {json.dumps({k: v for k, v in evidence['speed_check'].items() if k != 'window_diagnostic'})}",
             f"- Failed-window diagnostic: {json.dumps({k: v for k, v in evidence['speed_check'].get('window_diagnostic', {}).items() if k != 'trace'})}",
             f"- Spatial check (no translation): {json.dumps(evidence['spatial_check'])}",
             f"- Frozen-transform holdout: {json.dumps({k: v for k, v in evidence.get('geometry_check', {}).items() if k not in {'overlay', 'windows'}})}",
             f"- Lap coverage: {json.dumps(evidence['lap_coverage'])}",
             f"- Warnings: {', '.join(evidence['reason_codes'])}",
             "- No inferred body axes, frame-accuracy guarantee, or automatic calibration overwrite."]
    segmented = evidence["segmented_check"]
    lines.extend(["", "## Segmented GPS speed consistency",
        f"- Counts: {json.dumps(segmented['counts'])}",
        f"- Evaluation offset: {segmented['evaluation_offset_s']:.3f} s (not applied)",
        "- Fitting windows are not held-out passes. Gaps and edges are untested.",
        "- No claim of whole-recording, frame-level or manual-anchor validation.", "",
        "| Session range (s) | Candidate video (s) | Laps | Role | Status | Spread (s) | Reasons |",
        "| --- | --- | --- | --- | --- | --- | --- |"])
    for row in segmented["segments"]:
        lines.append(f"| {row['session_range_s']} | {row['video_range_s']} | {row['laps']} | {row['role']} | "
                     f"{row['status']} | {row.get('offset_spread_s')} | {', '.join(row['reason_codes'])} |")
    if "native_packet_comparison" in result:
        comparison = result["native_packet_comparison"]
        lines.extend(["", "## Original GPS5 packet comparison",
            f"- Packets: {json.dumps(comparison['failed_window'])}",
            f"- Unaveraged speed validation: {json.dumps({k: v for k, v in comparison['unaveraged_speed_check'].items() if k != 'window_diagnostic'})}",
            "- Neither GPS is independent truth. A shape mismatch cannot establish a video delay or a physical sensor failure cause."])
    (output/"report.md").write_text("\n".join(lines)+"\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
