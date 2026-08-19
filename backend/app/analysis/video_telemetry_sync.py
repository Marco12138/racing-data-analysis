"""Estimate a coarse video-to-telemetry offset from bounded feature summaries."""

from __future__ import annotations

from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd


MIN_FEATURE_POINTS = 8
MAX_SEARCH_CANDIDATES = 5_001
RELIABLE_CONFIDENCE = 0.7


def estimate_video_telemetry_offset(
    video_features: Iterable[Mapping[str, float]],
    telemetry_speed: Iterable[Mapping[str, float]],
    *,
    max_offset_s: float = 300.0,
    search_step_s: float = 0.25,
    min_overlap_s: float = 5.0,
) -> dict[str, Any]:
    """Search for the offset that best aligns visual changes with deceleration.

    The offset convention is ``video time = telemetry session time + offset``.
    This is a coarse, heuristic estimate: it does not inspect video files and it
    never claims frame-accurate synchronization.
    """
    video = _clean_points(video_features, ("time_s", "brightness", "motion"))
    telemetry = _clean_points(telemetry_speed, ("time_s", "speed_kmh"))
    _validate_series(video, "video feature")
    _validate_series(telemetry, "telemetry speed")

    video_signal = _video_change_signal(video)
    telemetry_signal = _deceleration_signal(telemetry)
    video_events = _event_times(video["time_s"].to_numpy(), video_signal)
    telemetry_events = _event_times(
        telemetry["time_s"].to_numpy(), telemetry_signal
    )

    candidates: list[dict[str, float]] = []
    candidate_count = int(np.floor((2 * max_offset_s) / search_step_s)) + 1
    if candidate_count > MAX_SEARCH_CANDIDATES:
        raise ValueError(
            f"Offset search exceeds the {MAX_SEARCH_CANDIDATES:,}-candidate limit."
        )
    offsets = np.arange(
        -float(max_offset_s),
        float(max_offset_s) + search_step_s * 0.5,
        float(search_step_s),
    )
    telemetry_times = telemetry["time_s"].to_numpy(dtype=float)
    video_times = video["time_s"].to_numpy(dtype=float)
    for offset in offsets:
        query_times = telemetry_times + offset
        overlap = (query_times >= video_times[0]) & (query_times <= video_times[-1])
        if int(overlap.sum()) < MIN_FEATURE_POINTS:
            continue
        overlap_times = telemetry_times[overlap]
        overlap_span = float(overlap_times[-1] - overlap_times[0])
        if overlap_span < min_overlap_s:
            continue
        sampled_video = np.interp(
            query_times[overlap], video_times, video_signal
        )
        sampled_telemetry = telemetry_signal[overlap]
        correlation = _correlation(sampled_video, sampled_telemetry)
        if correlation is None:
            continue
        candidates.append(
            {
                "offset_s": float(offset),
                "correlation": correlation,
                "overlap_s": overlap_span,
                "overlap_points": float(overlap.sum()),
            }
        )

    if not candidates:
        raise ValueError(
            "Video features and telemetry speed do not have enough searchable overlap."
        )

    candidates.sort(key=lambda row: row["correlation"], reverse=True)
    best = candidates[0]
    runner_up = next(
        (
            row
            for row in candidates[1:]
            if abs(row["offset_s"] - best["offset_s"])
            >= max(1.0, search_step_s * 4)
        ),
        None,
    )
    second_correlation = runner_up["correlation"] if runner_up else 0.0
    peak_margin = max(0.0, best["correlation"] - second_correlation)
    common_span = min(
        float(video_times[-1] - video_times[0]),
        float(telemetry_times[-1] - telemetry_times[0]),
    )
    overlap_ratio = min(1.0, best["overlap_s"] / max(common_span, 1e-9))

    correlation_score = float(np.clip((best["correlation"] - 0.15) / 0.65, 0, 1))
    uniqueness_score = float(np.clip(peak_margin / 0.15, 0, 1))
    event_score = min(1.0, min(len(video_events), len(telemetry_events)) / 3.0)
    confidence = float(
        np.clip(
            0.65 * correlation_score
            + 0.15 * overlap_ratio
            + 0.10 * uniqueness_score
            + 0.10 * event_score,
            0,
            1,
        )
    )
    if len(telemetry_events) < 2 or len(video_events) < 2:
        confidence = min(confidence, 0.65)
    reliable = confidence >= RELIABLE_CONFIDENCE
    warnings = [
        "Automatic alignment is coarse and must be verified against a visible lap marker."
    ]
    if not reliable:
        warnings.append(
            "Automatic alignment is unreliable; use the manual video T = telemetry D calibration."
        )
    if len(telemetry_events) < 2 or len(video_events) < 2:
        warnings.append(
            "Few distinct events were available, so the offset is weakly constrained."
        )

    return {
        "offset_ms": int(round(best["offset_s"] * 1000)),
        "confidence": round(confidence, 3),
        "reliable": reliable,
        "evidence": {
            "method": "visual_change_to_gps_deceleration_cross_correlation",
            "offset_convention": "video_time_s = telemetry_session_time_s + offset_ms / 1000",
            "video_feature_points": int(len(video)),
            "telemetry_speed_points": int(len(telemetry)),
            "video_change_events": len(video_events),
            "telemetry_deceleration_events": len(telemetry_events),
            "matched_overlap_s": round(best["overlap_s"], 3),
            "overlap_ratio": round(overlap_ratio, 3),
            "best_correlation": round(best["correlation"], 4),
            "next_distinct_correlation": round(second_correlation, 4),
            "peak_margin": round(peak_margin, 4),
            "search_resolution_ms": int(round(search_step_s * 1000)),
            "reliable_confidence_threshold": RELIABLE_CONFIDENCE,
            "searched_offset_range_ms": [
                -int(round(max_offset_s * 1000)),
                int(round(max_offset_s * 1000)),
            ],
        },
        "warnings": warnings,
    }


