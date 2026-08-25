"""Direct-channel braking episodes and conservative pattern detection."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import find_peaks


DEFAULT_BRAKING_RULES: dict[str, float] = {
    "smoothing_window_seconds": 0.08,
    "minimum_episode_seconds": 0.12,
    "merge_gap_seconds": 0.15,
    "active_fraction": 0.10,
    "minimum_peak_fraction": 0.35,
    "secondary_drop_fraction": 0.12,
    "secondary_rise_fraction": 0.12,
    "minimum_peak_separation_seconds": 0.12,
    "abrupt_release_max_seconds": 0.20,
    "abrupt_release_min_fraction": 0.45,
    "minimum_overlap_seconds": 0.10,
    "outcome_window_seconds": 1.0,
}


def analyze_braking_episodes(
    telemetry: pd.DataFrame,
    *,
    reference_lap: int,
    target_lap: int,
    sector_boundaries_m: list[float] | None = None,
    rules: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Build measured braking episodes and pair real reference/target laps."""
    config = {**DEFAULT_BRAKING_RULES, **(rules or {})}
    brake = _finite_series(telemetry, "brake")
    brake_span = _robust_span(brake)
    direct_brake = len(brake) >= 20 and brake_span > 1e-9
    direct_steering = _steering_available(telemetry)
    capabilities = {
        "direct_brake": direct_brake,
        "direct_steering": direct_steering,
        "late_reinforcement": direct_brake,
        "abrupt_release": direct_brake,
        "brake_steering_overlap": direct_brake and direct_steering,
    }
    if not direct_brake:
        return {
            "available": False,
            "reason": "A varying direct brake channel is required for braking episodes.",
            "capabilities": capabilities,
            "thresholds": {},
            "episodes": [],
            "comparisons": [],
            "evidence_boundary": _evidence_boundary(direct_steering),
        }

    baseline = float(brake.quantile(0.05))
    positive = brake[brake > baseline + max(brake_span * 0.01, 1e-9)]
    peak = float(positive.quantile(0.90)) if not positive.empty else float(brake.max())
    span = max(peak - baseline, brake_span, 1e-9)
    active_value = baseline + config["active_fraction"] * span
    release_slopes: list[float] = []
    prepared: dict[int, pd.DataFrame] = {}
    for lap_number, lap in telemetry.groupby("lap", sort=True):
        frame = _prepare_lap(lap, baseline, span, direct_steering, config)
        prepared[int(lap_number)] = frame
        if "brake_slope_normalized" in frame:
            release_slopes.extend(
                frame.loc[
                    frame["brake_slope_normalized"] < 0,
                    "brake_slope_normalized",
                ].tolist()
            )
    abrupt_slope = (
        float(np.quantile(release_slopes, 0.20))
        if release_slopes
        else -2.0
    )
    thresholds = {
        "brake_baseline": round(baseline, 6),
        "brake_peak_reference": round(peak, 6),
        "brake_active": round(active_value, 6),
        "brake_active_normalized": round(config["active_fraction"], 6),
        "abrupt_release_slope_normalized_per_s": round(abrupt_slope, 6),
    }
    episodes: list[dict[str, Any]] = []
    for lap_number, frame in prepared.items():
        episodes.extend(
            _episodes_for_lap(
                frame,
                lap_number,
                thresholds,
                config,
                sector_boundaries_m or [],
                direct_steering,
            )
        )
    comparisons = _pair_episodes(episodes, reference_lap, target_lap)
    return {
        "available": True,
        "reason": None,
        "capabilities": capabilities,
        "thresholds": thresholds,
        "episodes": episodes,
        "comparisons": comparisons,
        "evidence_boundary": _evidence_boundary(direct_steering),
    }


