#!/usr/bin/env python3
"""Private, reproducible map audit; output is ignored and never deployed."""

import argparse
from collections import Counter
from contextlib import redirect_stdout
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import sys
import tempfile

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.analysis.track_reference import create_track_reference, match_track_reference, native_gps_frame
from backend.app.importers.xrk_inspection import inspect_xrk_file
from backend.app.models.track_reference import TrackReference


def extract(path):
    """Keep input untouched; discard temporary normalized/native artifacts after use."""
    with tempfile.TemporaryDirectory(prefix="track-reference-audit-") as folder:
        with redirect_stdout(io.StringIO()):
            manifest = inspect_xrk_file(path, Path(folder))
        native = pd.read_parquet(Path(folder) / "native_channels.parquet")
        frame, processing = native_gps_frame(native, manifest)
        return frame, manifest, processing


def discover(roots):
    """Prefer XRK over its XRZ sibling and exclude macOS resource-fork files."""
    files = {}
    for root in roots:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or any(part.startswith(".") for part in path.relative_to(root).parts) or path.suffix.lower() not in {".xrk", ".xrz"}:
                continue
            key = str(path.with_suffix(""))
            if key not in files or path.suffix.lower() == ".xrk":
                files[key] = path
    return sorted(files.values())


def plot_sessions(sessions, config, output):
    """Render all accepted/rejected traces without including private driver names."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    reference = np.asarray(config.reference_path)
    for page in range(0, len(sessions), 8):
        fig, axes = plt.subplots(2, 4, figsize=(16, 10), squeeze=False)
        for axis, row in zip(axes.flat, sessions[page:page + 8]):
            axis.plot(reference[:, 0], reference[:, 1], color="#111827", linewidth=1.5, label="Reference")
            if row.get("result_file"):
                result = json.loads((output / row["result_file"]).read_text())
                for trace in result["traces"]:
                    for field, color in (("raw_xy", "#e45c79"), ("registered_xy", "#139d82")):
                        points = np.asarray(trace[field])
                        if len(points):
                            axis.plot(points[:, 0], points[:, 1], color=color, alpha=.23, linewidth=.5)
            for corner in config.corners:
                gate = corner.entry_gate
                axis.plot([gate.a[0], gate.b[0]], [gate.a[1], gate.b[1]], color="#286caf", linewidth=.8)
                axis.text(gate.b[0], gate.b[1], corner.id, fontsize=6)
            count = row.get("coverage", {})
            axis.set_title(f"{row['fingerprint'][:8]} | {count.get('geometry_accepted_laps', 0)}/{count.get('logger_laps', 0)} accepted", fontsize=10)
            axis.set_aspect("equal"); axis.set_xlabel("East (m)"); axis.set_ylabel("North (m)")
        for axis in list(axes.flat)[len(sessions[page:page + 8]):]:
            axis.set_visible(False)
        fig.suptitle("Observed geometry only | red: raw GPS | green: accepted translation | candidates NOT confirmed")
        fig.tight_layout()
        fig.savefig(output / f"map_audit_{page // 8 + 1}.png", dpi=130)
        plt.close(fig)


def main():
    """Generate a private draft plus per-file gate, quality and registration results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=os.getenv("XRK_TEST_FILE_PATH"))
    parser.add_argument("--lap", type=int, default=13)
    parser.add_argument("--data-dir", type=Path, action="append", default=[])
    parser.add_argument("--config", type=Path)
    parser.add_argument("--plot", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/track_reference_audit")
    args = parser.parse_args()
    roots = args.data_dir or [Path(os.getenv("XRK_TEST_DATA_DIR", Path.home() / "racing数据"))]
    if args.config:
        config = TrackReference.model_validate_json(args.config.read_text())
    else:
        if not args.reference:
            parser.error("Set --reference or XRK_TEST_FILE_PATH; no private sample is bundled.")
        gps, manifest, _ = extract(args.reference)
        config = create_track_reference(gps, manifest, args.lap, track_id="wuhan-observed-v1", aliases=["WUHAN", "WSK-WUHAN", "WSK-WH"])
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "track_config.json").write_text(config.model_dump_json(indent=2), encoding="utf-8")
    sessions, seen = [], set()
    for path in discover(roots):
        digest = sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        try:
            gps, manifest, processing = extract(path)
            result = match_track_reference(gps, manifest, config)
            result["native_processing"] = processing
            name = f"{digest[:16]}.json"
            (args.output / name).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            registrations = [r["registration"] for r in result["laps"] if r.get("registration", {}).get("status") == "accepted"]
            row = {"file": str(path), "fingerprint": digest, "status": result["status"], "coverage": result["coverage"], "result_file": name,
                   "held_out_p95_max_m": max((r["holdout_p95_m"] for r in registrations), default=None),
                   "native_lap_segments": result["native_lap_segments"],
                   "importer_excluded_laps": result["importer_excluded_laps"],
                   "rejection_reasons": dict(Counter(reason for lap in result["laps"] for reason in lap["reasons"])),
                   "phase_coverage": result["gate_phases"].get("coverage", {}),
                   "manual_confirmation_required": result["manual_confirmation_required"]}
        except Exception as exc:
            row = {"file": str(path), "fingerprint": digest, "status": "failed", "reason": str(exc)}
        row["original_unchanged"] = sha256(path.read_bytes()).hexdigest() == digest
        sessions.append(row)
        print(path.name, row.get("coverage", row["status"]), flush=True)
    summary = {"track_config": "track_config.json", "sessions": sessions, "file_count": len(sessions),
               "totals": dict(sum((Counter({k: v for k, v in row.get("coverage", {}).items() if isinstance(v, int)}) for row in sessions), Counter())),
               "phase_totals": dict(sum((Counter(row.get("phase_coverage", {})) for row in sessions), Counter())),
               "manually_validated": False, "same_line_lap_time_equality_required": False,
               "limits": ["Thresholds are provisional; test failures are retained, not tuned away.",
                          "Per-lap translation cannot independently separate GPS drift from driving lines.",
                          "Curvature candidates are not coach-confirmed corners.", "Raw files were not modified or uploaded."]}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Private Fixed Track Reference Audit", "", "Unconfirmed geometry prototype. Not a coaching or training-label dataset.", "",
             "| File | Logger laps | Geometry accepted | Platform laps | Gate pairs once / total |", "| --- | ---: | ---: | ---: | ---: |"]
    for row in sessions:
        c = row.get("coverage", {})
        lines.append(f"| {Path(row['file']).name} | {c.get('logger_laps', '-')} | {c.get('geometry_accepted_laps', '-')} | {c.get('platform_laps', '-')} | {c.get('exactly_once_gate_lap_pairs', '-')} / {c.get('gate_lap_pairs', '-')} |")
    # The proportion is not additive, and rejected laps are not in its denominator.
    summary["totals"].pop("exactly_once_ratio", None)
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines += ["", "## Scope and exclusions", "", *summary["limits"], "",
              "Gate coverage is conditional on accepted geometry, not all raw lap segments. Importer exclusions and registration rejections are retained per file.",
              "Original logger durations are retained. A shifted gate changes interval endpoints and can change each lap duration.",
              "The timing partition identity is arithmetic consistency, not independent proof of 0.05s accuracy.", "",
              "## Bounded phase detection", "", json.dumps(summary["phase_totals"]), "",
              "Missing phases are not filled. Curvature candidates may end before recovery/exit; grouping and gates require human review."]
    (args.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if args.plot:
        plot_sessions(sessions, config, args.output)


if __name__ == "__main__":
    main()
