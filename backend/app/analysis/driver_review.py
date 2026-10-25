"""Two-driver review using real lap timing and shared directed spatial gates."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .cross_session_analysis import prepare_session, track_compatibility_warnings
from .selected_corner import _gate, _profile, _section
from .sector_zone_analysis import generate_auto_zones
from .review_context import review_context, verify_section_path
from .track_reference import gate_crossings, register_translation
from .xrk_session_analysis import dataframe_records, json_safe
from ..models.track_reference import TrackAcceptance


def fastest_five_summary(quality: dict) -> dict:
    """Describe the selected fastest-five population; never pad an incomplete set."""
    eligible = sorted((r for r in quality["laps"] if r["analysis_eligible"]),
                      key=lambda r: (r["lap_time"], r["lap"]))
    rows = eligible[:5]
    return {"laps": rows, "count": len(rows), "required_count": 5,
            "fastest": rows[0] if rows else None,
            "variance_s2": float(np.var([r["lap_time"] for r in rows])) if len(rows) == 5 else None,
            "method": "population_variance_of_five_fastest_quality_gated_laps_ddof0",
            "status": "calculated" if len(rows) == 5 else "fewer_than_five_valid_laps",
            "interpretation": "Descriptive selected-lap dispersion, not sensor noise or overall consistency."}


def _lap(session, requested: int | None) -> tuple[int, pd.DataFrame, dict]:
    """Allow any eligible real lap, not only the existing Top-3 shortlist."""
    rows = sorted((r for r in session.quality["laps"] if r["analysis_eligible"]), key=lambda r: r["lap_time"])
    if not rows:
        raise ValueError("No lap passed the Lap Quality Gate.")
    lap = rows[0]["lap"] if requested is None else requested
    if lap not in {r["lap"] for r in rows}:
        raise ValueError("The selected lap did not pass the Lap Quality Gate.")
    frame = session.processed[session.processed.lap == lap].reset_index(drop=True) if not session.processed.empty else pd.DataFrame()
    timing = next(r for r in session.manifest["lap_timing"] if r["lap"] == lap)
    return lap, frame, timing


def _observations(session, frame: pd.DataFrame, lap: int, start: float, end: float) -> dict:
    """Observed gate metrics and existing signal events, never confirmed pedal inputs."""
    profile = _profile(_section(frame, start, end))
    events = []
    for event in session.events:
        time = event.get("session_time_s")
        if event.get("lap") == lap and time is not None and start <= time <= end:
            events.append({"type": event["event_type"], "from_entry_s": time - start,
                           "confidence": event.get("confidence"), "evidence": event.get("evidence", {})})
    return {"start_session_s": start, "end_session_s": end, "elapsed_s": end - start,
            "metrics": profile["metrics"], "profile": profile, "events": events,
            "driver_input_confirmed": False}


def build_driver_review(telemetry_a: pd.DataFrame, manifest_a: dict, telemetry_b: pd.DataFrame,
                        manifest_b: dict, *, lap_a: int | None = None, lap_b: int | None = None,
                        source_start_s: float | None = None, include_context: bool = False) -> dict:
    """Build a linked review without assuming logger timing lines or sector IDs agree."""
    a, b = prepare_session(telemetry_a, manifest_a), prepare_session(telemetry_b, manifest_b)
    warnings = track_compatibility_warnings(a, b, reject_large_difference=True)
    la, fa, ta = _lap(a, lap_a)
    lb, fb, tb = _lap(b, lap_b)
    response = {"version": 1, "sessions": {}, "corners": [], "warnings": warnings,
                "registration": None, "synthetic_curve_generated": False,
                "confidence": "low", "visual_confirmation_required": True}
    columns = ["session_time_s", "lap_time_s", "distance_m", "local_x_m", "local_y_m", "speed", "rpm"]
    for key, session, lap, frame, timing in [("a", a, la, fa, ta), ("b", b, lb, fb, tb)]:
        response["sessions"][key] = {"metadata": session.manifest.get("metadata", {}),
            "file_fingerprint": session.manifest.get("fingerprint"),
            "selected_lap": lap, "timing": timing, "lap_quality": session.quality,
            "fastest_five": fastest_five_summary(session.quality),
            "track": dataframe_records(frame[[c for c in columns if c in frame]]) if not frame.empty else [],
            "channel_provenance": session.manifest.get("channel_provenance", {}), "gps_quality": session.gps_quality}
    if fa.empty or fb.empty:
        response["warnings"].append("GPS unavailable: shared corner review is unavailable; real lap timing is retained.")
        return json_safe(response)
    if any(s.manifest.get("channel_provenance", {}).get("speed", {}).get("source") != "gps_receiver" for s in (a, b)):
        response["warnings"].append("GPS speed provenance unavailable: shared corner metrics were not calculated.")
        return json_safe(response)
    points_a, points_b = [f[["local_x_m", "local_y_m"]].to_numpy(float) for f in (fa, fb)]
    registration = register_translation(points_b, points_a, fb.distance_m.to_numpy(float), TrackAcceptance())
    response["registration"] = registration
    if registration["status"] != "accepted":
        response["warnings"].append("GPS registration failed its unchanged quality gates. Choose another real lap or review video manually.")
        return json_safe(response)
    points_b = points_b + registration["translation_m"]
    if source_start_s is None:
        zones = generate_auto_zones(fa)
        starts = [(str(z["id"]), float(np.interp(z["entry_distance_m"], fa.distance_m, fa.session_time_s))) for z in zones]
    else:
        starts = [("custom", source_start_s)]
    for key, start in starts:
        end = start + 5
        row = {"id": key, "status": "unavailable", "source": "custom" if source_start_s is not None else "suggested",
               "visual_confirmation_required": True}
        try:
            if include_context:
                context = review_context(fa, start, end)
                row["context"] = context
                start, end = context["start_session_s"], context["end_session_s"]
            obs_a = _observations(a, fa, la, start, end)
            gates = [_gate(fa, t) for t in (start, end)]
            hits = [gate_crossings(points_b, fb.session_time_s.to_numpy(float), g) for g in gates]
            if any(len(h) != 1 for h in hits):
                raise ValueError("non_unique_or_missing_directed_gate_crossing")
            sb, eb = [h[0]["session_time_s"] for h in hits]
            if not 1 <= eb - sb <= 15:
                raise ValueError("gate_order_or_duration")
            obs_b = _observations(b, fb, lb, sb, eb)
            row["path_check"] = verify_section_path(points_a[fa.session_time_s.between(start, end)],
                                                     points_b[fb.session_time_s.between(sb, eb)])
            # Both metrics and full-context playback use the same physical gates.
            row.update(status="candidate", a=obs_a, b=obs_b, gates=[g.model_dump() for g in gates],
                       difference_s=obs_b["elapsed_s"] - obs_a["elapsed_s"],
                       boundary_brackets_s=[h[0]["sample_bracket_s"] for h in hits],
                       differences={k: obs_b["metrics"][k] - v if v is not None and obs_b["metrics"][k] is not None else None
                                    for k, v in obs_a["metrics"].items()})
        except ValueError as exc:
            row["reason"] = str(exc)
        response["corners"].append(row)
    if source_start_s is None:
        candidates = sorted((r for r in response["corners"] if r["status"] == "candidate"), key=lambda r: -abs(r["difference_s"]))
        response["corners"] = candidates[:3] + [r for r in response["corners"] if r["status"] != "candidate"][:3]
    response["limitations"] = [
        "Matched GPS gates are provisional, not official corner labels; confirm the same landmark in both videos.",
        "The five-second selection is a seed; expanded playback and timing use the same physical gates.",
        "GPS-derived lateral acceleration and uncalibrated camera axes do not establish steering input.",
        "RPM decline is not confirmed braking. Higher RPM does not establish causally better exit performance.",
        "Different vehicles, gearing, tyres, weather, traffic and session conditions confound driver comparisons.",
    ]
    return json_safe(response)
