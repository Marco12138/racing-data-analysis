"""Bounded audio/RPM synchronization candidates, never automatic truth labels."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import correlate, correlation_lags

from ..importers.native_signals import bounded_resample


MAX_GRID_POINTS = 40_000
MAX_GAP_S = 0.5
RULES = {
    "minimum_correlation": 0.70,
    "minimum_window_correlation": 0.65,
    "minimum_peak_margin": 0.03,
    "maximum_window_spread_s": 0.5,
    "distinct_peak_separation_s": 5.0,
    "minimum_overlap_ratio": 0.7,
}


def native_rpm_for_sync(record: Any, lap: int | None) -> list[dict] | None:
    """Read only the token's native RPM, preserving its original timebase."""
    path = record.native_channels_path
    channel = next((c for c in record.manifest.get("channels", [])
                    if c.get("canonical_name") == "rpm" and c.get("available")), None)
    timings = record.manifest.get("lap_timing", [])
    timings = [r for r in timings if lap is None or int(r["lap"]) == lap]
    if path is None or channel is None or not timings:
        return None
    frame = pd.read_parquet(path, filters=[("channel_id", "==", channel["channel_id"])],
                            columns=["timecode_ms", "value"])
    start = min(r["start_time_ms"] for r in timings)
    end = max(r["end_time_ms"] for r in timings)
    frame = frame[frame.timecode_ms.between(start, end)]
    if len(frame) > 500_000:
        raise ValueError("Select a shorter telemetry interval for RPM synchronization.")
    return [{"time_s": float(t)/1000, "rpm": float(v)}
            for t, v in frame.itertuples(index=False, name=None)]


