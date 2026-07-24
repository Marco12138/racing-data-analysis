"""Virtual sector timing and conservative track-zone comparisons."""

from __future__ import annotations

import hashlib
import re
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

from .lap_analysis import analyze_laps


def calculate_track_curvature(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate smoothed absolute heading curvature against distance."""
    output: list[pd.DataFrame] = []
    for _, lap in df.groupby("lap", sort=True):
        ordered = (
            lap.sort_values("distance_m")
            .drop_duplicates("distance_m", keep="last")
            .copy()
        )
        if len(ordered) < 9:
            ordered["curvature"] = np.nan
            output.append(ordered)
            continue
        distance = ordered["distance_m"].to_numpy(dtype=float)
        x = ordered["local_x_m"].to_numpy(dtype=float)
        y = ordered["local_y_m"].to_numpy(dtype=float)
        window = min(15, len(ordered) if len(ordered) % 2 else len(ordered) - 1)
        window = max(5, window)
        if window % 2 == 0:
            window -= 1
        x_smooth = savgol_filter(x, window, 2, mode="interp")
        y_smooth = savgol_filter(y, window, 2, mode="interp")
        dx = np.gradient(x_smooth, distance)
        dy = np.gradient(y_smooth, distance)
        heading = np.unwrap(np.arctan2(dy, dx))
        curvature = np.gradient(heading, distance)
        curvature = pd.Series(curvature).rolling(
            9,
            center=True,
            min_periods=1,
        ).mean()
        ordered["curvature"] = curvature.to_numpy(dtype=float)
        output.append(ordered)
    return pd.concat(output, ignore_index=True) if output else df.copy()


def generate_sector_boundaries(
    lap_length_m: float,
    sector_count: int = 3,
    custom_boundaries_m: list[float] | None = None,
) -> list[float]:
    """Return validated internal sector boundaries for 2-6 sectors."""
    if not 2 <= sector_count <= 6:
        raise ValueError("Sector count must be between 2 and 6.")
    if not np.isfinite(lap_length_m) or lap_length_m <= 0:
        raise ValueError("A positive lap length is required.")
    if custom_boundaries_m is None:
        return [
            lap_length_m * index / sector_count
            for index in range(1, sector_count)
        ]
    boundaries = sorted(
        {
            float(value)
            for value in custom_boundaries_m
            if np.isfinite(value) and 0 < float(value) < lap_length_m
        }
    )
    if len(boundaries) != sector_count - 1:
        raise ValueError(
            f"{sector_count} sectors require {sector_count - 1} internal boundaries."
        )
    return boundaries


def calculate_virtual_sectors(
    telemetry_df: pd.DataFrame,
    boundaries_m: list[float],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Calculate sector crossings for every complete lap and analyze them."""
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    for lap_number, lap in telemetry_df.groupby("lap", sort=True):
        ordered = (
            lap.sort_values("distance_m")
            .dropna(subset=["distance_m", "lap_time_s"])
            .drop_duplicates("distance_m", keep="last")
        )
        if len(ordered) < 2 or float(ordered["distance_m"].max()) <= boundaries_m[-1]:
            warnings.append(
                f"Lap {int(lap_number)} does not reach every virtual sector boundary."
            )
            continue
        distance = ordered["distance_m"].to_numpy(dtype=float)
        lap_time = ordered["lap_time_s"].to_numpy(dtype=float)
        crossings = [float(np.interp(value, distance, lap_time)) for value in boundaries_m]
        duration = official_lap_duration(ordered)
        splits = np.diff([0.0, *crossings, duration])
        row: dict[str, Any] = {
            "lap": int(lap_number),
            "lap_time": round(duration, 3),
            "notes": "derived_distance_sectors",
        }
        for index, split in enumerate(splits, start=1):
            row[f"sector_{index}"] = round(float(split), 3)
        rows.append(row)
    if not rows:
        raise ValueError("No complete laps reach the configured sector boundaries.")
    return rows, {
        "analysis": analyze_laps(pd.DataFrame(rows)),
        "warnings": warnings,
    }


def generate_auto_zones(
    reference_lap: pd.DataFrame,
    *,
    max_zones: int = 12,
) -> list[dict[str, Any]]:
    """Generate suggested corner zones from sustained curvature."""
    ordered = reference_lap.sort_values("distance_m").reset_index(drop=True)
    if (
        ordered.empty
        or "curvature" not in ordered
        or ordered["curvature"].notna().sum() < 20
    ):
        return []
    curvature = ordered["curvature"].abs()
    threshold = float(curvature.quantile(0.72))
    if not np.isfinite(threshold) or threshold <= 0:
        return []
    active = curvature >= threshold
    zones: list[tuple[float, float, float]] = []
    start: int | None = None
    for index, value in enumerate(active):
        if value and start is None:
            start = index
        if start is not None and (not value or index == len(active) - 1):
            end = index if value and index == len(active) - 1 else index - 1
            entry = float(ordered["distance_m"].iloc[start])
            exit_distance = float(ordered["distance_m"].iloc[end])
            if exit_distance - entry >= 10.0:
                zones.append(
                    (
                        max(0.0, entry - 12.0),
                        min(float(ordered["distance_m"].max()), exit_distance + 15.0),
                        float(curvature.iloc[start : end + 1].max()),
                    )
                )
            start = None
    merged: list[list[float]] = []
    for entry, exit_distance, peak in zones:
        if merged and entry - merged[-1][1] <= 12.0:
            merged[-1][1] = max(merged[-1][1], exit_distance)
            merged[-1][2] = max(merged[-1][2], peak)
        else:
            merged.append([entry, exit_distance, peak])
    selected = sorted(merged, key=lambda item: item[2], reverse=True)[:max_zones]
    selected.sort(key=lambda item: item[0])
    return [
        {
            "id": f"auto-zone-{index}",
            "name": f"Suggested Zone {index}",
            "entry_distance_m": round(entry, 3),
            "exit_distance_m": round(exit_distance, 3),
            "source": "automatic_curvature",
            "confidence": "medium",
            "evidence": {
                "peak_abs_curvature": round(peak, 7),
                "curvature_threshold": round(threshold, 7),
            },
        }
        for index, (entry, exit_distance, peak) in enumerate(selected, start=1)
    ]


def analyze_zones(
    telemetry_df: pd.DataFrame,
    events: list[dict[str, Any]],
    zones: list[dict[str, Any]],
    reference_lap: int,
    target_lap: int,
) -> list[dict[str, Any]]:
    """Compare measured and inferred behavior inside configured zones."""
    comparisons: list[dict[str, Any]] = []
    for zone in zones:
        entry = float(zone["entry_distance_m"])
        exit_distance = float(zone["exit_distance_m"])
        reference = zone_metrics(
            telemetry_df,
            events,
            reference_lap,
            entry,
            exit_distance,
        )
        target = zone_metrics(
            telemetry_df,
            events,
            target_lap,
            entry,
            exit_distance,
        )
        findings: list[dict[str, Any]] = []
        for key, label, unit in [
            ("lift_distance_m", "Lift point", "m"),
            ("reacceleration_distance_m", "Re-acceleration point", "m"),
            ("minimum_rpm", "Minimum RPM", "rpm"),
            ("exit_speed_kmh", "Exit speed", "km/h"),
            ("elapsed_time_s", "Zone time", "s"),
        ]:
            reference_value = reference.get(key)
            target_value = target.get(key)
            if reference_value is None or target_value is None:
                continue
            findings.append(
                {
                    "metric": key,
                    "label": label,
                    "reference": reference_value,
                    "target": target_value,
                    "difference": round(target_value - reference_value, 3),
                    "unit": unit,
                    "evidence_class": "calculated"
                    if key in {"elapsed_time_s"}
                    else "measured",
                }
            )
        comparisons.append(
            {
                **zone,
                "reference": reference,
                "target": target,
                "estimated_zone_loss_s": round(
                    (target.get("elapsed_time_s") or 0.0)
                    - (reference.get("elapsed_time_s") or 0.0),
                    3,
                )
                if reference.get("elapsed_time_s") is not None
                and target.get("elapsed_time_s") is not None
                else None,
                "findings": findings,
            }
        )
    return comparisons


def zone_metrics(
    telemetry_df: pd.DataFrame,
    events: list[dict[str, Any]],
    lap_number: int,
    entry: float,
    exit_distance: float,
) -> dict[str, Any]:
    """Calculate measured and inferred metrics for one lap zone."""
    lap = telemetry_df[
        (telemetry_df["lap"] == lap_number)
        & telemetry_df["distance_m"].between(entry, exit_distance)
    ].sort_values("distance_m")
    if lap.empty:
        return {}
    zone_events = [
        event
        for event in events
        if event["lap"] == lap_number
        and entry <= event["distance_m"] <= exit_distance
    ]

    def first_event(*event_types: str) -> dict[str, Any] | None:
        return next(
            (
                event
                for event in zone_events
                if event["event_type"] in event_types
            ),
            None,
        )

    lift = first_event("LIFTING")
    brake = first_event("BRAKING_CONFIRMED", "BRAKING_LIKELY")
    reacceleration = first_event(
        "REACCELERATION",
        "SUSTAINED_ACCELERATION",
        "ACCELERATING",
    )
    rpm_column = "rpm_smoothed" if "rpm_smoothed" in lap else "rpm"
    elapsed = float(lap["lap_time_s"].iloc[-1] - lap["lap_time_s"].iloc[0])
    recovery_rate = None
    if reacceleration and "rpm_slope" in lap:
        recovery_rows = lap[lap["distance_m"] >= reacceleration["distance_m"]]
        if not recovery_rows.empty:
            recovery_rate = finite_float(recovery_rows["rpm_slope"].median())
    return {
        "lap": lap_number,
        "entry_speed_kmh": finite_float(lap["speed"].iloc[0])
        if "speed" in lap
        else None,
        "minimum_speed_kmh": finite_float(lap["speed"].min())
        if "speed" in lap
        else None,
        "minimum_rpm": finite_float(lap[rpm_column].min())
        if rpm_column in lap
        else None,
        "lift_distance_m": lift["distance_m"] if lift else None,
        "braking_distance_m": brake["distance_m"] if brake else None,
        "braking_event_type": brake["event_type"] if brake else None,
        "reacceleration_distance_m": reacceleration["distance_m"]
        if reacceleration
        else None,
        "exit_speed_kmh": finite_float(lap["speed"].iloc[-1])
        if "speed" in lap
        else None,
        "rpm_recovery_rate": recovery_rate,
        "elapsed_time_s": round(elapsed, 3),
    }


def build_track_id(metadata: dict[str, Any], reference_lap: pd.DataFrame) -> str:
    """Build a stable non-sensitive track identifier from venue and shape."""
    venue = str(metadata.get("Venue") or metadata.get("Track") or "unknown-track")
    slug = re.sub(r"[^a-z0-9]+", "-", venue.lower()).strip("-") or "unknown-track"
    coordinates = reference_lap[["local_x_m", "local_y_m"]].to_numpy(dtype=float)
    if len(coordinates) > 100:
        indexes = np.linspace(0, len(coordinates) - 1, 100, dtype=int)
        coordinates = coordinates[indexes]
    shape = np.round(coordinates, 0).tobytes()
    digest = hashlib.sha256(shape).hexdigest()[:10]
    return f"{slug}-{digest}"


def official_lap_duration(lap: pd.DataFrame) -> float:
    """Return logger lap duration from session time boundaries."""
    if "session_time_s" in lap and len(lap) > 1:
        sample_dt = float(lap["session_time_s"].diff().median())
        if not np.isfinite(sample_dt):
            sample_dt = 0.0
        return float(lap["lap_time_s"].iloc[-1] + max(sample_dt, 0.0))
    return float(lap["lap_time_s"].max())


def finite_float(value: Any) -> float | None:
    """Return a finite number or null."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None
