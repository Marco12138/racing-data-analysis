"""Held-out GPS geometry checks, not independent camera/frame ground truth."""

import numpy as np

from .rpm_sync_verification import _sample


def verify_spatial_alignment(video_gps: list[dict], series: dict, clock_offset: float,
                             lap_timing: list[dict]) -> dict:
    """Fit translation/time on separate laps or blocks, then freeze for validation.

    Offset convention: video_time = session_time + offset. Translation moves
    camera positions into the AiM frame. Search is local to the GNSS clock and
    therefore cannot independently disambiguate an entire wrong lap.
    """
    base = {"status": "unavailable", "passed": False, "independent_ground_truth": False,
            "method": "translation_and_offset_fit_then_frozen_holdout_v1",
            "search_step_s": .05, "search_radius_s": 1.5,
            "shared_evidence": "GNSS clocks, speed and position share receivers",
            "wrong_lap_independently_excluded": False}
    if not video_gps or not {"gps_lat", "gps_lon"}.issubset(series):
        return {**base, "reason": "GNSS_GEOMETRY_UNAVAILABLE"}
    vt = np.array([p["time_s"] for p in video_gps], dtype=float)
    if len(vt) < 40 or not np.isfinite(vt).all() or (np.diff(vt) < 0).any():
        return {**base, "reason": "GNSS_GEOMETRY_TIMING_INVALID"}
    keep = np.r_[True, np.diff(vt) > 0]
    fix = np.array([p["fix"] for p in video_gps])[keep] >= 3
    vlat = np.where(fix, np.array([p["lat"] for p in video_gps])[keep], np.nan)
    vlon = np.where(fix, np.array([p["lon"] for p in video_gps])[keep], np.nan)
    vt = vt[keep]
    lt, lat = series["gps_lat"]
    nt, lon = series["gps_lon"]
    start = max(lt[0], nt[0], vt[0] - clock_offset + 1.5)
    end = min(lt[-1], nt[-1], vt[-1] - clock_offset - 1.5)
    if end - start < 60:
        return {**base, "reason": "GNSS_GEOMETRY_HOLDOUT_INSUFFICIENT"}
    q = np.arange(start, end, .5)
    alat, alon = _sample(lt, lat, q), _sample(nt, lon, q)
    valid = np.isfinite(alat) & np.isfinite(alon)
    if valid.sum() < 100:
        return {**base, "reason": "GNSS_GEOMETRY_COVERAGE_INSUFFICIENT"}
    origin = (float(np.median(alat[valid])), float(np.median(alon[valid])))
    scale = 111320 * np.cos(np.deg2rad(origin[0]))
    aim = np.column_stack([(alon-origin[1])*scale, (alat-origin[0])*111320])
    offsets = clock_offset + np.arange(-30, 31) * .05
    cameras = np.array([np.column_stack([
        (_sample(vt, vlon, q+o)-origin[1])*scale,
        (_sample(vt, vlat, q+o)-origin[0])*111320]) for o in offsets])
    # The same observed samples must score every offset; holes cannot improve a fit.
    common = valid & np.isfinite(cameras).all(axis=(0, 2))
    lap_ids = np.full(len(q), -1, dtype=int)
    eligible = [r for r in lap_timing if r["start_time_ms"]/1000 >= start
                and r["end_time_ms"]/1000 <= end and r["lap"] > 0]
    if len(eligible) >= 4:
        for index, row in enumerate(eligible):
            lap_ids[(q >= row["start_time_ms"]/1000) & (q < row["end_time_ms"]/1000)] = index
        group = lap_ids
        split = "alternating_complete_logger_laps"
    else:
        group = np.floor((q-start)/20).astype(int)
        split = "alternating_disjoint_20s_blocks"
    fit = common & (group >= 0) & (group % 2 == 0)
    held = common & (group >= 0) & (group % 2 == 1)
    coverage = float(common.sum() / len(q))
    if min(fit.sum(), held.sum()) < 40 or coverage < .7:
        return {**base, "reason": "GNSS_GEOMETRY_COVERAGE_INSUFFICIENT", "coverage": coverage}
    # Straight-only trajectories cannot separate an along-track shift from time.
    if min(np.linalg.eigvalsh(np.cov(aim[fit].T))) < 4:
        return {**base, "reason": "GNSS_GEOMETRY_LOW_EXCITATION", "coverage": coverage}
    shifts = np.median(aim[None, fit] - cameras[:, fit], axis=1)
    fit_errors = np.linalg.norm(cameras[:, fit] + shifts[:, None] - aim[None, fit], axis=2)
    scores = np.median(fit_errors, axis=1)
    best = int(np.argmin(scores))
    shift = shifts[best]
    if np.linalg.norm(shift) > 30:
        return {**base, "reason": "GNSS_GEOMETRY_TRANSLATION_EXCESSIVE", "coverage": coverage}
    errors = np.linalg.norm(cameras[best] + shift - aim, axis=1)
    held_errors = errors[held]
    windows = []
    for index in np.unique(group[held]):
        mask = held & (group == index)
        if mask.sum() < 20:
            continue
        # Diagnostic window optima never refit the translation or the reported offset.
        candidates = np.median(np.linalg.norm(cameras[:, mask] + shift - aim[None, mask], axis=2), axis=1)
        local = int(np.argmin(candidates))
        windows.append({"session_start_s": round(float(q[mask][0]), 3),
                        "session_end_s": round(float(q[mask][-1]), 3),
                        "sample_count": int(mask.sum()), "offset_s": round(float(offsets[local]), 4),
                        "median_error_m": round(float(np.median(errors[mask])), 3)})
    spread = max((abs(w["offset_s"]-offsets[best]) for w in windows), default=None)
    median, p95 = float(np.median(held_errors)), float(np.quantile(held_errors, .95))
    passed = (best not in (0, len(offsets)-1) and len(windows) >= 2 and median <= 5
              and p95 <= 12 and spread <= .25)
    # Keep true local scale, including gaps and split identity; this is a display summary.
    indexes = np.flatnonzero(common & (group >= 0))[::max(1, int(np.ceil(common.sum()/600)))]
    overlay = [{"session_time_s": round(float(q[i]), 3), "role": "fit" if fit[i] else "validation",
                "aim_xy_m": aim[i].round(3).tolist(), "camera_raw_xy_m": cameras[best, i].round(3).tolist(),
                "camera_registered_xy_m": (cameras[best, i]+shift).round(3).tolist()} for i in indexes]
    return {**base, "status": "candidate" if passed else "weak", "passed": bool(passed),
            "reason": None if passed else "GNSS_GEOMETRY_HOLDOUT_DISAGREEMENT",
            "proposed_offset_s": round(float(offsets[best]), 4), "translation_m": shift.round(4).tolist(),
            "split": split, "fit_samples": int(fit.sum()), "validation_samples": int(held.sum()),
            "coverage": round(coverage, 4), "validation_median_m": round(median, 3),
            "validation_p95_m": round(p95, 3),
            "window_offset_max_deviation_s": None if spread is None else round(float(spread), 4),
            "windows": windows, "overlay": overlay,
            "thresholds": {"median_m": 5, "p95_m": 12, "window_deviation_s": .25,
                           "minimum_coverage": .7, "calibrated": False}}