def _prepare_lap(
    lap: pd.DataFrame,
    baseline: float,
    span: float,
    direct_steering: bool,
    rules: dict[str, float],
) -> pd.DataFrame:
    """Smooth one lap while retaining the original measured channels."""
    frame = lap.sort_values("lap_time_s").reset_index(drop=True).copy()
    time = pd.to_numeric(frame["lap_time_s"], errors="coerce")
    dt = float(time.diff().median())
    if not np.isfinite(dt) or dt <= 0:
        dt = 0.04
    window = max(1, int(round(rules["smoothing_window_seconds"] / dt)))
    brake = pd.to_numeric(frame["brake"], errors="coerce").interpolate(
        limit_direction="both"
    )
    frame["brake_smoothed"] = brake.rolling(
        window,
        center=True,
        min_periods=1,
    ).median()
    frame["brake_normalized"] = np.clip(
        (frame["brake_smoothed"] - baseline) / span,
        0.0,
        1.5,
    )
    if len(frame) >= 3 and np.all(np.isfinite(time)):
        frame["brake_slope_normalized"] = np.gradient(
            frame["brake_normalized"].to_numpy(dtype=float),
            time.to_numpy(dtype=float),
        )
    if direct_steering:
        steering = pd.to_numeric(frame["steering_angle"], errors="coerce").interpolate(
            limit_direction="both"
        )
        straight = pd.Series(False, index=frame.index)
        if "curvature" in frame:
            curvature = pd.to_numeric(frame["curvature"], errors="coerce").abs()
            finite = curvature[np.isfinite(curvature)]
            if not finite.empty:
                straight = curvature <= float(finite.quantile(0.25))
        center_source = steering[straight] if straight.any() else steering
        center = float(center_source.median())
        demand = (steering - center).abs()
        low = float(demand.quantile(0.10))
        high = float(demand.quantile(0.90))
        threshold = low + 0.18 * max(high - low, 1e-9)
        frame["steering_centered"] = steering - center
        frame["steering_active"] = demand >= threshold
        frame.attrs["steering_threshold"] = threshold
    frame.attrs["sample_dt"] = dt
    return frame


def _episodes_for_lap(
    frame: pd.DataFrame,
    lap_number: int,
    thresholds: dict[str, float],
    rules: dict[str, float],
    boundaries: list[float],
    direct_steering: bool,
) -> list[dict[str, Any]]:
    """Segment and describe direct-brake intervals for one real lap."""
    if frame.empty:
        return []
    times = frame["lap_time_s"].to_numpy(dtype=float)
    active = frame["brake_normalized"].to_numpy(dtype=float) >= rules[
        "active_fraction"
    ]
    runs = _contiguous_runs(
        active,
        times,
        rules["minimum_episode_seconds"],
        rules["merge_gap_seconds"],
    )
    return [
        _build_episode(
            frame,
            lap_number,
            index + 1,
            start,
            end,
            thresholds,
            rules,
            boundaries,
            direct_steering,
        )
        for index, (start, end) in enumerate(runs)
    ]