def _series(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Keep invalid RPM as segment breaks; reject reversed source clocks."""
    frame = pd.DataFrame(rows, columns=["time_s", "rpm"]).astype(float)
    frame = frame[np.isfinite(frame.time_s)]
    if (np.diff(frame.time_s) < 0).any():
        raise ValueError("RPM timestamps must be monotonic.")
    frame = frame.groupby("time_s", sort=True, as_index=False).rpm.mean()
    frame.loc[~np.isfinite(frame.rpm) | (frame.rpm <= 0), "rpm"] = np.nan
    if frame.rpm.notna().sum() < 8 or len(frame) < 8:
        raise ValueError("At least 8 usable RPM points are required.")
    times = frame.time_s.to_numpy()
    if times[-1] - times[0] > 3600:
        raise ValueError("Select an RPM interval no longer than one hour.")
    return times, frame.rpm.to_numpy()


def _sample(times: np.ndarray, values: np.ndarray, query: np.ndarray) -> np.ndarray:
    """Sample the analysis grid without filling missing blocks or edges."""
    out = np.interp(query, times, values, left=np.nan, right=np.nan)
    indexes = np.searchsorted(times, query)
    inside = (indexes > 0) & (indexes < len(times))
    bad = np.zeros(len(query), dtype=bool)
    bad[inside] = times[indexes[inside]] - times[indexes[inside] - 1] > MAX_GAP_S
    out[bad] = np.nan
    return out


def _grid(rows: list[dict], step: float) -> tuple[np.ndarray, np.ndarray, dict]:
    """Anti-alias before lowering sample rate; preserve long and invalid gaps."""
    times, values = _series(rows)
    grid = np.arange(times[0], times[-1] + step * 0.01, step)
    if len(grid) > MAX_GRID_POINTS:
        raise ValueError("RPM synchronization interval exceeds the sample limit.")
    # Use the existing native-data filter but enforce this synchronizer's gap cap.
    breaks = np.flatnonzero(np.diff(times) > MAX_GAP_S)
    if len(breaks):
        times = np.insert(times, breaks + 1, times[breaks] + MAX_GAP_S / 2)
        values = np.insert(values, breaks + 1, np.nan)
    sampled, processing = bounded_resample(times, values, grid)
    return grid, sampled, processing


def _score(a: np.ndarray, b: np.ndarray, minimum: int) -> float | None:
    """Pearson coefficient over actual common samples only."""
    valid = np.isfinite(a) & np.isfinite(b)
    if valid.sum() < minimum or np.std(a[valid]) < 1 or np.std(b[valid]) < 1:
        return None
    return float(np.clip(np.corrcoef(a[valid], b[valid])[0, 1], -1, 1))


def _search(video: tuple, telemetry: tuple, step: float, lower: float,
            upper: float, min_overlap_s: float) -> list[dict]:
    """FFT Pearson search with overlap-specific means, variance and masks."""
    vt, v, _ = video
    tt, t, _ = telemetry
    vm, tm = np.isfinite(v).astype(float), np.isfinite(t).astype(float)
    v, t = np.nan_to_num(v), np.nan_to_num(t)

    def cross(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """Compute all physical-time lags in bounded FFT work."""
        return correlate(x, y, mode="full", method="fft")

    count = np.rint(cross(vm, tm))
    n = np.maximum(count, 1)
    sv, st = cross(v, tm), cross(vm, t)
    covariance = cross(v, t) - sv * st / n
    variance = np.maximum(cross(v*v, tm) - sv*sv/n, 0) * np.maximum(cross(vm, t*t) - st*st/n, 0)
    denom = np.sqrt(variance)
    scores = np.divide(covariance, denom, out=np.full_like(denom, np.nan), where=denom > 1)
    offsets = correlation_lags(len(v), len(t)) * step + vt[0] - tt[0]
    valid = (offsets >= lower) & (offsets <= upper) & (count * step >= min_overlap_s) & np.isfinite(scores)
    indexes = np.flatnonzero(valid)
    indexes = indexes[np.argsort(scores[indexes])[::-1]]
    return [{"offset_s": float(offsets[i]), "correlation": float(np.clip(scores[i], -1, 1)),
             "overlap_s": float(count[i] * step)} for i in indexes]


def _evaluate(rows: list[dict], telemetry: tuple, *, method: str, step: float,
              max_offset_s: float, selected_lap: int | None, min_overlap_s: float) -> dict:
    """Refine one method and inspect disjoint early/middle/late windows."""
    video = _grid(rows, step)
    vt, vv, processing = video
    tt, tv, _ = telemetry
    common_span = min(vt[-1] - vt[0], tt[-1] - tt[0])
    minimum = max(min_overlap_s, RULES["minimum_overlap_ratio"] * common_span)
    lower, upper = -max_offset_s, max_offset_s
    if selected_lap is not None:
        lower, upper = vt[0] - tt[-1] + minimum, vt[-1] - tt[0] - minimum
    candidates = _search(video, telemetry, step, lower, upper, minimum)
    if not candidates:
        raise ValueError("Not enough continuous, varying RPM overlap for synchronization.")
    best = candidates[0]
    offset = best["offset_s"]
    start, end = max(tt[0], vt[0]-offset), min(tt[-1], vt[-1]-offset)
    query = np.arange(start, end, step)
    actual = _sample(tt, tv, query)
    fine = np.arange(offset-step, offset+step+.001, .025)
    refined = [(o, _score(actual, _sample(vt, vv, query+o), max(8, int(minimum/step)-2))) for o in fine]
    usable = [(o, r) for o, r in refined if r is not None]
    if usable:
        offset, correlation = max(usable, key=lambda pair: pair[1])
    else:
        correlation = best["correlation"]
    alternative = next((c for c in candidates if abs(c["offset_s"]-offset) >= RULES["distinct_peak_separation_s"]), None)
    margin = correlation - alternative["correlation"] if alternative else None
    count = min(5, int((end-start) // 10))
    windows = []
    if count:
        width = min(40., (end-start)/count)
        for center in np.linspace(start+width/2, end-width/2, count):
            q = np.arange(center-width/2, center+width/2, step)
            a = _sample(tt, tv, q)
            choices = []
            for local in np.arange(offset-1.5, offset+1.501, .025):
                r = _score(a, _sample(vt, vv, q+local), max(8, int(len(q)*.8)))
                if r is not None:
                    choices.append((local, r))
            if choices:
                local, r = max(choices, key=lambda pair: pair[1])
                windows.append({"telemetry_center_s": round(float(center), 3),
                                "video_center_s": round(float(center+offset), 3),
                                "offset_s": round(float(local), 3), "correlation": round(r, 4)})
    spread = float(np.ptp([w["offset_s"] for w in windows])) if windows else None
    reasons = []
    if correlation < RULES["minimum_correlation"]:
        reasons.append("LOW_CORRELATION")
    if len(windows) < 3:
        reasons.append("INSUFFICIENT_WINDOWS")
    if windows and (min(w["correlation"] for w in windows) < RULES["minimum_window_correlation"]
                    or spread > RULES["maximum_window_spread_s"]
                    or any(abs(w["offset_s"]-offset) > 1.4 for w in windows)):
        reasons.append("WINDOW_DISAGREEMENT")
    if margin is not None and margin < RULES["minimum_peak_margin"]:
        reasons.append("REPEATED_LAP_AMBIGUITY")
    if selected_lap is not None and vt[-1]-vt[0] > 1.5*(tt[-1]-tt[0]):
        reasons.append("VIDEO_SPANS_MULTIPLE_LAPS")
    if abs(offset-lower) < step or abs(offset-upper) < step:
        reasons.append("SEARCH_BOUNDARY")
    status = "candidate" if not reasons else ("ambiguous" if any(
        code in reasons for code in ("REPEATED_LAP_AMBIGUITY", "VIDEO_SPANS_MULTIPLE_LAPS")
    ) else "weak")
    return {"method": method, "offset_ms": int(round(offset*1000)), "status": status,
            "correlation": round(float(correlation), 4), "overlap_s": round(best["overlap_s"], 3),
            "window_spread_s": round(spread, 3) if spread is not None else None,
            "windows": windows, "reasons": reasons, "alternative": alternative,
            "peak_margin": round(margin, 4) if margin is not None else None,
            "search_candidates": len(candidates), "processing": processing,
            "video_time_range_s": [float(vt[0]), float(vt[-1])],
            "searched_offset_range_ms": [round(lower*1000), round(upper*1000)]}


def verify_rpm_alignment(video_rpm: list[dict], telemetry_rpm: list[dict], *,
                         alternative_video_rpm: list[dict] | None = None,
                         audio_method: str = "dominant_band", selected_lap: int | None = None,
                         max_offset_s: float = 150, min_overlap_s: float = 15,
                         source_ambiguous: bool = False) -> dict[str, Any]:
    """Return evidence and alternatives; a candidate always requires human review."""
    vt, _ = _series(video_rpm)
    tt, _ = _series(telemetry_rpm)
    step = max(.1, float(np.median(np.diff(vt))), float(np.median(np.diff(tt))))
    if step > .5:
        raise ValueError("RPM sampling is too sparse; use a shorter video segment.")
    telemetry = _grid(telemetry_rpm, step)
    methods = [(audio_method, video_rpm)]
    if alternative_video_rpm:
        methods.append(("harmonic_product", alternative_video_rpm))
    results, failures = [], []
    for method, rows in methods:
        try:
            results.append(_evaluate(rows, telemetry, method=method, step=step,
                                    max_offset_s=max_offset_s, selected_lap=selected_lap,
                                    min_overlap_s=min_overlap_s))
        except ValueError:
            failures.append(method)
    if not results:
        raise ValueError("No audio method has enough usable RPM overlap. Check the selected lap and segment.")
    results.sort(key=lambda r: (r["status"] == "candidate", r["correlation"]), reverse=True)
    best = results[0]
    reasons = list(best["reasons"])
    if len(results) > 1 and results[1]["correlation"] >= .7 and abs(best["offset_ms"]-results[1]["offset_ms"]) > 500:
        reasons.append("AUDIO_METHOD_DISAGREEMENT")
    if source_ambiguous:
        reasons.append("MULTIPLE_AUDIO_SOURCES")
    status = best["status"] if not source_ambiguous and "AUDIO_METHOD_DISAGREEMENT" not in reasons else "ambiguous"
    confidence = float(np.clip((best["correlation"]-.3)/.7, 0, 1))
    if status != "candidate":
        confidence = min(.65, confidence)
    preview_times = np.linspace(tt[0], tt[-1], min(240, len(tt)))
    selected_rows = next(rows for method, rows in methods if method == best["method"])
    audio_grid = _grid(selected_rows, step)
    preview_audio = _sample(audio_grid[0], audio_grid[1], preview_times + best["offset_ms"]/1000)
    preview_rpm = _sample(telemetry[0], telemetry[1], preview_times)
    preview = [{"session_time_s": round(float(t), 3),
                "audio_rpm": round(float(a), 1) if np.isfinite(a) else None,
                "telemetry_rpm": round(float(r), 1) if np.isfinite(r) else None}
               for t, a, r in zip(preview_times, preview_audio, preview_rpm, strict=True)]
    return {
        "offset_ms": best["offset_ms"], "confidence": round(confidence, 3),
        "reliable": status == "candidate", "status": status,
        "requires_manual_confirmation": True, "manually_confirmed": False,
        "evidence": {"method": "audio_rpm_multi_window_v1", "selected_method": best["method"],
                     "offset_convention": "video_time_s = telemetry_session_time_s + offset_ms / 1000",
                     "confidence_kind": "heuristic_not_probability", "rules": RULES,
                     "search_scope": "selected_lap" if selected_lap is not None else "session",
                     "selected_lap": selected_lap, "best_correlation": best["correlation"],
                     "peak_margin": best["peak_margin"], "matched_overlap_s": best["overlap_s"],
                     "window_offset_spread_s": best["window_spread_s"], "windows": best["windows"],
                     "alternatives": [r for r in results[1:]], "distant_alternative": best["alternative"],
                     "failed_methods": failures, "reason_codes": reasons,
                     "search_resolution_ms": round(step*1000), "refinement_step_ms": 25,
                     "search_candidates": best["search_candidates"],
                     "searched_offset_range_ms": best["searched_offset_range_ms"],
                     "telemetry_time_range_s": [float(tt[0]), float(tt[-1])],
                     "video_time_range_s": best["video_time_range_s"],
                     "preview": preview,
                     "telemetry_processing": telemetry[2], "audio_processing": best["processing"],
                     "drift_correction_applied": False, "gap_limit_s": MAX_GAP_S},
        "warnings": ["Candidate only. Confirm the lap and shared visual events before coaching.",
                     "Correlation, search resolution and window spread are not measured synchronization accuracy."],
    }