def telemetry_speed_summary(
    telemetry: pd.DataFrame,
    *,
    max_points: int = 5_000,
) -> list[dict[str, float]]:
    """Extract a bounded real GPS-speed summary from normalized telemetry."""
    required = {"session_time_s", "speed"}
    if not required.issubset(telemetry.columns):
        raise ValueError("GPS speed is unavailable for this inspection.")
    frame = telemetry[["session_time_s", "speed"]].copy()
    frame.columns = ["time_s", "speed_kmh"]
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
    frame = frame[frame["speed_kmh"] >= 0]
    if len(frame) > max_points:
        indexes = np.linspace(0, len(frame) - 1, max_points, dtype=int)
        frame = frame.iloc[np.unique(indexes)]
    return [
        {"time_s": float(row.time_s), "speed_kmh": float(row.speed_kmh)}
        for row in frame.itertuples(index=False)
    ]


def telemetry_rpm_summary(
    telemetry: pd.DataFrame,
    *,
    max_points: int = 5_000,
) -> list[dict[str, float]]:
    """Extract a bounded real RPM summary from normalized telemetry."""
    required = {"session_time_s", "rpm"}
    if not required.issubset(telemetry.columns):
        raise ValueError("RPM is unavailable for this inspection.")
    frame = telemetry[["session_time_s", "rpm"]].copy()
    frame.columns = ["time_s", "rpm"]
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
    frame = frame[frame["rpm"] > 0]
    if len(frame) > max_points:
        indexes = np.linspace(0, len(frame) - 1, max_points, dtype=int)
        frame = frame.iloc[np.unique(indexes)]
    return [
        {"time_s": float(row.time_s), "rpm": float(row.rpm)}
        for row in frame.itertuples(index=False)
    ]