def _build_episode(
    frame: pd.DataFrame,
    lap: int,
    sequence: int,
    start: int,
    end: int,
    thresholds: dict[str, float],
    rules: dict[str, float],
    boundaries: list[float],
    direct_steering: bool,
) -> dict[str, Any]:
    segment = frame.iloc[start : end + 1]
    values = segment["brake_normalized"].to_numpy(dtype=float)
    dt = float(frame.attrs.get("sample_dt", 0.04))
    peak_distance = max(1, int(round(rules["minimum_peak_separation_seconds"] / dt)))
    peaks, _ = find_peaks(values, prominence=0.08, distance=peak_distance)
    strong_peaks = [
        int(value)
        for value in peaks
        if values[int(value)] >= rules["minimum_peak_fraction"]
    ]
    first_local = strong_peaks[0] if strong_peaks else int(np.argmax(values))
    first_peak = start + first_local
    final_peak = start + strong_peaks[-1] if strong_peaks else first_peak
    release_start = _release_start(frame, final_peak, end)
    release_search_end = min(
        len(frame) - 1,
        end + max(1, int(round(0.3 / dt))),
    )
    release_complete = _release_complete(
        frame,
        release_start,
        release_search_end,
        rules,
    )
    turn_in = _turn_in_index(frame, start, end) if direct_steering else None
    overlap = _overlap_interval(frame, start, end, rules) if direct_steering else None
    patterns: list[dict[str, Any]] = []

    secondary = _secondary_peak(
        frame,
        start,
        end,
        first_peak,
        strong_peaks,
        rules,
    )
    if secondary is not None:
        patterns.append(
            _pattern(
                frame,
                lap,
                sequence,
                "BRAKE_LATE_REINFORCEMENT",
                secondary,
                ["brake"],
                {
                    "first_peak": _value(frame, first_peak, "brake"),
                    "valley": _value(frame, secondary["valley_index"], "brake"),
                    "second_peak": _value(frame, secondary["peak_index"], "brake"),
                    "drop_fraction": secondary["drop_fraction"],
                    "rise_fraction": secondary["rise_fraction"],
                },
                "medium",
            )
        )
    release_duration = float(
        frame.iloc[release_complete]["lap_time_s"]
        - frame.iloc[release_start]["lap_time_s"]
    )
    release_drop = float(
        frame.iloc[release_start]["brake_normalized"]
        - frame.iloc[release_complete]["brake_normalized"]
    )
    release_slope = float(
        frame.iloc[release_start : release_complete + 1][
            "brake_slope_normalized"
        ].min()
    )
    if (
        release_drop >= rules["abrupt_release_min_fraction"]
        and release_duration <= rules["abrupt_release_max_seconds"]
        and release_slope <= thresholds["abrupt_release_slope_normalized_per_s"]
    ):
        patterns.append(
            _pattern(
                frame,
                lap,
                sequence,
                "BRAKE_RELEASE_ABRUPT",
                {"peak_index": release_start},
                ["brake"],
                {
                    "release_duration_s": round(release_duration, 4),
                    "release_drop_fraction": round(release_drop, 4),
                    "minimum_slope_normalized_per_s": round(release_slope, 4),
                },
                "medium",
            )
        )
    if overlap is not None:
        patterns.append(
            _pattern(
                frame,
                lap,
                sequence,
                "BRAKE_STEERING_OVERLAP",
                {"peak_index": overlap[0]},
                ["brake", "steering_angle"],
                {
                    "overlap_duration_s": round(overlap[2], 4),
                    "steering_threshold": round(
                        float(frame.attrs.get("steering_threshold", 0.0)),
                        6,
                    ),
                },
                "medium",
            )
        )

    outcome_end_time = float(frame.iloc[end]["lap_time_s"]) + rules[
        "outcome_window_seconds"
    ]
    outcome = frame[
        (frame["lap_time_s"] >= frame.iloc[start]["lap_time_s"])
        & (frame["lap_time_s"] <= outcome_end_time)
    ]
    start_distance = _value(frame, start, "distance_m") or 0.0
    end_distance = _value(frame, end, "distance_m") or start_distance
    return {
        "episode_id": f"lap-{lap}-brake-{sequence}",
        "lap": lap,
        "sequence": sequence,
        "sector": _sector_for_distance(start_distance, boundaries),
        "start": _point(frame, start),
        "first_peak": _point(frame, first_peak, include_brake=True),
        "release_start": _point(frame, release_start, include_brake=True),
        "release_complete": _point(frame, release_complete, include_brake=True),
        "turn_in": _point(frame, turn_in) if turn_in is not None else None,
        "end": _point(frame, end),
        "start_distance_m": round(start_distance, 3),
        "end_distance_m": round(end_distance, 3),
        "minimum_speed": _minimum_metric(outcome, "speed"),
        "minimum_rpm": _minimum_metric(outcome, "rpm"),
        "overlap_duration_s": round(overlap[2], 4) if overlap else None,
        "patterns": patterns,
        "channels_used": [
            "brake",
            *(["steering_angle"] if direct_steering else []),
            *(["speed"] if "speed" in frame else []),
            *(["rpm"] if "rpm" in frame else []),
        ],
        "evidence_class": "measured_and_calculated",
        "confidence": "medium",
    }


