"""GPS kinematic phases and lap-level uncertainty; never pedal/steering labels."""

from typing import Any

import numpy as np
import pandas as pd


def first_sustained(mask: np.ndarray, time: np.ndarray, duration_s: float) -> int | None:
    """Find a continuous observed run, not isolated derivative noise."""
    indexes = np.flatnonzero(mask)
    for run in np.split(indexes, np.flatnonzero(np.diff(indexes) > 1) + 1):
        if len(run) and time[run[-1]] - time[run[0]] >= duration_s:
            return int(run[0])
    return None


def segment_corner_phases(frame: pd.DataFrame, zone: dict[str, Any]) -> dict[str, Any]:
    """Identify speed/curvature phases on one observed lap, with explicit gaps."""
    base = {"zone_id": zone["id"], "lap": int(frame.lap.iloc[0]) if not frame.empty and "lap" in frame else None,
            "status": "unavailable", "events": {},
            "confidence": "low", "source": ["GPS speed", "GPS trajectory curvature"],
            "driver_input_confirmed": False}
    required = {"distance_m", "lap_time_s", "speed", "curvature", "lap"}
    if not required.issubset(frame.columns):
        return {**base, "reason": "missing_speed_curvature_or_time"}
    ordered = frame.sort_values("lap_time_s")
    entry, exit_distance = float(zone["entry_distance_m"]), float(zone["exit_distance_m"])
    window = ordered[ordered.distance_m.between(entry - 30, exit_distance + 30)]
    if len(window) < 7:
        return {**base, "reason": "insufficient_samples"}
    values = window[list(required)].apply(pd.to_numeric, errors="coerce")
    if not np.isfinite(values.to_numpy()).all():
        return {**base, "reason": "missing_values_in_corner_window"}
    time = window.lap_time_s.to_numpy(dtype=float)
    distance = window.distance_m.to_numpy(dtype=float)
    dt = np.diff(time)
    if np.any(dt <= 0) or np.max(dt) > max(.5, 5 * np.median(dt)) or np.any(np.diff(distance) <= 0):
        return {**base, "reason": "nonmonotonic_or_gapped_window"}
    if distance[0] > entry or distance[-1] < exit_distance:
        return {**base, "reason": "incomplete_zone_coverage"}
    speed = window.speed.to_numpy(dtype=float)
    smooth = pd.Series(speed).rolling(5, center=True, min_periods=1).median().to_numpy()
    curvature = window.curvature.abs().rolling(5, center=True, min_periods=1).median().to_numpy()
    acceleration = np.gradient(smooth / 3.6, time)
    inside = np.flatnonzero((distance >= entry) & (distance <= exit_distance))
    if len(inside) < 3:
        return {**base, "reason": "insufficient_zone_samples"}
    minimum = int(inside[np.argmin(smooth[inside])])
    peak = float(curvature[inside].max())
    if peak < 1e-4:
        return {**base, "reason": "no_resolved_curvature"}
    threshold = max(.3, float(np.quantile(np.abs(acceleration), .6)))
    curve_threshold = max(1e-4, .35 * peak)
    indexes = np.arange(len(time))
    duration = max(.15, 2 * float(np.median(dt)))
    deceleration = first_sustained((acceleration < -threshold) & (indexes < minimum), time, duration)
    turning = first_sustained((curvature > curve_threshold) & (indexes <= minimum), time, duration)
    recovery = first_sustained((acceleration > threshold) & (indexes > minimum), time, duration)
    exit_point = first_sustained((curvature < curve_threshold) & (indexes > max(minimum, recovery or minimum)), time, duration)
    events = {}
    for name, index in (("deceleration_onset", deceleration), ("curvature_build_up", turning),
                        ("minimum_speed", minimum), ("acceleration_onset", recovery), ("corner_exit", exit_point)):
        events[name] = None if index is None else {
            "lap_time_s": float(time[index]), "distance_m": float(distance[index]),
            "speed_kmh": float(speed[index]), "curvature_per_m": float(curvature[index]),
            "speed_derivative_mps2": float(acceleration[index]), "confidence": "low",
        }
    metrics = {
        "entry_speed_kmh": float(np.interp(entry, distance, speed)),
        "minimum_speed_kmh": float(np.min(speed[inside])),
        "exit_speed_kmh": float(np.interp(exit_distance, distance, speed)),
        "elapsed_time_s": float(np.interp(exit_distance, distance, time) - np.interp(entry, distance, time)),
    }
    return {**base, "status": "calculated", "lap": int(window.lap.iloc[0]), "events": events, "metrics": metrics,
            "complete": all(value is not None for value in events.values()),
            "missing_phases": [key for key, value in events.items() if value is None],
            "method": "5-sample median; real-time gradient; sustained speed/curvature thresholds; +/-30m context",
            "thresholds": {"acceleration_mps2": threshold, "curvature_per_m": curve_threshold, "duration_s": duration},
            "median_sample_interval_s": float(np.median(dt)), "manually_validated": False}


