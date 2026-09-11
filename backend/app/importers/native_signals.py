"""Native XRK timebases and bounded, anti-aliased display resampling."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import butter, sosfiltfilt


def native_frame(table: Any, name: str) -> pd.DataFrame:
    """Preserve sample order, duplicate timestamps, invalid values and zeros."""
    data = table.to_pydict()
    return pd.DataFrame({
        "sample_index": np.arange(len(data[name])),
        "timecode_ms": pd.to_numeric(pd.Series(data["timecodes"]), errors="coerce"),
        "value": pd.to_numeric(pd.Series(data[name]), errors="coerce"),
    })


def timestamp_quality(frame: pd.DataFrame) -> dict[str, Any]:
    """Describe native timing before any sorting, filtering or deduplication."""
    times = frame["timecode_ms"].to_numpy(dtype=float) / 1000
    values = frame["value"].to_numpy(dtype=float)
    dt = np.diff(times[np.isfinite(times)])
    positive = dt[dt > 0]
    median_dt = float(np.median(positive)) if len(positive) else None
    limit = max(0.5, 5 * median_dt) if median_dt else 0.5
    return {
        "native_sample_rate_hz": 1 / median_dt if median_dt else None,
        "duplicate_timestamp_count": int(np.sum(dt == 0)),
        "backward_timestamp_count": int(np.sum(dt < 0)),
        "invalid_sample_count": int(np.sum(~np.isfinite(times) | ~np.isfinite(values))),
        "long_gap_count": int(np.sum(dt > limit)),
        "gap_limit_s": limit,
        "max_positive_gap_s": float(positive.max()) if len(positive) else None,
    }


def save_native_channels(log: Any, descriptions: list[dict[str, Any]], path: Path) -> int:
    """Store each raw numeric channel on its own timebase under the token TTL."""
    frames = []
    for description in descriptions:
        try:
            frame = native_frame(log.channels[description["name"]], description["name"])
        except (KeyError, TypeError, ValueError):
            continue
        frame.insert(0, "channel_id", description["channel_id"])
        frames.append(frame)
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
        columns=["channel_id", "sample_index", "timecode_ms", "value"]
    )
    combined.to_parquet(path, index=False)
    return len(combined)


def bounded_resample(
    source_times_s: np.ndarray,
    values: np.ndarray,
    target_times_s: np.ndarray,
    *,
    discrete: bool = False,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Resample finite contiguous segments; never extrapolate or bridge long gaps.

    Continuous downsampling uses a sixth-order zero-phase Butterworth filter
    at 0.4 times the destination rate. Short segments cannot safely be filtered
    and are left unavailable. Native data is never modified by this operation.
    """
    target = np.asarray(target_times_s, dtype=float)
    out = np.full(len(target), np.nan)
    source = pd.DataFrame({"t": source_times_s, "v": values})
    source = source.replace([np.inf, -np.inf], np.nan).dropna(subset=["t"])
    source = source.sort_values("t").groupby("t", as_index=False)["v"].mean()
    t, v = source["t"].to_numpy(), source["v"].to_numpy()
    positive = np.diff(t)
    source_dt = float(np.median(positive[positive > 0])) if np.any(positive > 0) else None
    target_diff = np.diff(np.unique(target[np.isfinite(target)]))
    target_dt = float(np.median(target_diff)) if len(target_diff) else None
    gap_limit = max(0.5, 5 * source_dt) if source_dt else 0.5
    downsample = bool(source_dt and target_dt and target_dt > source_dt * 1.1 and not discrete)
    details = {
        "method": "previous_sample" if discrete else "linear_within_contiguous_segments",
        "time_domain": "session_seconds", "extrapolation": False,
        "gap_limit_s": gap_limit, "duplicate_policy": "mean_for_display_only",
        "anti_alias_filter": "butterworth_order6_zero_phase" if downsample else None,
        "cutoff_hz": 0.4 / target_dt if downsample else None,
        "short_segments_dropped": 0,
    }
    # Invalid source rows deliberately split segments instead of disappearing.
    start = 0
    for end in range(len(t) + 1):
        boundary = end == len(t) or not np.isfinite(v[end]) or (
            end > start and t[end] - t[end - 1] > gap_limit
        )
        if not boundary:
            continue
        ts, vs = t[start:end], v[start:end]
        if len(ts):
            mask = np.isfinite(target) & (target >= ts[0]) & (target <= ts[-1])
            if downsample:
                if len(ts) < 24:
                    details["short_segments_dropped"] += 1
                    start = end if end < len(t) and np.isfinite(v[end]) else end + 1
                    continue
                uniform = np.linspace(ts[0], ts[-1], len(ts))
                rate = (len(ts) - 1) / (ts[-1] - ts[0])
                if rate <= 2 * details["cutoff_hz"]:
                    details["short_segments_dropped"] += 1
                    start = end if end < len(t) and np.isfinite(v[end]) else end + 1
                    continue
                sos = butter(6, details["cutoff_hz"], fs=rate, output="sos")
                vs = sosfiltfilt(sos, np.interp(uniform, ts, vs))
                ts = uniform
            if discrete:
                out[mask] = vs[np.searchsorted(ts, target[mask], side="right") - 1]
            else:
                out[mask] = np.interp(target[mask], ts, vs)
        start = end if end < len(t) and np.isfinite(v[end]) else end + 1
    details["unavailable_output_samples"] = int(np.sum(~np.isfinite(out)))
    return out, details
