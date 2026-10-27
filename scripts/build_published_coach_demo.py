"""Rebuild demo evidence from the ALREADY PUBLIC, anonymized distance grid only.

Never opens a private XRK/video/cache. Uses the production spatial gates and
translation registration; publication does not imply independent video review.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.analysis.selected_corner import (  # noqa: E402
    _gate, _section, _profile, _clip_telemetry, _coach_gates, _coach_profile,
    group_corner_patterns,
)
from backend.app.analysis.track_reference import gate_crossings, register_translation  # noqa: E402
from backend.app.models.track_reference import TrackAcceptance  # noqa: E402


def build() -> dict:
    source = ROOT / "public/demo/reviewed-real-session.json"
    raw = source.read_bytes()
    resource = json.loads(raw)
    assert resource["provenance"]["publication_permission"] == "confirmed"
    analysis = resource["analysis"]
    review = analysis["video_review"]
    aligned = pd.DataFrame(analysis["top_laps_comparison"]["aligned"])
    laps = sorted({c["lap"] for c in review["clips"]})
    frames = {}
    for lap in laps:
        prefix = f"lap_{lap}_"
        frame = aligned[["distance_m"] + [c for c in aligned if c.startswith(prefix)]].rename(
            columns={c: c.removeprefix(prefix) for c in aligned if c.startswith(prefix)})
        frames[lap] = frame.dropna(subset=["session_time_s", "speed", "local_x_m", "local_y_m"]).reset_index(drop=True)
    sections = []
    for segment in review["segments"]:
        clip = next(c for c in review["clips"] if c["sector_id"] == segment["id"] and c["lap"] == review["anchor_lap"])
        frame = frames[clip["lap"]]
        # Inset the common gates so the finite, already-published excerpts cover
        # both crossings. Never generate additional private footage for the demo.
        start, end = clip["telemetry_start_s"] + .3, clip["telemetry_start_s"] + 4.7
        entry, exit_gate = _gate(frame, start), _gate(frame, end)
        checkpoints = _coach_gates(frame, start, end)
        reference = frame[["local_x_m", "local_y_m"]].to_numpy(float)
        end_distance = float(np.interp(end, frame.session_time_s, frame.distance_m))
        downstream_gate = None
        if end_distance + 50 < frame.distance_m.iloc[-1]:
            downstream_gate = _gate(frame, float(np.interp(end_distance + 50, frame.distance_m, frame.session_time_s)))
        rows, flags = [], []
        for lap in laps:
            current = frames[lap]
            media = next(c for c in review["clips"] if c["sector_id"] == segment["id"] and c["lap"] == lap)
            if media["gps_warning"]:
                flags.append(lap)
            quality = next(q for q in analysis["lap_quality"]["laps"] if q["lap"] == lap)
            row = {"lap": lap, "quality": quality, "status": "excluded", "reason": "lap_quality_gate"}
            if not quality["analysis_eligible"]:
                rows.append(row)
                continue
            points = current[["local_x_m", "local_y_m"]].to_numpy(float)
            fit = {"status": "accepted", "translation_m": [0., 0.]} if lap == clip["lap"] else register_translation(points, reference, current.distance_m.to_numpy(float), TrackAcceptance())
            if fit["status"] != "accepted":
                rows.append({**row, "reason": "gps_registration_rejected"})
                continue
            positioned = points + fit["translation_m"]
            hits = [gate_crossings(positioned, current.session_time_s.to_numpy(float), g) for g in (entry, exit_gate)]
            if any(len(h) != 1 for h in hits):
                rows.append({**row, "reason": "non_unique_or_missing_gate_crossing"})
                continue
            a, b = (start, end) if lap == clip["lap"] else [h[0]["session_time_s"] for h in hits]
            if not 0 <= a - media["telemetry_start_s"] < b - media["telemetry_start_s"] <= media["duration_s"]:
                rows.append({**row, "reason": "published_video_coverage"})
                continue
            section = _section(current, a, b)
            downstream = None
            if downstream_gate:
                following = gate_crossings(positioned, current.session_time_s.to_numpy(float), downstream_gate)
                if len(following) == 1 and 0 < following[0]["session_time_s"] - b < 15:
                    _section(current, b, following[0]["session_time_s"])
                    downstream = following[0]["session_time_s"] - b
            rows.append({**row, "status": "candidate", "reason": None,
                         "start_session_s": a, "end_session_s": b, "elapsed_s": b-a,
                         "downstream_s": downstream, "start_distance_m": float(section.distance_m.iloc[0]),
                         "end_distance_m": float(section.distance_m.iloc[-1]),
                         "profile": _profile(section), "telemetry": _clip_telemetry(section),
                         "spatial_profile": _coach_profile(current, positioned, a, b, checkpoints)})
        sections.append({"id": segment["id"], "name": f"Sector {segment['number']} · excerpt",
                         "gps_flagged_laps": flags,
                         "downstream_camera_validation": "not_available_in_published_excerpts",
                         "result": {"version": 1, "source_lap": clip["lap"], "start_session_s": start,
                                    "end_session_s": end, "context": {"status": "partial", "reason": "published_excerpt_only"},
                                    "laps": rows, "patterns": group_corner_patterns(rows, []), "synthetic_curve_generated": False}})
    return {"version": 1, "source": "/demo/reviewed-real-session.json", "source_sha256": hashlib.sha256(raw).hexdigest(),
            "sampling": "already_published_distance_grid", "manual_anchor_modified": False,
            "independent_video_validation": False, "sections": sections}


if __name__ == "__main__":
    output = ROOT / "public/demo/coach-evidence.json"
    output.write_text(json.dumps(build(), ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(output.relative_to(ROOT))
