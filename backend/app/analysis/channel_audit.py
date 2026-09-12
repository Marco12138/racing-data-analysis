"""Offline native-channel consistency checks, not IMU calibration or diagnosis."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import welch

from ..importers.native_signals import bounded_resample
from ..importers.xrk_inspection import convert_units


def comparison_metrics(observed: np.ndarray, predicted: np.ndarray) -> dict[str, Any]:
    """Compute signed bias, RMS and maximum absolute residual on shared samples."""
    mask = np.isfinite(observed) & np.isfinite(predicted)
    a, b = observed[mask], predicted[mask]
    if not len(a):
        return {"status": "unavailable", "valid_samples": 0}
    residual = a - b
    correlation = float(np.corrcoef(a, b)[0, 1]) if len(a) > 2 and min(np.std(a), np.std(b)) > 1e-10 else None
    return {
        "status": "calculated", "valid_samples": len(a), "correlation": correlation,
        "bias": float(np.mean(residual)), "rms": float(np.sqrt(np.mean(residual ** 2))),
        "max_absolute_error": float(np.max(np.abs(residual))),
        "residual_convention": "observed_minus_predicted",
    }


def native_series(native: pd.DataFrame, description: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    """Read one original channel and apply explicitly recorded unit conversion."""
    frame = native[native["channel_id"] == description["channel_id"]]
    return (
        frame["timecode_ms"].to_numpy(dtype=float) / 1000,
        convert_units(description["canonical_name"], frame["value"].to_numpy(dtype=float), description["unit"]),
    )


def spectral_summary(times: np.ndarray, values: np.ndarray, target_rate_hz: float) -> dict[str, Any]:
    """Describe output signal power, never a sensor's hardware bandwidth."""
    finite = np.isfinite(times) & np.isfinite(values)
    t, v = times[finite], values[finite]
    # Compare against the last accepted maximum, not just the previous row:
    # [1, 3, 2, 2.5, 4] must not keep 2.5 after dropping 2.
    keep = t > np.r_[-np.inf, np.maximum.accumulate(t)[:-1]] if len(t) else np.array([], dtype=bool)
    cleanup = {
        "invalid_samples_dropped": int(np.sum(~finite)),
        "nonincreasing_samples_dropped": int(np.sum(~keep)),
        "timestamp_policy": "keep_first_strictly_increasing_subsequence; native_cache_unchanged",
    }
    t, v = t[keep], v[keep]
    if len(t) < 64:
        return {"status": "unavailable", "reason": "insufficient_samples_after_cleanup", **cleanup}
    dt = float(np.median(np.diff(t)))
    chunks = np.split(np.arange(len(t)), np.flatnonzero(np.diff(t) > max(.5, 5*dt)) + 1)
    chunks = [chunk for chunk in chunks if len(chunk) >= 64]
    if not chunks:
        return {"status": "unavailable", "reason": "no_contiguous_window", **cleanup}
    chunk = max(chunks, key=len)
    grid = np.arange(t[chunk][0], t[chunk][-1], dt)
    signal = np.interp(grid, t[chunk], v[chunk])
    f, psd = welch(signal, fs=1/dt, nperseg=min(1024, len(signal)))
    power = float(np.sum(psd))
    return {
        "status": "calculated", "method": "Welch; longest contiguous segment; linear regularization; constant detrend",
        **cleanup,
        "native_rate_hz": 1/dt, "display_rate_hz": target_rate_hz,
        "segment_samples": len(signal), "segment_start_s": float(grid[0]), "segment_end_s": float(grid[-1]),
        "output_power_fraction_above_display_nyquist": float(np.sum(psd[f > target_rate_hz/2])/power) if power > 0 else None,
        "frequency_hz": f.tolist(), "output_psd": psd.tolist(),
        "hardware_bandwidth_inferred": False,
    }


