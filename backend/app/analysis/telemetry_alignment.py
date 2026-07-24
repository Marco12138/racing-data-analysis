"""Distance-domain telemetry alignment for lap comparisons."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .gps_processing import resample_lap_by_distance

COMPARISON_CHANNELS = [
    "lap_time_s",
    "session_time_s",
    "speed",
    "rpm",
    "longitudinal_g",
    "lateral_g",
    "gps_lat",
    "gps_lon",
    "local_x_m",
    "local_y_m",
    "predictive_time",
    "best_run_diff",
    "throttle",
    "brake",
    "gear",
    "curvature",
]


def align_laps_by_distance(
    telemetry_df: pd.DataFrame,
    reference_lap: int,
    target_lap: int,
    distance_step_m: float = 1.0,
) -> pd.DataFrame:
    """Interpolate two laps by track distance and return values plus differences."""
    reference = telemetry_df[telemetry_df["lap"] == reference_lap]
    target = telemetry_df[telemetry_df["lap"] == target_lap]
    if reference.empty or target.empty:
        return pd.DataFrame()
    common_distance = min(
        float(reference["distance_m"].max()),
        float(target["distance_m"].max()),
    )
    if not np.isfinite(common_distance) or common_distance <= 0:
        return pd.DataFrame()
    reference_resampled = resample_lap_by_distance(
        reference,
        distance_step_m,
        max_distance_m=common_distance,
    )
    target_resampled = resample_lap_by_distance(
        target,
        distance_step_m,
        max_distance_m=common_distance,
    )
    if reference_resampled.empty or target_resampled.empty:
        return pd.DataFrame()
    length = min(len(reference_resampled), len(target_resampled))
    reference_resampled = reference_resampled.iloc[:length].reset_index(drop=True)
    target_resampled = target_resampled.iloc[:length].reset_index(drop=True)
    aligned = pd.DataFrame(
        {"distance_m": reference_resampled["distance_m"].to_numpy(dtype=float)}
    )
    for channel in COMPARISON_CHANNELS:
        reference_column = f"reference_{channel}"
        target_column = f"target_{channel}"
        if channel in reference_resampled:
            aligned[reference_column] = reference_resampled[channel]
        if channel in target_resampled:
            aligned[target_column] = target_resampled[channel]
        if channel in reference_resampled and channel in target_resampled:
            aligned[f"difference_{channel}"] = (
                target_resampled[channel] - reference_resampled[channel]
            )
    if {
        "reference_lap_time_s",
        "target_lap_time_s",
    }.issubset(aligned.columns):
        aligned["cumulative_time_delta_s"] = (
            aligned["target_lap_time_s"] - aligned["reference_lap_time_s"]
        )
    aligned["reference_lap"] = reference_lap
    aligned["target_lap"] = target_lap
    return aligned


def align_multiple_laps_by_distance(
    telemetry_df: pd.DataFrame,
    lap_numbers: list[int],
    distance_step_m: float = 1.0,
) -> tuple[pd.DataFrame, dict[int, pd.DataFrame]]:
    """Align real laps to one common distance grid without synthesizing a lap."""
    unique_laps = list(dict.fromkeys(int(lap) for lap in lap_numbers))
    source_laps = {
        lap: telemetry_df[telemetry_df["lap"] == lap]
        for lap in unique_laps
    }
    source_laps = {
        lap: frame
        for lap, frame in source_laps.items()
        if not frame.empty and "distance_m" in frame
    }
    if not source_laps:
        return pd.DataFrame(), {}
    common_distance = min(
        float(frame["distance_m"].max()) for frame in source_laps.values()
    )
    if not np.isfinite(common_distance) or common_distance <= 0:
        return pd.DataFrame(), {}

    resampled = {
        lap: resample_lap_by_distance(
            frame,
            distance_step_m,
            max_distance_m=common_distance,
        )
        for lap, frame in source_laps.items()
    }
    resampled = {lap: frame for lap, frame in resampled.items() if not frame.empty}
    if not resampled:
        return pd.DataFrame(), {}

    length = min(len(frame) for frame in resampled.values())
    resampled = {
        lap: frame.iloc[:length].reset_index(drop=True)
        for lap, frame in resampled.items()
    }
    first = next(iter(resampled.values()))
    aligned = pd.DataFrame(
        {"distance_m": first["distance_m"].to_numpy(dtype=float)}
    )
    for lap, frame in resampled.items():
        for channel in COMPARISON_CHANNELS:
            if channel in frame:
                aligned[f"lap_{lap}_{channel}"] = frame[channel]
        aligned[f"lap_{lap}_interpolated"] = 1.0
    return aligned, resampled
