"""GPS cleaning, local projection, distance, and lap resampling."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

EARTH_RADIUS_M = 6_371_000.0


def clean_gps_points(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Remove unusable GPS samples using quality fields and robust jump checks."""
    required = {"gps_lat", "gps_lon", "lap_time_s"}
    if df.empty or not required.issubset(df.columns):
        return pd.DataFrame(), {
            "input_points": int(len(df)),
            "valid_points": 0,
            "removed_points": int(len(df)),
            "reason": "GPS latitude, longitude, or time is unavailable.",
        }

    working = df.copy()
    for column in [
        "gps_lat",
        "gps_lon",
        "lap_time_s",
        "speed",
        "gps_fix",
        "gps_accuracy_m",
    ]:
        if column in working:
            working[column] = pd.to_numeric(working[column], errors="coerce")
    finite = (
        working["gps_lat"].between(-90, 90)
        & working["gps_lon"].between(-180, 180)
        & working["lap_time_s"].notna()
    )
    if "gps_fix" in working and working["gps_fix"].notna().any():
        finite &= working["gps_fix"].fillna(0) >= 2

    accuracy_limit: float | None = None
    if "gps_accuracy_m" in working and working["gps_accuracy_m"].notna().any():
        positive = working.loc[working["gps_accuracy_m"] > 0, "gps_accuracy_m"]
        if not positive.empty:
            accuracy_limit = float(
                np.clip(positive.quantile(0.90) * 1.5, 8.0, 25.0)
            )
            finite &= working["gps_accuracy_m"].fillna(np.inf) <= accuracy_limit

    working = working.loc[finite].sort_values(["lap", "lap_time_s"]).copy()
    if len(working) < 3:
        return pd.DataFrame(), {
            "input_points": int(len(df)),
            "valid_points": int(len(working)),
            "removed_points": int(len(df) - len(working)),
            "accuracy_limit_m": accuracy_limit,
            "reason": "Too few valid GPS points.",
        }

    projected, origin = convert_latlon_to_local_xy(working)
    keep = pd.Series(True, index=projected.index)
    residuals: list[float] = []
    for _, lap in projected.groupby("lap", sort=False):
        step = np.hypot(lap["local_x_m"].diff(), lap["local_y_m"].diff())
        dt = lap["lap_time_s"].diff()
        expected = (
            lap["speed"].clip(lower=0).fillna(0) / 3.6 * dt
            if "speed" in lap
            else pd.Series(0.0, index=lap.index)
        )
        residual = (step - expected).abs()
        finite_residual = residual[np.isfinite(residual)]
        median = float(finite_residual.median()) if not finite_residual.empty else 0.0
        mad = (
            float((finite_residual - median).abs().median())
            if not finite_residual.empty
            else 0.0
        )
        residual_limit = max(5.0, median + 6.0 * max(mad, 0.25))
        impossible = (
            (dt <= 0)
            | (step > 30.0)
            | ((step > expected * 3.0 + 10.0) & (residual > residual_limit))
        )
        impossible.iloc[0] = False
        keep.loc[lap.index] = ~impossible.fillna(True)
        residuals.extend(finite_residual.tolist())

    cleaned = projected.loc[keep].copy()
    cleaned = calculate_cumulative_distance(cleaned)
    closure_errors = []
    for _, lap in cleaned.groupby("lap", sort=False):
        if len(lap) > 1:
            closure_errors.append(
                float(
                    math.hypot(
                        lap["local_x_m"].iloc[-1] - lap["local_x_m"].iloc[0],
                        lap["local_y_m"].iloc[-1] - lap["local_y_m"].iloc[0],
                    )
                )
            )
    stats = {
        "input_points": int(len(df)),
        "valid_points": int(len(cleaned)),
        "removed_points": int(len(df) - len(cleaned)),
        "removed_percentage": round(
            100.0 * max(0, len(df) - len(cleaned)) / max(1, len(df)),
            3,
        ),
        "retained_ratio": round(len(cleaned) / max(1, len(df)), 6),
        "accuracy_limit_m": round(accuracy_limit, 3)
        if accuracy_limit is not None
        else None,
        "origin": origin,
        "median_closure_error_m": round(float(np.median(closure_errors)), 3)
        if closure_errors
        else None,
    }
    return cleaned.reset_index(drop=True), stats