def audit_native_channels(native: pd.DataFrame, manifest: dict[str, Any]) -> dict[str, Any]:
    """Check GPS identities and raw-axis timing without claiming independence."""
    selected = manifest["channel_provenance"]
    relations: dict[str, Any] = {}
    speed = selected.get("speed")
    if speed is None or speed["source"] != "gps_receiver":
        return {"status": "unavailable", "reason": "GPS speed unavailable"}
    t, v = native_series(native, speed)
    finite_times = t[np.isfinite(t)]
    rate = speed.get("native_sample_rate_hz") or 10.
    grid = np.arange(float(finite_times.min()), float(finite_times.max()), 1/rate)
    if len(grid) > 1_000_000:
        return {"status": "unavailable", "reason": "audit_grid_limit"}
    signals = {}
    processing = {}
    native_signals = {}
    for key, description in selected.items():
        if key not in {"speed", "yaw_rate", "longitudinal_g", "lateral_g", "gyro_x", "gyro_y", "gyro_z", "accel_x", "accel_y", "accel_z", "rpm"}:
            continue
        ts, vals = native_series(native, description)
        native_signals[key] = (ts, vals)
        signals[key], processing[key] = bounded_resample(ts, vals, grid)
    speed_mps = signals["speed"] / 3.6
    if {"yaw_rate", "lateral_g"}.issubset(signals):
        relations["gps_lateral_vs_speed_yaw"] = {
            **comparison_metrics(signals["lateral_g"], speed_mps*np.deg2rad(signals["yaw_rate"])/9.80665),
            "unit": "g", "formula": "(speed_kmh/3.6) * (yaw_deg_s*pi/180) / 9.80665",
            "independent_validation": False,
            "timebase": "uniform_GPS_rate_grid_after_bounded_resample",
        }
        # Additional exact-timestamp check avoids resampling residuals. Duplicate
        # timestamps use their first observation only; no many-to-many joining.
        common = None
        for key in ("speed", "yaw_rate", "lateral_g"):
            ts, vals = native_signals[key]
            part = pd.DataFrame({"time_s": ts, key: vals}).dropna(subset=["time_s"]).drop_duplicates("time_s", keep="first")
            common = part if common is None else common.merge(part, on="time_s", how="inner", validate="one_to_one")
        relations["gps_lateral_vs_speed_yaw_native"] = {
            **comparison_metrics(common["lateral_g"].to_numpy(), common["speed"].to_numpy()/3.6*np.deg2rad(common["yaw_rate"].to_numpy())/9.80665),
            "unit": "g", "timebase": "exact_shared_native_timestamps_no_interpolation",
            "duplicate_policy": "first_observation_per_timestamp",
            "independent_validation": False,
        }
    if "longitudinal_g" in signals:
        backward = np.r_[np.nan, np.diff(speed_mps)*rate]/9.80665
        centered = np.gradient(speed_mps, grid)/9.80665
        for label, prediction in (("backward", backward), ("centered", centered)):
            valid = np.flatnonzero(np.isfinite(signals["longitudinal_g"]) & np.isfinite(prediction))
            largest = valid[np.argsort(np.abs(signals["longitudinal_g"][valid] - prediction[valid]))[-5:]][::-1]
            relations[f"gps_longitudinal_vs_{label}_speed_derivative"] = {
                **comparison_metrics(signals["longitudinal_g"], prediction),
                "unit": "g", "method": label + " finite difference after bounded time alignment",
                "independent_validation": False,
                "largest_residual_samples": [
                    {"time_s": float(grid[i]), "observed_g": float(signals["longitudinal_g"][i]),
                     "predicted_g": float(prediction[i]), "residual_g": float(signals["longitudinal_g"][i] - prediction[i])}
                    for i in largest
                ],
                "residual_cause": "not_inferred; review timestamps against receiver status and gaps",
            }
        jerk = np.gradient(signals["longitudinal_g"], grid)
        finite = jerk[np.isfinite(jerk)]
        relations["gps_jerk"] = {"unit": "g/s", "valid_samples": len(finite),
                                 "rms": float(np.sqrt(np.mean(finite**2))) if len(finite) else None,
                                 "method": "centered derivative of GPS longitudinal g; no extra smoothing"}
    spectra = {}
    for key, description in selected.items():
        if key not in signals:
            continue
        ts, vals = native_signals[key]
        spectra[key] = spectral_summary(ts, vals, rate)
    # Raw axes are compared separately with fixed sign. No axis is flipped or
    # selected as body yaw on the basis of its fitted correlation.
    delay = {}
    if "yaw_rate" in signals:
        for axis in ("gyro_x", "gyro_y", "gyro_z"):
            if axis not in signals:
                continue
            windows = []
            ts, vals = native_signals[axis]
            for chunk in np.array_split(np.arange(len(grid)), 3):
                if len(chunk) < rate*20:
                    continue
                scores = []
                x = signals["yaw_rate"][chunk]
                for lag in np.arange(-1, 1.001, .05):
                    y, _ = bounded_resample(ts, vals, grid[chunk]+lag)
                    metrics = comparison_metrics(y, x)
                    corr = metrics.get("correlation")
                    if corr is not None:
                        scores.append((corr, float(lag), metrics["valid_samples"]))
                if scores:
                    corr, lag, count = max(scores)
                    windows.append({"start_s": float(grid[chunk][0]), "end_s": float(grid[chunk][-1]),
                                    "lag_s": lag, "signed_correlation": corr, "valid_samples": count})
            delay[axis] = {"status": "exploratory_unvalidated", "windows": windows,
                           "sign_convention": "GPS(t) compared with raw gyro(t + lag); positive means gyro later",
                           "axis_rotation_applied": False, "body_yaw_confirmed": False,
                           "filter": "bounded anti-aliased alignment to GPS time grid"}
    return {"status": "calculated", "relations": relations, "processing": processing,
            "spectra": spectra, "raw_gyro_lag_candidates": delay,
            "imu_calibration": {"available": False, "reason": "P0 audit does not calibrate sensor axes or validate body dynamics"}}
