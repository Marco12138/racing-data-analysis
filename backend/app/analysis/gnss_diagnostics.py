"""Explain failed speed matches without changing synchronization acceptance."""

from __future__ import annotations

import numpy as np

from .rpm_sync_verification import _sample


def _timing(times: np.ndarray, start: float, end: float) -> dict:
    """Describe recorded spacing; regular spacing is not hardware-clock truth."""
    t = times[(times >= start) & (times <= end)]
    dt = np.diff(t)
    return {"samples": len(t), "duplicate_count": int(np.sum(dt == 0)),
            "reversal_count": int(np.sum(dt < 0)),
            "maximum_gap_s": round(float(np.max(dt)), 6) if len(dt) else None}


def _difference(reference: np.ndarray, camera: np.ndarray, query: np.ndarray) -> dict:
    """Describe actual common samples, without a new anomaly/pass threshold."""
    good = np.isfinite(reference) & np.isfinite(camera)
    if not good.any():
        return {"sample_count": 0, "rmse_kmh": None, "max_absolute_difference_kmh": None, "peak": None}
    a, b, t = reference[good], camera[good], query[good]
    difference = b-a
    i = int(np.argmax(np.abs(difference)))
    return {"sample_count": int(good.sum()), "rmse_kmh": round(float(np.sqrt(np.mean(difference**2))), 3),
            "max_absolute_difference_kmh": round(float(abs(difference[i])), 3),
            "peak": {"session_time_s": round(float(t[i]), 3),
                     "aim_speed_kmh": round(float(a[i]), 3), "camera_speed_kmh": round(float(b[i]), 3)}}


def diagnose_speed_window(query: np.ndarray, aim_speed: tuple, camera_speed: tuple,
                          fit_offset_s: float, local_offset_s: float,
                          video_clock: list[dict], aim_position: dict, camera_position: dict) -> dict:
    """Keep the failed window intact and distinguish fit disagreement from timing error.

    Both comparisons use the same common samples. The local best match was
    optimized on this window, so its residual is descriptive, not validation.
    """
    st, ss = aim_speed
    gt, gs = camera_speed
    a = _sample(st, ss, query)
    b = _sample(gt, gs, query+fit_offset_s)
    shifted = _sample(gt, gs, query+local_offset_s)
    common = np.isfinite(a) & np.isfinite(b) & np.isfinite(shifted)
    a = np.where(common, a, np.nan)
    b = np.where(common, b, np.nan)
    shifted = np.where(common, shifted, np.nan)
    first, last = float(query[0]), float(query[-1])
    clock = [p for p in video_clock if first+fit_offset_s <= p["time_s"] <= last+fit_offset_s and p["fix"] >= 3]
    epochs = np.array([p["utc_s"]-p["time_s"] for p in clock])
    position = None
    if {"gps_lat", "gps_lon"}.issubset(aim_position) and {"lat", "lon"}.issubset(camera_position):
        lat, lon = (_sample(*aim_position[key], query) for key in ("gps_lat", "gps_lon"))
        vlat, vlon = (_sample(gt, camera_position[key], query+fit_offset_s) for key in ("lat", "lon"))
        distance = np.hypot((vlon-lon)*111320*np.cos(np.deg2rad(lat)), (vlat-lat)*111320)
        valid = distance[np.isfinite(distance)]
        if len(valid):
            position = {"sample_count": len(valid), "median_m": round(float(np.median(valid)), 3),
                        "p95_m": round(float(np.quantile(valid, .95)), 3),
                        "max_m": round(float(np.max(valid)), 3), "translation_applied": False}
    value = lambda v: round(float(v), 3) if np.isfinite(v) else None
    return {"version": "gnss-window-diagnostics-v1",
            "session_range_s": [round(first, 3), round(last, 3)],
            "video_range_s": [round(first+fit_offset_s, 3), round(last+fit_offset_s, 3)],
            "fit_offset_s": fit_offset_s, "local_best_offset_s": local_offset_s,
            "at_fit_offset": _difference(a, b, query),
            "at_local_best_offset": _difference(a, shifted, query),
            "position_at_fit_offset": position,
            "aim_sample_timing": _timing(st, first, last),
            "camera_sample_timing": _timing(gt, first+fit_offset_s, last+fit_offset_s),
            "camera_clock_samples": len(clock),
            "camera_clock_epoch_span_s": round(float(np.ptp(epochs)), 6) if len(epochs) > 1 else None,
            "offset_deviation_is_proven_timing_error": False,
            "acceptance_changed": False, "window_discarded": False,
            "interpretation": "signal_match_disagreement_not_measured_video_delay",
            "trace": [{"session_time_s": value(t), "aim_speed_kmh": value(x),
                       "camera_at_fit_kmh": value(y), "camera_at_local_best_kmh": value(z)}
                      for t, x, y, z in zip(query, a, b, shifted)]}