def estimate_video_telemetry_rpm_offset(
    video_rpm: Iterable[Mapping[str, float]],
    telemetry_rpm: Iterable[Mapping[str, float]],
    *,
    max_offset_s: float = 300.0,
    search_step_s: float = 0.25,
    min_overlap_s: float = 5.0,
) -> dict[str, Any]:
    """Search the offset that best aligns audio-derived RPM with telemetry RPM.

    Both series measure the same physical quantity (engine speed), so a
    cross-correlation peak is a strong alignment cue for recordings from the
    same session. The offset convention matches ``video time = telemetry
    session time + offset``.
    """
    video = _clean_points(video_rpm, ("time_s", "rpm"))
    telemetry = _clean_points(telemetry_rpm, ("time_s", "rpm"))
    _validate_series(video, "video rpm")
    _validate_series(telemetry, "telemetry rpm")

    video_times = video["time_s"].to_numpy(dtype=float)
    telemetry_times = telemetry["time_s"].to_numpy(dtype=float)
    video_signal = _smooth(video["rpm"].to_numpy(dtype=float))
    telemetry_signal = _smooth(telemetry["rpm"].to_numpy(dtype=float))
    video_events = _event_times(video_times, _rpm_drop_signal(video))
    telemetry_events = _event_times(
        telemetry_times, _rpm_drop_signal(telemetry)
    )

    candidate_count = int(np.floor((2 * max_offset_s) / search_step_s)) + 1
    if candidate_count > MAX_SEARCH_CANDIDATES:
        raise ValueError(
            f"Offset search exceeds the {MAX_SEARCH_CANDIDATES:,}-candidate limit."
        )
    offsets = np.arange(
        -float(max_offset_s),
        float(max_offset_s) + search_step_s * 0.5,
        float(search_step_s),
    )
    candidates: list[dict[str, float]] = []
    for offset in offsets:
        query_times = telemetry_times + offset
        overlap = (query_times >= video_times[0]) & (
            query_times <= video_times[-1]
        )
        if int(overlap.sum()) < MIN_FEATURE_POINTS:
            continue
        overlap_times = telemetry_times[overlap]
        overlap_span = float(overlap_times[-1] - overlap_times[0])
        if overlap_span < min_overlap_s:
            continue
        sampled_video = np.interp(
            query_times[overlap], video_times, video_signal
        )
        sampled_telemetry = telemetry_signal[overlap]
        correlation = _correlation(sampled_video, sampled_telemetry)
        if correlation is None:
            continue
        candidates.append(
            {
                "offset_s": float(offset),
                "correlation": correlation,
                "overlap_s": overlap_span,
                "overlap_points": float(overlap.sum()),
            }
        )

    if not candidates:
        raise ValueError(
            "Video RPM and telemetry RPM do not have enough searchable overlap."
        )

    candidates.sort(key=lambda row: row["correlation"], reverse=True)
    best = candidates[0]
    runner_up = next(
        (
            row
            for row in candidates[1:]
            if abs(row["offset_s"] - best["offset_s"])
            >= max(1.0, search_step_s * 4)
        ),
        None,
    )
    second_correlation = runner_up["correlation"] if runner_up else 0.0
    peak_margin = max(0.0, best["correlation"] - second_correlation)
    common_span = min(
        float(video_times[-1] - video_times[0]),
        float(telemetry_times[-1] - telemetry_times[0]),
    )
    overlap_ratio = min(1.0, best["overlap_s"] / max(common_span, 1e-9))

    correlation_score = float(
        np.clip((best["correlation"] - 0.3) / 0.55, 0, 1)
    )
    uniqueness_score = float(np.clip(peak_margin / 0.15, 0, 1))
    event_score = min(
        1.0, min(len(video_events), len(telemetry_events)) / 3.0
    )
    confidence = float(
        np.clip(
            0.65 * correlation_score
            + 0.15 * overlap_ratio
            + 0.10 * uniqueness_score
            + 0.10 * event_score,
            0,
            1,
        )
    )
    if len(telemetry_events) < 2 or len(video_events) < 2:
        confidence = min(confidence, 0.65)
    reliable = confidence >= RELIABLE_CONFIDENCE
    warnings = [
        "Automatic alignment is coarse and must be verified against a visible lap marker."
    ]
    if not reliable:
        warnings.append(
            "Automatic alignment is unreliable; use the manual video T = telemetry D calibration."
        )
    if len(telemetry_events) < 2 or len(video_events) < 2:
        warnings.append(
            "Few distinct RPM drops were available, so the offset is weakly constrained."
        )

    return {
        "offset_ms": int(round(best["offset_s"] * 1000)),
        "confidence": round(confidence, 3),
        "reliable": reliable,
        "evidence": {
            "method": "audio_rpm_to_telemetry_rpm_cross_correlation",
            "offset_convention": "video_time_s = telemetry_session_time_s + offset_ms / 1000",
            "video_rpm_points": int(len(video)),
            "telemetry_rpm_points": int(len(telemetry)),
            "video_rpm_drop_events": len(video_events),
            "telemetry_rpm_drop_events": len(telemetry_events),
            "matched_overlap_s": round(best["overlap_s"], 3),
            "overlap_ratio": round(overlap_ratio, 3),
            "best_correlation": round(best["correlation"], 4),
            "next_distinct_correlation": round(second_correlation, 4),
            "peak_margin": round(peak_margin, 4),
            "search_resolution_ms": int(round(search_step_s * 1000)),
            "reliable_confidence_threshold": RELIABLE_CONFIDENCE,
            "searched_offset_range_ms": [
                -int(round(max_offset_s * 1000)),
                int(round(max_offset_s * 1000)),
            ],
        },
        "warnings": warnings,
    }


