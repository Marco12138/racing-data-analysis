"""Explainable RPM and multi-signal driver action analysis."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import find_peaks, savgol_filter

RULES_PATH = Path(__file__).with_name("rpm_rules.json")


def load_rpm_rules(path: Path | None = None) -> dict[str, float]:
    """Load adjustable analysis rules from the committed JSON configuration."""
    return {
        key: float(value)
        for key, value in json.loads(
            (path or RULES_PATH).read_text(encoding="utf-8")
        ).items()
    }


def smooth_rpm_signal(
    df: pd.DataFrame,
    *,
    rules: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Smooth RPM and speed using a sample-rate-aware robust window."""
    rules = rules or load_rpm_rules()
    working = df.sort_values("lap_time_s").copy()
    if "rpm" not in working or working["rpm"].notna().sum() < 5:
        return working
    time = pd.to_numeric(working["lap_time_s"], errors="coerce")
    dt = float(time.diff().median())
    if not np.isfinite(dt) or dt <= 0:
        dt = 0.04
    window = max(5, int(round(rules["smooth_window_seconds"] / dt)))
    if window % 2 == 0:
        window += 1
    window = min(window, len(working) if len(working) % 2 else len(working) - 1)
    window = max(3, window)
    rpm = pd.to_numeric(working["rpm"], errors="coerce").interpolate(
        limit_direction="both"
    )
    median = rpm.rolling(window, center=True, min_periods=1).median()
    if len(median) >= window and window >= 5:
        working["rpm_smoothed"] = savgol_filter(
            median.to_numpy(dtype=float),
            window_length=window,
            polyorder=min(2, window - 1),
            mode="interp",
        )
    else:
        working["rpm_smoothed"] = median
    if "speed" in working and working["speed"].notna().sum() >= 3:
        speed = pd.to_numeric(working["speed"], errors="coerce").interpolate(
            limit_direction="both"
        )
        working["speed_smoothed"] = speed.rolling(
            window,
            center=True,
            min_periods=1,
        ).mean()
    return working


