"""GPS kinematic phases and lap-level uncertainty; never pedal/steering labels."""

from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import t as student_t


def first_sustained(mask: np.ndarray, time: np.ndarray, duration_s: float) -> int | None:
    """Find a continuous observed run, not isolated derivative noise."""
    indexes = np.flatnonzero(mask)
    for run in np.split(indexes, np.flatnonzero(np.diff(indexes) > 1) + 1):
        if len(run) and time[run[-1]] - time[run[0]] >= duration_s:
            return int(run[0])
    return None


def _prepare_corner(frame: pd.DataFrame, zone: dict[str, Any]) -> dict[str, Any]:
    """Validate the observed window before either calibration or detection."""
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
    return {**base, "status": "prepared", "time": time, "distance": distance,
            "speed": speed, "smooth": smooth, "curvature": curvature,
            "acceleration": acceleration, "inside": inside, "minimum": minimum,
            "median_sample_interval_s": float(np.median(dt))}


def fit_zone_thresholds(by_lap: dict[int, pd.DataFrame], zone: dict[str, Any]) -> dict[str, Any]:
    """Freeze detector thresholds on an internal median profile, never a reference lap."""
    prepared = {lap: _prepare_corner(frame, zone) for lap, frame in sorted(by_lap.items())}
    valid = {lap: row for lap, row in prepared.items() if row["status"] == "prepared"}
    base = {"status": "unavailable", "source_laps": list(valid),
            "method": "session_zone_median_distance_profiles_v_dv_dd",
            "profile_usage": "detector_calibration_only_not_a_reference_lap"}
    if not valid:
        return {**base, "reason": "no_valid_calibration_windows"}
    start = max(row["distance"][0] for row in valid.values())
    end = min(row["distance"][-1] for row in valid.values())
    grid = np.arange(start, end, 1.0)
    if len(grid) < 7:
        return {**base, "reason": "insufficient_common_calibration_distance"}
    speed = np.median([np.interp(grid, row["distance"], row["smooth"]) for row in valid.values()], axis=0) / 3.6
    curvature = np.median([np.interp(grid, row["distance"], row["curvature"]) for row in valid.values()], axis=0)
    inside = (grid >= zone["entry_distance_m"]) & (grid <= zone["exit_distance_m"])
    if not inside.any() or curvature[inside].max() < 1e-4:
        return {**base, "reason": "no_resolved_median_curvature"}
    acceleration = speed * np.gradient(speed, grid)
    return {**base, "status": "calculated", "distance_step_m": 1.0,
            "thresholds": {"acceleration_mps2": max(.3, float(np.quantile(np.abs(acceleration), .6))),
                           "curvature_per_m": max(1e-4, .35 * float(curvature[inside].max())),
                           "duration_s": max(.15, 2 * float(np.median([row["median_sample_interval_s"] for row in valid.values()])))} }


def segment_corner_phases(frame: pd.DataFrame, zone: dict[str, Any],
                          calibration: dict[str, Any] | None = None) -> dict[str, Any]:
    """Apply one frozen zone calibration to each real lap; never refit per lap."""
    prepared = _prepare_corner(frame, zone)
    if prepared["status"] != "prepared":
        return prepared
    base = {key: prepared[key] for key in ("zone_id", "lap", "confidence", "source", "driver_input_confirmed")}
    if calibration is None or calibration.get("status") != "calculated":
        return {**base, "status": "unavailable", "events": {}, "reason": "zone_thresholds_unavailable"}
    time, distance, speed, smooth, curvature, acceleration = (
        prepared[key] for key in ("time", "distance", "speed", "smooth", "curvature", "acceleration"))
    minimum = prepared["minimum"]
    entry, exit_distance = float(zone["entry_distance_m"]), float(zone["exit_distance_m"])
    threshold = calibration["thresholds"]["acceleration_mps2"]
    curve_threshold = calibration["thresholds"]["curvature_per_m"]
    duration = calibration["thresholds"]["duration_s"]
    indexes = np.arange(len(time))
    deceleration = first_sustained((acceleration < -threshold) & (indexes < minimum), time, duration)
    turning = first_sustained((curvature > curve_threshold) & (indexes <= minimum), time, duration)
    recovery = first_sustained((acceleration > threshold) & (indexes > minimum), time, duration)
    exit_point = first_sustained((curvature < curve_threshold) & (indexes > max(minimum, recovery or minimum)), time, duration)
    events = {}
    for name, index in (("deceleration_onset", deceleration), ("curvature_build_up", turning),
                        ("minimum_speed", minimum), ("acceleration_onset", recovery), ("corner_exit", exit_point)):
        events[name] = None if index is None else {
            "lap_time_s": float(time[index]), "distance_m": float(distance[index]),
            "speed_kmh": float(smooth[index]), "raw_speed_kmh": float(speed[index]),
            "curvature_per_m": float(curvature[index]),
            "speed_derivative_mps2": float(acceleration[index]), "confidence": "low",
        }
    metrics = {
        "entry_speed_kmh": float(np.interp(entry, distance, speed)),
        "minimum_speed_kmh": float(smooth[minimum]),
        "exit_speed_kmh": float(np.interp(exit_distance, distance, speed)),
        "elapsed_time_s": float(np.interp(exit_distance, distance, time) - np.interp(entry, distance, time)),
    }
    return {**base, "status": "calculated", "events": events, "metrics": metrics,
            "complete": all(value is not None for value in events.values()),
            "missing_phases": [key for key, value in events.items() if value is None],
            "method": "5-sample median; real-time gradient; frozen session-zone thresholds; +/-30m context; minimum metric/event use smoothed speed",
            "thresholds": {"acceleration_mps2": threshold, "curvature_per_m": curve_threshold, "duration_s": duration},
            "calibration_source_laps": calibration["source_laps"],
            "median_sample_interval_s": prepared["median_sample_interval_s"], "manually_validated": False}