def lap_repeatability(values: list[float]) -> dict[str, Any]:
    """Summarize one observation per lap, not thousands of pseudo-replicates."""
    array = np.asarray(values, dtype=float)
    array = array[np.isfinite(array)]
    result = {"lap_count": len(array), "mean": float(np.mean(array)) if len(array) else None,
              "std": float(np.std(array, ddof=1)) if len(array) > 1 else None,
              "mean_ci95": None, "pair_difference_band95": None, "confidence": "low",
              "sensor_noise_estimated": False, "ci_method": "moving_block_bootstrap_lap_means_block2_1000_seed0",
              "limitations": "Within-session descriptive repeatability; selection, drift and driver variation remain; not sensor accuracy or a causal effect."}
    if len(array) < 5:
        return {**result, "status": "insufficient_laps"}
    rng = np.random.default_rng(0)
    starts = rng.integers(0, len(array)-1, size=(1000, (len(array)+1)//2))
    samples = np.stack((array[starts], array[starts+1]), axis=-1).reshape(1000, -1)[:, :len(array)]
    differences = np.abs(array[:, None] - array[None, :])[np.triu_indices(len(array), 1)]
    return {**result, "status": "calculated", "mean_ci95": np.quantile(samples.mean(axis=1), [.025, .975]).tolist(),
            "pair_difference_band95": float(np.quantile(differences, .95))}


def analyze_corner_dynamics(telemetry: pd.DataFrame, zones: list[dict[str, Any]],
                            eligible_laps: list[int], reference_lap: int, target_lap: int) -> dict[str, Any]:
    """Use all eligible real laps; keep single-pair effects separate from CIs."""
    by_lap = {int(lap): frame for lap, frame in telemetry.groupby("lap") if int(lap) in eligible_laps}
    corners = []
    for zone in zones:
        phases = [segment_corner_phases(by_lap[lap], zone) for lap in sorted(by_lap)]
        valid = {row["lap"]: row for row in phases if row["status"] == "calculated"}
        comparisons = {}
        for metric in ("entry_speed_kmh", "minimum_speed_kmh", "exit_speed_kmh", "elapsed_time_s"):
            stats = lap_repeatability([row["metrics"][metric] for row in valid.values()])
            delta = valid[target_lap]["metrics"][metric] - valid[reference_lap]["metrics"][metric] if {reference_lap, target_lap}.issubset(valid) else None
            band = stats["pair_difference_band95"]
            comparisons[metric] = {"target_minus_reference": delta, "repeatability": stats,
                "outside_observed_repeatability_band": abs(delta) > band if delta is not None and band is not None else None,
                "distinguishable_from_sensor_noise": None, "reason": "independent_sensor_noise_bound_unavailable",
                "pair_effect_ci95": None}
        corners.append({"zone_id": zone["id"], "name": zone.get("name", str(zone["id"])),
                        "phases": phases, "comparisons": comparisons})
    calculated = [p for c in corners for p in c["phases"] if p["status"] == "calculated"]
    return {"status": "calculated" if calculated else "unavailable", "corners": corners,
            "eligible_laps": sorted(by_lap), "reference_lap": reference_lap, "target_lap": target_lap,
            "coverage": {"attempted_lap_zones": len(zones)*len(by_lap), "calculated_lap_zones": len(calculated),
                         "complete_five_phase_lap_zones": sum(p["complete"] for p in calculated)},
            "sensor_noise_bound_kmh": None, "default_035_kmh_applied": False,
            "synthetic_curve_generated": False, "driver_input_confirmed": False}