def _clean_points(
    points: Iterable[Mapping[str, float]],
    columns: tuple[str, ...],
) -> pd.DataFrame:
    frame = pd.DataFrame(points, columns=columns)
    if frame.empty:
        return frame
    for column in columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
    frame = frame[frame["time_s"] >= 0]
    frame = frame.sort_values("time_s")
    frame = frame.groupby("time_s", as_index=False).mean(numeric_only=True)
    return frame.reset_index(drop=True)


def _validate_series(frame: pd.DataFrame, label: str) -> None:
    if len(frame) < MIN_FEATURE_POINTS:
        raise ValueError(f"At least {MIN_FEATURE_POINTS} valid {label} points are required.")
    if float(frame["time_s"].iloc[-1] - frame["time_s"].iloc[0]) <= 0:
        raise ValueError(f"The {label} timeline must span more than zero seconds.")


def _video_change_signal(video: pd.DataFrame) -> np.ndarray:
    times = video["time_s"].to_numpy(dtype=float)
    brightness = _smooth(video["brightness"].to_numpy(dtype=float))
    motion = _smooth(video["motion"].to_numpy(dtype=float))
    brightness_rate = np.abs(np.gradient(brightness, times))
    signal = 0.55 * _positive_robust_scale(motion) + 0.45 * _positive_robust_scale(
        brightness_rate
    )
    return _smooth(signal)


def _deceleration_signal(telemetry: pd.DataFrame) -> np.ndarray:
    times = telemetry["time_s"].to_numpy(dtype=float)
    speed = _smooth(telemetry["speed_kmh"].to_numpy(dtype=float))
    deceleration = np.maximum(-np.gradient(speed, times), 0.0)
    return _smooth(_positive_robust_scale(deceleration))


def _rpm_drop_signal(telemetry: pd.DataFrame) -> np.ndarray:
    """Positive RPM-drop magnitude used to count distinct lift/brake events."""
    times = telemetry["time_s"].to_numpy(dtype=float)
    rpm = _smooth(telemetry["rpm"].to_numpy(dtype=float))
    drop = np.maximum(-np.gradient(rpm, times), 0.0)
    return _smooth(_positive_robust_scale(drop))


def _smooth(values: np.ndarray) -> np.ndarray:
    if len(values) < 5:
        return values.astype(float)
    return (
        pd.Series(values, dtype=float)
        .rolling(window=5, center=True, min_periods=1)
        .median()
        .to_numpy()
    )


def _positive_robust_scale(values: np.ndarray) -> np.ndarray:
    finite = np.asarray(values, dtype=float)
    median = float(np.median(finite))
    mad = float(np.median(np.abs(finite - median)))
    scale = max(1.4826 * mad, float(np.std(finite)) * 0.25, 1e-9)
    return np.clip((finite - median) / scale, 0.0, 8.0)


def _event_times(times: np.ndarray, signal: np.ndarray) -> list[float]:
    threshold = max(float(np.quantile(signal, 0.85)), 0.5)
    events: list[float] = []
    for index in range(1, len(signal) - 1):
        if signal[index] < threshold:
            continue
        if signal[index] < signal[index - 1] or signal[index] < signal[index + 1]:
            continue
        event_time = float(times[index])
        if not events or event_time - events[-1] >= 1.0:
            events.append(event_time)
        elif signal[index] > signal[int(np.argmin(np.abs(times - events[-1])))]:
            events[-1] = event_time
    return events


def _correlation(first: np.ndarray, second: np.ndarray) -> float | None:
    if len(first) < MIN_FEATURE_POINTS:
        return None
    first_std = float(np.std(first))
    second_std = float(np.std(second))
    if first_std <= 1e-9 or second_std <= 1e-9:
        return None
    value = float(np.corrcoef(first, second)[0, 1])
    return value if np.isfinite(value) else None