def lap_repeatability(values: list[float]) -> dict[str, Any]:
    """Summarize one observation per lap, not thousands of pseudo-replicates."""
    array = np.asarray(values, dtype=float)
    array = array[np.isfinite(array)]
    result = {"lap_count": len(array), "mean": float(np.mean(array)) if len(array) else None,
              "std": float(np.std(array, ddof=1)) if len(array) > 1 else None,
              "mean_ci95": None, "pair_difference_band95": None, "confidence": "low",
              "sensor_noise_estimated": False, "ci_method": "student_t_iid_mean",
              "ci_assumptions": "Independent, identically distributed normal lap metrics; nominal 95% coverage is conditional on these assumptions.",
              "limitations": "Serial correlation, lap selection and drift can cause undercoverage; not corrected here. Not sensor accuracy, a causal effect or a single-pair interval."}
    if len(array) < 5:
        return {**result, "status": "insufficient_laps"}
    margin = float(student_t.ppf(.975, len(array)-1) * result["std"] / np.sqrt(len(array)))
    return {**result, "status": "calculated", "mean_ci95": [result["mean"] - margin, result["mean"] + margin]}


def leave_two_out_band(values: dict[int, float], reference_lap: int, target_lap: int) -> dict[str, Any]:
    """Build a descriptive background excluding both selected laps, not a significance test."""
    background = {lap: value for lap, value in sorted(values.items())
                  if lap not in {reference_lap, target_lap} and np.isfinite(value)}
    base = {"method": "leave_two_out", "source_laps": list(background), "lap_count": len(background),
            "excluded_laps": sorted({reference_lap, target_lap}), "pair_difference_band95": None,
            "limitations": "Empirical descriptive percentile; pairs share laps and are not independent. Selection and temporal dependence remain."}
    if len(background) < 5:
        return {**base, "status": "unavailable", "reason": "fewer_than_five_background_laps"}
    array = np.asarray(list(background.values()), dtype=float)
    differences = np.abs(array[:, None] - array[None, :])[np.triu_indices(len(array), 1)]
    return {**base, "status": "calculated", "pair_count": len(differences),
            "pair_difference_band95": float(np.quantile(differences, .95))}


def analyze_corner_dynamics(telemetry: pd.DataFrame, zones: list[dict[str, Any]],
                            eligible_laps: list[int], reference_lap: int, target_lap: int) -> dict[str, Any]:
    """Use all eligible real laps; keep single-pair effects separate from CIs."""
    by_lap = {int(lap): frame for lap, frame in telemetry.groupby("lap") if int(lap) in eligible_laps}
    corners = []
    for zone in zones:
        calibration = fit_zone_thresholds(by_lap, zone)
        phases = [segment_corner_phases(by_lap[lap], zone, calibration) for lap in sorted(by_lap)]
        valid = {row["lap"]: row for row in phases if row["status"] == "calculated"}
        comparisons = {}
        for metric in ("entry_speed_kmh", "minimum_speed_kmh", "exit_speed_kmh", "elapsed_time_s"):
            stats = lap_repeatability([row["metrics"][metric] for row in valid.values()])
            delta = valid[target_lap]["metrics"][metric] - valid[reference_lap]["metrics"][metric] if {reference_lap, target_lap}.issubset(valid) else None
            background = leave_two_out_band({lap: row["metrics"][metric] for lap, row in valid.items()}, reference_lap, target_lap)
            band = background["pair_difference_band95"]
            stats["pair_difference_band95"] = band
            comparisons[metric] = {"target_minus_reference": delta, "repeatability": stats, "background": background,
                "outside_observed_repeatability_band": abs(delta) > band if delta is not None and band is not None else None,
                "distinguishable_from_sensor_noise": None, "reason": "independent_sensor_noise_bound_unavailable",
                "pair_effect_ci95": None}
        corners.append({"zone_id": zone["id"], "name": zone.get("name", str(zone["id"])),
                        "calibration": calibration, "phases": phases, "comparisons": comparisons})
    calculated = [p for c in corners for p in c["phases"] if p["status"] == "calculated"]
    return {"status": "calculated" if calculated else "unavailable", "corners": corners,
            "eligible_laps": sorted(by_lap), "reference_lap": reference_lap, "target_lap": target_lap,
            "coverage": {"attempted_lap_zones": len(zones)*len(by_lap), "calculated_lap_zones": len(calculated),
                         "complete_five_phase_lap_zones": sum(p["complete"] for p in calculated)},
            "sensor_noise_bound_kmh": None, "default_035_kmh_applied": False,
            "synthetic_curve_generated": False, "driver_input_confirmed": False}