def calculate_rpm_derivative(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate RPM slope and vehicle acceleration against real lap time."""
    working = df.copy()
    time = pd.to_numeric(working["lap_time_s"], errors="coerce").to_numpy(
        dtype=float
    )
    if len(time) < 3 or not np.all(np.isfinite(time)):
        return working
    rpm_column = "rpm_smoothed" if "rpm_smoothed" in working else "rpm"
    if rpm_column in working:
        rpm = pd.to_numeric(working[rpm_column], errors="coerce").interpolate(
            limit_direction="both"
        )
        working["rpm_slope"] = np.gradient(rpm.to_numpy(dtype=float), time)
    speed_column = "speed_smoothed" if "speed_smoothed" in working else "speed"
    if speed_column in working:
        speed_mps = (
            pd.to_numeric(working[speed_column], errors="coerce")
            .interpolate(limit_direction="both")
            .to_numpy(dtype=float)
            / 3.6
        )
        working["speed_accel_mps2"] = np.gradient(speed_mps, time)
    return working


def adaptive_thresholds(
    df: pd.DataFrame,
    *,
    rules: dict[str, float] | None = None,
) -> dict[str, float | None]:
    """Derive session thresholds from signal distributions with safety floors."""
    rules = rules or load_rpm_rules()
    rpm_slope = finite_series(df, "rpm_slope")
    acceleration = finite_series(df, "speed_accel_mps2")
    longitudinal = finite_series(df, "longitudinal_g")
    curvature = finite_series(df, "curvature").abs()
    brake = finite_series(df, "brake")
    return {
        "rpm_drop": min(
            -rules["minimum_rpm_drop_floor"],
            quantile_or(rpm_slope, rules["rpm_drop_quantile"], -600.0),
        ),
        "rpm_severe_drop": min(
            -rules["minimum_rpm_severe_drop_floor"],
            quantile_or(rpm_slope, rules["rpm_severe_drop_quantile"], -1200.0),
        ),
        "rpm_rise": max(
            rules["minimum_rpm_rise_floor"],
            quantile_or(rpm_slope, rules["rpm_rise_quantile"], 350.0),
        ),
        "speed_deceleration": min(
            -rules["minimum_speed_deceleration"],
            quantile_or(
                acceleration,
                rules["speed_deceleration_quantile"],
                -0.8,
            ),
        ),
        "negative_g": min(
            -rules["minimum_negative_g"],
            quantile_or(longitudinal, rules["negative_g_quantile"], -0.12),
        ),
        "corner_curvature": quantile_or(
            curvature,
            rules["curvature_quantile"],
            0.0,
        ),
        "brake_active": quantile_or(
            brake[brake > 0],
            rules["brake_active_quantile"],
            5.0,
        )
        if not brake.empty
        else None,
    }


def detect_driver_actions(
    df: pd.DataFrame,
    *,
    sector_boundaries_m: list[float] | None = None,
    rules: dict[str, float] | None = None,
) -> tuple[pd.DataFrame, list[dict[str, Any]], dict[str, Any]]:
    """Classify conservative driver actions and return evidence-rich events."""
    rules = rules or load_rpm_rules()
    prepared_laps: list[pd.DataFrame] = []
    for _, lap in df.groupby("lap", sort=True):
        prepared_laps.append(calculate_rpm_derivative(smooth_rpm_signal(lap, rules=rules)))
    prepared = (
        pd.concat(prepared_laps, ignore_index=True)
        if prepared_laps
        else df.copy()
    )
    thresholds = adaptive_thresholds(prepared, rules=rules)
    all_events: list[dict[str, Any]] = []
    classified_laps: list[pd.DataFrame] = []
    for lap_number, lap in prepared.groupby("lap", sort=True):
        classified, events = classify_lap(
            lap,
            int(lap_number),
            thresholds,
            rules,
            sector_boundaries_m or [],
        )
        classified_laps.append(classified)
        all_events.extend(events)
    return (
        pd.concat(classified_laps, ignore_index=True)
        if classified_laps
        else prepared,
        all_events,
        {"thresholds": thresholds, "rules": rules},
    )


def classify_lap(
    lap: pd.DataFrame,
    lap_number: int,
    thresholds: dict[str, float | None],
    rules: dict[str, float],
    sector_boundaries_m: list[float],
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Classify one lap and aggregate contiguous evidence into events."""
    working = lap.sort_values("lap_time_s").reset_index(drop=True).copy()
    rpm_slope = numeric_array(working, "rpm_slope")
    speed_accel = numeric_array(working, "speed_accel_mps2")
    longitudinal = numeric_array(working, "longitudinal_g")
    curvature = np.abs(numeric_array(working, "curvature"))
    brake = numeric_array(working, "brake")
    gear = numeric_array(working, "gear")

    rpm_drop = rpm_slope <= float(thresholds["rpm_drop"])
    rpm_severe = rpm_slope <= float(thresholds["rpm_severe_drop"])
    decelerating = speed_accel <= float(thresholds["speed_deceleration"])
    negative_g = longitudinal <= float(thresholds["negative_g"])
    sample_dt = max(0.02, float(working["lap_time_s"].diff().median()))
    future_window = max(3, int(round(0.8 / sample_dt)))
    future_curvature = (
        pd.Series(curvature[::-1])
        .rolling(future_window, min_periods=1)
        .max()
        .to_numpy()[::-1]
    )
    in_corner_zone = future_curvature >= float(
        thresholds["corner_curvature"] or 0.0
    )
    rpm_rising = rpm_slope >= float(thresholds["rpm_rise"])
    speed_rising = speed_accel > 0.15
    gear_change = np.r_[False, np.abs(np.diff(gear)) >= 0.5] & np.isfinite(gear)

    direct_brake = np.zeros(len(working), dtype=bool)
    if thresholds["brake_active"] is not None and np.isfinite(brake).any():
        direct_brake = brake >= float(thresholds["brake_active"])
    likely_brake = (
        ~direct_brake
        & (rpm_severe | rpm_drop)
        & decelerating
        & negative_g
        & in_corner_zone
        & ~gear_change
    )
    lifting = (
        ~direct_brake
        & ~likely_brake
        & rpm_drop
        & (speed_accel < -0.15)
        & ~gear_change
    )
    coasting = (
        ~direct_brake
        & ~likely_brake
        & ~lifting
        & (speed_accel < -0.2)
        & (np.abs(rpm_slope) < abs(float(thresholds["rpm_drop"])) * 0.55)
    )
    accelerating = rpm_rising & speed_rising

    state = np.full(len(working), "UNKNOWN", dtype=object)
    state[accelerating] = "ACCELERATING"
    state[coasting] = "COASTING"
    state[lifting] = "LIFTING"
    state[likely_brake] = "BRAKING_LIKELY"
    state[direct_brake] = "BRAKING_CONFIRMED"
    working["driver_state"] = state

    events: list[dict[str, Any]] = []
    for event_type, mask, confidence in [
        ("BRAKING_CONFIRMED", direct_brake, "high"),
        ("BRAKING_LIKELY", likely_brake, "medium"),
        ("LIFTING", lifting, "medium"),
        ("COASTING", coasting, "low"),
        ("ACCELERATING", accelerating, "medium"),
    ]:
        event_minimum = (
            max(0.45, rules["minimum_event_seconds"])
            if event_type in {"COASTING", "ACCELERATING"}
            else rules["minimum_event_seconds"]
        )
        for start, end in contiguous_runs(
            mask,
            working["lap_time_s"].to_numpy(dtype=float),
            event_minimum,
            rules["merge_gap_seconds"],
        ):
            duration = (
                working["lap_time_s"].iloc[end] - working["lap_time_s"].iloc[start]
            )
            resolved_type = (
                "SUSTAINED_ACCELERATION"
                if event_type == "ACCELERATING"
                and duration >= rules["sustained_acceleration_seconds"]
                else event_type
            )
            if event_type == "ACCELERATING" and resolved_type == "ACCELERATING":
                continue
            events.append(
                build_event(
                    working,
                    lap_number,
                    start,
                    end,
                    resolved_type,
                    confidence,
                    thresholds,
                    sector_boundaries_m,
                )
            )

    if "rpm_smoothed" in working and working["rpm_smoothed"].notna().sum() >= 5:
        rpm = working["rpm_smoothed"].to_numpy(dtype=float)
        prominence = max(400.0, float(np.nanstd(rpm)) * 0.22)
        valleys, _ = find_peaks(
            -rpm,
            prominence=prominence,
            distance=max(1, int(round(1.4 / sample_dt))),
        )
        for valley in valleys:
            events.append(
                build_event(
                    working,
                    lap_number,
                    int(valley),
                    int(valley),
                    "MINIMUM_RPM",
                    "high",
                    thresholds,
                    sector_boundaries_m,
                )
            )
            recovery = find_recovery_index(
                working,
                int(valley),
                float(thresholds["rpm_rise"]),
            )
            if recovery is not None:
                events.append(
                    build_event(
                        working,
                        lap_number,
                        recovery,
                        recovery,
                        "REACCELERATION",
                        "medium",
                        thresholds,
                        sector_boundaries_m,
                    )
                )

    events.extend(
        detect_hesitation_events(
            working,
            lap_number,
            thresholds,
            sector_boundaries_m,
        )
    )
    events.sort(key=lambda item: (item["lap_time_s"], item["event_type"]))
    return working, deduplicate_events(events)


def compare_rpm_behavior_by_lap(
    reference_events: list[dict[str, Any]],
    target_events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Match comparable events by type and nearest distance."""
    comparisons: list[dict[str, Any]] = []
    for target in target_events:
        candidates = [
            event
            for event in reference_events
            if event["event_type"] == target["event_type"]
        ]
        if not candidates:
            continue
        reference = min(
            candidates,
            key=lambda event: abs(event["distance_m"] - target["distance_m"]),
        )
        if abs(reference["distance_m"] - target["distance_m"]) > 40.0:
            continue
        comparisons.append(
            {
                "event_type": target["event_type"],
                "reference_distance_m": reference["distance_m"],
                "target_distance_m": target["distance_m"],
                "distance_difference_m": round(
                    target["distance_m"] - reference["distance_m"],
                    3,
                ),
                "reference_lap_time_s": reference["lap_time_s"],
                "target_lap_time_s": target["lap_time_s"],
                "time_difference_s": round(
                    target["lap_time_s"] - reference["lap_time_s"],
                    3,
                ),
                "reference_rpm": reference["evidence"].get("rpm"),
                "target_rpm": target["evidence"].get("rpm"),
            }
        )
    return comparisons


def build_event(
    frame: pd.DataFrame,
    lap: int,
    start: int,
    end: int,
    event_type: str,
    confidence: str,
    thresholds: dict[str, float | None],
    boundaries: list[float],
) -> dict[str, Any]:
    """Build a JSON-safe event from one contiguous signal interval."""
    if event_type in {"LIFTING", "BRAKING_LIKELY", "BRAKING_CONFIRMED"}:
        index = start
    elif event_type == "MINIMUM_RPM":
        index = start
    else:
        index = end
    row = frame.iloc[index]
    distance = finite_float(row.get("distance_m")) or 0.0
    evidence = {
        key: finite_float(row.get(key))
        for key in [
            "rpm",
            "rpm_smoothed",
            "rpm_slope",
            "speed",
            "speed_accel_mps2",
            "longitudinal_g",
            "lateral_g",
            "curvature",
            "brake",
            "throttle",
            "gear",
        ]
        if finite_float(row.get(key)) is not None
    }
    channels_used = [
        channel
        for channel in [
            "rpm",
            "speed",
            "longitudinal_g",
            "lateral_g",
            "curvature",
            "brake",
            "throttle",
            "gear",
        ]
        if channel in evidence
    ]
    return {
        "lap": lap,
        "sector": sector_for_distance(distance, boundaries),
        "distance_m": round(distance, 3),
        "lap_time_s": round(float(row["lap_time_s"]), 3),
        "session_time_s": round(float(row.get("session_time_s", 0.0)), 3),
        "event_type": event_type,
        "confidence": confidence,
        "evidence_class": "measured"
        if event_type == "BRAKING_CONFIRMED"
        else "inferred",
        "start_distance_m": round(
            finite_float(frame.iloc[start].get("distance_m")) or distance,
            3,
        ),
        "end_distance_m": round(
            finite_float(frame.iloc[end].get("distance_m")) or distance,
            3,
        ),
        "evidence": evidence,
        "channels_used": channels_used,
        "thresholds": {
            key: round(float(value), 5) if value is not None else None
            for key, value in thresholds.items()
        },
    }


def detect_hesitation_events(
    frame: pd.DataFrame,
    lap: int,
    thresholds: dict[str, float | None],
    boundaries: list[float],
) -> list[dict[str, Any]]:
    """Detect a secondary RPM fall shortly after a sustained recovery starts."""
    if "rpm_slope" not in frame:
        return []
    slope = frame["rpm_slope"].to_numpy(dtype=float)
    rising = slope >= float(thresholds["rpm_rise"])
    falling = slope <= float(thresholds["rpm_drop"])
    events: list[dict[str, Any]] = []
    last_rise: int | None = None
    for index in range(len(frame)):
        if rising[index]:
            last_rise = index
        if (
            falling[index]
            and (
                "speed_accel_mps2" not in frame
                or float(frame["speed_accel_mps2"].iloc[index]) < 0.25
            )
            and last_rise is not None
            and 0.25
            <= frame["lap_time_s"].iloc[index]
            - frame["lap_time_s"].iloc[last_rise]
            <= 1.5
        ):
            events.append(
                build_event(
                    frame,
                    lap,
                    index,
                    index,
                    "THROTTLE_HESITATION",
                    "low",
                    thresholds,
                    boundaries,
                )
            )
            last_rise = None
    return events


def find_recovery_index(
    frame: pd.DataFrame,
    start: int,
    rpm_rise_threshold: float,
) -> int | None:
    """Return the first sustained positive RPM slope after a local minimum."""
    if "rpm_slope" not in frame:
        return None
    time = frame["lap_time_s"].to_numpy(dtype=float)
    slope = frame["rpm_slope"].to_numpy(dtype=float)
    for index in range(start + 1, len(frame)):
        if time[index] - time[start] > 3.0:
            break
        if slope[index] >= rpm_rise_threshold:
            return index
    return None


def contiguous_runs(
    mask: np.ndarray,
    time: np.ndarray,
    minimum_seconds: float,
    merge_gap_seconds: float,
) -> list[tuple[int, int]]:
    """Return duration-filtered true runs while merging short interruptions."""
    indexes = np.flatnonzero(mask)
    if not len(indexes):
        return []
    runs: list[list[int]] = [[int(indexes[0]), int(indexes[0])]]
    for index in indexes[1:]:
        index = int(index)
        if time[index] - time[runs[-1][1]] <= merge_gap_seconds:
            runs[-1][1] = index
        else:
            runs.append([index, index])
    return [
        (start, end)
        for start, end in runs
        if time[end] - time[start] >= minimum_seconds
    ]


def sector_for_distance(distance: float, boundaries: list[float]) -> str:
    """Map a distance to a dynamic virtual sector label."""
    for index, boundary in enumerate(boundaries, start=1):
        if distance < boundary:
            return f"Sector {index}"
    return f"Sector {len(boundaries) + 1}"


def deduplicate_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove near-identical inferred events created by overlapping detectors."""
    result: list[dict[str, Any]] = []
    for event in events:
        duplicate = next(
            (
                existing
                for existing in result
                if existing["event_type"] == event["event_type"]
                and abs(existing["distance_m"] - event["distance_m"]) < 8.0
            ),
            None,
        )
        if duplicate is None:
            result.append(event)
    return result


def finite_series(df: pd.DataFrame, column: str) -> pd.Series:
    """Return finite numeric values for one optional channel."""
    if column not in df:
        return pd.Series(dtype=float)
    values = pd.to_numeric(df[column], errors="coerce")
    return values[np.isfinite(values)]


def quantile_or(series: pd.Series, quantile: float, default: float) -> float:
    """Return a finite quantile or a conservative default."""
    if series.empty:
        return default
    value = float(series.quantile(quantile))
    return value if np.isfinite(value) else default


def numeric_array(df: pd.DataFrame, column: str) -> np.ndarray:
    """Return an optional channel as a numeric array of matching length."""
    if column not in df:
        return np.full(len(df), np.nan)
    return pd.to_numeric(df[column], errors="coerce").to_numpy(dtype=float)


def finite_float(value: Any) -> float | None:
    """Convert a value to a finite float."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None