def _secondary_peak(
    frame: pd.DataFrame,
    start: int,
    end: int,
    first_peak: int,
    strong_peaks: list[int],
    rules: dict[str, float],
) -> dict[str, Any] | None:
    for local_peak in strong_peaks[1:]:
        peak_index = start + local_peak
        if peak_index <= first_peak:
            continue
        elapsed = float(
            frame.iloc[peak_index]["lap_time_s"] - frame.iloc[first_peak]["lap_time_s"]
        )
        if elapsed < rules["minimum_peak_separation_seconds"]:
            continue
        valley_index = first_peak + int(
            np.argmin(
                frame.iloc[first_peak : peak_index + 1][
                    "brake_normalized"
                ].to_numpy(dtype=float)
            )
        )
        first_value = float(frame.iloc[first_peak]["brake_normalized"])
        valley_value = float(frame.iloc[valley_index]["brake_normalized"])
        second_value = float(frame.iloc[peak_index]["brake_normalized"])
        drop = first_value - valley_value
        rise = second_value - valley_value
        if (
            drop >= rules["secondary_drop_fraction"]
            and rise >= rules["secondary_rise_fraction"]
        ):
            return {
                "peak_index": peak_index,
                "valley_index": valley_index,
                "drop_fraction": round(drop, 4),
                "rise_fraction": round(rise, 4),
            }
    return None


def _release_start(frame: pd.DataFrame, peak: int, end: int) -> int:
    slope = frame["brake_slope_normalized"].to_numpy(dtype=float)
    negative = slope[np.isfinite(slope) & (slope < 0)]
    threshold = float(np.quantile(negative, 0.35)) if len(negative) else -0.1
    for index in range(peak, end + 1):
        if slope[index] <= threshold:
            return index
    return peak


def _release_complete(
    frame: pd.DataFrame,
    release_start: int,
    end: int,
    rules: dict[str, float],
) -> int:
    for index in range(release_start, end + 1):
        if float(frame.iloc[index]["brake_normalized"]) < rules["active_fraction"]:
            return index
    return end


def _turn_in_index(frame: pd.DataFrame, start: int, end: int) -> int | None:
    active = frame["steering_active"].to_numpy(dtype=bool)
    lookback = max(0, start - max(1, int(round(0.2 / frame.attrs["sample_dt"]))))
    for index in range(lookback, end + 1):
        if active[index]:
            return index
    return None


def _overlap_interval(
    frame: pd.DataFrame,
    start: int,
    end: int,
    rules: dict[str, float],
) -> tuple[int, int, float] | None:
    overlap = (
        frame["steering_active"].to_numpy(dtype=bool)
        & (frame["brake_normalized"].to_numpy(dtype=float) >= rules["active_fraction"])
    )
    times = frame["lap_time_s"].to_numpy(dtype=float)
    runs = _contiguous_runs(
        overlap[start : end + 1],
        times[start : end + 1],
        rules["minimum_overlap_seconds"],
        0.0,
    )
    if not runs:
        return None
    local_start, local_end = max(
        runs,
        key=lambda item: times[start + item[1]] - times[start + item[0]],
    )
    absolute_start = start + local_start
    absolute_end = start + local_end
    return (
        absolute_start,
        absolute_end,
        float(times[absolute_end] - times[absolute_start]),
    )


def _pattern(
    frame: pd.DataFrame,
    lap: int,
    sequence: int,
    event_type: str,
    location: dict[str, Any],
    channels: list[str],
    evidence: dict[str, Any],
    confidence: str,
) -> dict[str, Any]:
    index = int(location["peak_index"])
    point = _point(frame, index)
    return {
        "pattern_id": f"lap-{lap}-brake-{sequence}:{event_type.lower()}",
        "event_type": event_type,
        "lap": lap,
        "distance_m": point["distance_m"],
        "lap_time_s": point["lap_time_s"],
        "session_time_s": point["session_time_s"],
        "confidence": confidence,
        "evidence_class": "calculated_from_measured_channels",
        "channels_used": channels,
        "evidence": evidence,
    }