def convert_latlon_to_local_xy(
    df: pd.DataFrame,
    *,
    origin_lat: float | None = None,
    origin_lon: float | None = None,
) -> tuple[pd.DataFrame, dict[str, float]]:
    """Project latitude/longitude into local equirectangular metre coordinates."""
    working = df.copy()
    latitude = pd.to_numeric(working["gps_lat"], errors="coerce")
    longitude = pd.to_numeric(working["gps_lon"], errors="coerce")
    origin_lat = float(latitude.median()) if origin_lat is None else origin_lat
    origin_lon = float(longitude.median()) if origin_lon is None else origin_lon
    lat_rad = np.radians(latitude.to_numpy(dtype=float))
    lon_rad = np.radians(longitude.to_numpy(dtype=float))
    origin_lat_rad = math.radians(origin_lat)
    origin_lon_rad = math.radians(origin_lon)
    working["local_x_m"] = (
        (lon_rad - origin_lon_rad) * math.cos(origin_lat_rad) * EARTH_RADIUS_M
    )
    working["local_y_m"] = (lat_rad - origin_lat_rad) * EARTH_RADIUS_M
    return working, {"latitude": origin_lat, "longitude": origin_lon}


def calculate_cumulative_distance(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate a monotonic cumulative GPS distance independently for each lap."""
    working = df.copy()
    output: list[pd.DataFrame] = []
    for _, lap in working.groupby("lap", sort=False):
        ordered = lap.sort_values("lap_time_s").copy()
        steps = np.hypot(
            ordered["local_x_m"].diff().fillna(0),
            ordered["local_y_m"].diff().fillna(0),
        )
        steps = steps.where(np.isfinite(steps) & (steps <= 30.0), 0.0)
        ordered["distance_m"] = steps.cumsum()
        output.append(ordered)
    return pd.concat(output, ignore_index=True) if output else working.iloc[0:0]


def split_gps_by_lap(df: pd.DataFrame) -> dict[int, pd.DataFrame]:
    """Return sorted GPS traces keyed by timed lap number."""
    return {
        int(lap): group.sort_values("distance_m").reset_index(drop=True)
        for lap, group in df.groupby("lap", sort=True)
    }


def resample_lap_by_distance(
    df: pd.DataFrame,
    distance_step_m: float = 1.0,
    *,
    max_distance_m: float | None = None,
) -> pd.DataFrame:
    """Interpolate numeric lap channels onto a regular distance grid."""
    if df.empty or "distance_m" not in df:
        return pd.DataFrame()
    ordered = (
        df.sort_values("distance_m")
        .dropna(subset=["distance_m"])
        .drop_duplicates("distance_m", keep="last")
    )
    if len(ordered) < 2:
        return pd.DataFrame()
    distance_limit = float(ordered["distance_m"].max())
    if max_distance_m is not None:
        distance_limit = min(distance_limit, float(max_distance_m))
    if distance_limit <= 0 or distance_step_m <= 0:
        return pd.DataFrame()
    grid = np.arange(0.0, distance_limit + distance_step_m * 0.5, distance_step_m)
    result = pd.DataFrame({"distance_m": grid})
    source_distance = ordered["distance_m"].to_numpy(dtype=float)
    excluded = {"lap", "distance_m"}
    for column in ordered.columns:
        if column in excluded:
            continue
        values = pd.to_numeric(ordered[column], errors="coerce").to_numpy(dtype=float)
        finite = np.isfinite(source_distance) & np.isfinite(values)
        if finite.sum() < 2:
            continue
        result[column] = np.interp(
            grid,
            source_distance[finite],
            values[finite],
        )
    result["lap"] = int(ordered["lap"].iloc[0])
    return result
