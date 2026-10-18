"""Read-only, segmented speed evidence; never a replacement calibration."""

from collections import Counter

import numpy as np

from .gnss_diagnostics import diagnose_speed_window
from .rpm_sync_verification import _sample


def segment_speed_checks(attempts, aim_speed, camera_speed, proposed_offset,
                         clock_offset, session_range, lap_timing, video_clock,
                         aim_position, camera_position):
    """Label held-out checks, fitting windows and gaps without discarding failures.

    The .25s/.8/40-sample/3kmh rules are the existing speed check limits.
    Missing samples are additionally made explicit, never counted as passed.
    Fitting windows cannot independently validate the offset they helped select.
    """
    offset = proposed_offset if proposed_offset is not None else clock_offset
    rows = []

    def row(start, end, role, status, reasons):
        """Attach original session/video coordinates and overlapping logger laps."""
        return {"session_range_s": [round(float(start), 3), round(float(end), 3)],
                "video_range_s": [round(float(start+offset), 3), round(float(end+offset), 3)],
                "role": role, "status": status, "reason_codes": reasons,
                "laps": [r["lap"] for r in lap_timing
                         if r["start_time_ms"]/1000 < end and r["end_time_ms"]/1000 > start]}

    cursor, end = session_range
    for attempt in attempts:
        q, match, role = attempt["query"], attempt["match"], attempt["role"]
        if q[-1] < cursor or q[0] > end:
            continue
        if q[0] > cursor:
            rows.append(row(cursor, min(q[0], end), "none", "untested", ["NOT_SAMPLED_BY_WINDOW_CHECK"]))
        a, b = max(float(q[0]), cursor), min(float(q[-1]), end)
        speed = _sample(*aim_speed, q)
        camera = _sample(*camera_speed, q+offset)
        good = np.isfinite(speed) & np.isfinite(camera)
        count = int(good.sum())
        varying = count >= 40 and np.std(speed[good]) >= 3 and np.std(camera[good]) >= 3
        correlation = float(np.corrcoef(speed[good], camera[good])[0, 1]) if varying else None
        residual = abs(match["offset_s"]-offset) if match else None
        reasons = []
        if proposed_offset is None:
            reasons.append("NO_FROZEN_FIT_OFFSET")
        if count < len(q):
            reasons.append("GPS_SAMPLE_GAPS")
        if not varying:
            reasons.append("INSUFFICIENT_SPEED_VARIATION_OR_SAMPLES")
        if not match:
            reasons.append("NO_LOCAL_MATCH")
        if reasons:
            status = "insufficient"
        else:
            if residual > .25:
                reasons.append("OFFSET_SPREAD_EXCEEDS_LIMIT")
            if match["correlation"] < .8 or correlation < .8:
                reasons.append("SPEED_CORRELATION_BELOW_LIMIT")
            if abs(offset-clock_offset) >= 1.8:
                reasons.append("SPEED_CLOCK_DISAGREEMENT")
            status = "gps_inconsistent" if reasons else ("passed" if role == "validation" else "fit_only")
        item = row(a, b, role, status, reasons)
        item.update({"sample_count": count, "query_sample_count": len(q),
                     "correlation_at_fit_offset": round(correlation, 4) if correlation is not None else None,
                     "local_best_offset_s": match["offset_s"] if match else None,
                     "local_best_correlation": match["correlation"] if match else None,
                     "offset_spread_s": round(residual, 4) if residual is not None else None})
        if status == "gps_inconsistent":
            item["diagnostic"] = diagnose_speed_window(q, aim_speed, camera_speed, offset,
                match["offset_s"], video_clock, aim_position, camera_position)
        rows.append(item)
        cursor = b
    if cursor < end:
        rows.append(row(cursor, end, "none", "untested", ["NOT_SAMPLED_BY_WINDOW_CHECK"]))
    counts = Counter(r["status"] for r in rows)
    return {"version": "gnss-segments-v1", "scope": "gps_speed_consistency_only",
            "evaluation_offset_s": round(offset, 6), "offset_applied": False,
            "residual_limit_s": .25, "correlation_minimum": .8,
            "whole_recording_verified": False, "manual_anchor_policy": "never_overwrite",
            "counts": {s: counts[s] for s in ("passed", "gps_inconsistent", "fit_only", "insufficient", "untested")},
            "segments": rows}