def _pair_episodes(
    episodes: list[dict[str, Any]],
    reference_lap: int,
    target_lap: int,
) -> list[dict[str, Any]]:
    reference = [item for item in episodes if item["lap"] == reference_lap]
    target = [item for item in episodes if item["lap"] == target_lap]
    pairs: list[dict[str, Any]] = []
    used: set[str] = set()
    for target_episode in target:
        candidates = [item for item in reference if item["episode_id"] not in used]
        if not candidates:
            break
        matched = min(
            candidates,
            key=lambda item: abs(
                float(item["first_peak"]["distance_m"])
                - float(target_episode["first_peak"]["distance_m"])
            ),
        )
        distance_delta = abs(
            float(matched["first_peak"]["distance_m"])
            - float(target_episode["first_peak"]["distance_m"])
        )
        if distance_delta > 40.0:
            continue
        used.add(matched["episode_id"])
        pairs.append(
            {
                "comparison_id": (
                    f"{matched['episode_id']}--{target_episode['episode_id']}"
                ),
                "reference_episode_id": matched["episode_id"],
                "target_episode_id": target_episode["episode_id"],
                "reference_lap": reference_lap,
                "target_lap": target_lap,
                "reference_focus_distance_m": matched["release_start"]["distance_m"],
                "target_focus_distance_m": target_episode["release_start"]["distance_m"],
                "peak_distance_difference_m": round(distance_delta, 3),
                "reference_pattern_types": [
                    item["event_type"] for item in matched["patterns"]
                ],
                "target_pattern_types": [
                    item["event_type"] for item in target_episode["patterns"]
                ],
            }
        )
    return pairs


def _contiguous_runs(
    mask: np.ndarray,
    times: np.ndarray,
    minimum_duration: float,
    merge_gap: float,
) -> list[tuple[int, int]]:
    raw: list[tuple[int, int]] = []
    start: int | None = None
    for index, active in enumerate(mask):
        if active and start is None:
            start = index
        if start is not None and (not active or index == len(mask) - 1):
            end = index if active and index == len(mask) - 1 else index - 1
            raw.append((start, end))
            start = None
    merged: list[tuple[int, int]] = []
    for start, end in raw:
        if merged and times[start] - times[merged[-1][1]] <= merge_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return [
        (start, end)
        for start, end in merged
        if times[end] - times[start] >= minimum_duration
    ]


def _point(
    frame: pd.DataFrame,
    index: int | None,
    *,
    include_brake: bool = False,
) -> dict[str, float | None] | None:
    if index is None:
        return None
    row = frame.iloc[index]
    point: dict[str, float | None] = {
        "distance_m": _rounded(row.get("distance_m"), 3),
        "lap_time_s": _rounded(row.get("lap_time_s"), 4),
        "session_time_s": _rounded(row.get("session_time_s"), 4),
    }
    if include_brake:
        point["brake"] = _rounded(row.get("brake"), 6)
        point["brake_normalized"] = _rounded(row.get("brake_normalized"), 4)
    return point


def _minimum_metric(frame: pd.DataFrame, column: str) -> float | None:
    values = _finite_series(frame, column)
    return round(float(values.min()), 4) if not values.empty else None


def _value(frame: pd.DataFrame, index: int, column: str) -> float | None:
    return _finite_float(frame.iloc[index].get(column))


def _rounded(value: Any, digits: int) -> float | None:
    number = _finite_float(value)
    return round(number, digits) if number is not None else None


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _finite_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame:
        return pd.Series(dtype=float)
    values = pd.to_numeric(frame[column], errors="coerce")
    return values[np.isfinite(values)]


def _robust_span(values: pd.Series) -> float:
    if values.empty:
        return 0.0
    quantile_span = float(values.quantile(0.95) - values.quantile(0.05))
    return max(quantile_span, float(values.max() - values.min()) * 0.25)


def _steering_available(frame: pd.DataFrame) -> bool:
    steering = _finite_series(frame, "steering_angle")
    return len(steering) >= 20 and _robust_span(steering) > 1e-9


def _sector_for_distance(distance: float, boundaries: list[float]) -> int:
    return int(np.searchsorted(np.asarray(boundaries), distance, side="right") + 1)


def _evidence_boundary(direct_steering: bool) -> dict[str, list[str]]:
    measured = ["Direct brake pressure or position"]
    if direct_steering:
        measured.append("Direct steering angle")
    return {
        "measured": measured,
        "calculated": [
            "Brake onset, peaks and release phases",
            "Late brake reinforcement pattern",
            "Abrupt brake release pattern",
            *(
                ["Brake and steering overlap duration"]
                if direct_steering
                else []
            ),
        ],
        "not_concluded": [
            "Whether the detected technique is correct for the corner",
            "Trail-braking quality",
            "Wheel lock-up without independent wheel speed",
        ],
    }
