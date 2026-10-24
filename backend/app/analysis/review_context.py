"""Bounded video context selection, independent of lap-quality and consensus rules."""

import numpy as np
import pandas as pd
from ..models.track_reference import TrackAcceptance


def verify_section_path(a: np.ndarray, b: np.ndarray) -> dict:
    """Check the whole open path, not merely two gates or a closed-path shortcut."""
    if min(len(a), len(b)) < 3 or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("corner_path_unavailable")
    def residual(points, line):
        # Downsample only geometry for bounded memory; no signal values are interpolated.
        points = points[::max(1, len(points) // 400)]
        start, vec = line[:-1], np.diff(line, axis=0)
        delta = points[:, None, :] - start[None, :, :]
        fraction = np.clip(np.sum(delta * vec, axis=2) / np.maximum(np.sum(vec * vec, axis=1), 1e-12), 0, 1)
        return np.min(np.linalg.norm(delta - fraction[:, :, None] * vec, axis=2), axis=1)
    errors = np.r_[residual(a, b), residual(b, a)]
    median, p95 = float(np.median(errors)), float(np.quantile(errors, .95))
    limits = TrackAcceptance()
    if median >= limits.median_residual_m or p95 >= limits.p95_residual_m:
        raise ValueError("corner_path_gps_inconsistent")
    return {"status": "candidate", "median_m": median, "p95_m": p95,
            "method": "bidirectional_open_polyline_residual", "visual_confirmation_required": True}


def review_context(frame: pd.DataFrame, start: float, end: float) -> dict:
    """Expand a five-second seed to observed approach and recovery, never pedal truth."""
    base = {"seed_start_s": start, "seed_end_s": end, "start_session_s": start,
            "end_session_s": end, "status": "partial", "driver_input_confirmed": False,
            "method": "bounded_speed_peak_to_recovery_context_v1"}
    window = frame[frame.session_time_s.between(start - 4, end + 4)]
    if len(window) < 10 or "speed" not in window:
        return {**base, "reason": "insufficient_context"}
    t = window.session_time_s.to_numpy(float)
    v = window.speed.rolling(5, center=True, min_periods=1).median().to_numpy(float)
    if not np.isfinite(v).all() or np.any(np.diff(t) <= 0) or np.max(np.diff(t)) > .5:
        return {**base, "reason": "context_timing_or_speed_gap"}
    inside = np.flatnonzero((t >= start) & (t <= end))
    if len(inside) < 3:
        return {**base, "reason": "seed_outside_lap"}
    minimum = int(inside[np.argmin(v[inside])])
    before = np.flatnonzero((t < t[minimum]) & (t >= start - 4))
    after = np.flatnonzero(t > max(t[minimum], end))
    if not len(before) or not len(after):
        return {**base, "reason": "approach_or_exit_not_observed"}
    # The last approach maximum avoids extending into a preceding slowing event.
    peak = float(v[before].max())
    entry = int(before[np.flatnonzero(v[before] >= peak - .1)[-1]])
    exit_index = int(after[np.argmax(v[after])])
    if peak - v[minimum] < 3 or v[exit_index] - v[minimum] < 3:
        return {**base, "reason": "deceleration_or_recovery_unresolved"}
    bounded = entry < 2 or exit_index >= len(window) - 2
    return {**base, "status": "partial" if bounded else "expanded",
            "reason": "context_boundary_truncated" if bounded else "kinematic_context_not_confirmed_braking",
            "start_session_s": float(min(start, t[max(0, entry - 2)])),
            "end_session_s": float(max(end, t[exit_index])),
            "minimum_speed_session_s": float(t[minimum]),
            "approach_peak_session_s": float(t[entry]), "recovery_session_s": float(t[exit_index])}
