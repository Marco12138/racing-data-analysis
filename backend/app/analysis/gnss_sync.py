"""Experimental GNSS clock candidates; no video upload or body-frame inference."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

from .rpm_sync_verification import _sample
from ..importers.xrk_inspection import convert_units

GPS_EPOCH = datetime(1980, 1, 6, tzinfo=UTC).timestamp()
WEEK_S = 604800
LEAP_DATES = (
    "1981-07-01", "1982-07-01", "1983-07-01", "1985-07-01",
    "1988-01-01", "1990-01-01", "1991-01-01", "1992-07-01",
    "1993-07-01", "1994-07-01", "1996-01-01", "1997-07-01",
    "1999-01-01", "2006-01-01", "2009-01-01", "2012-07-01",
    "2015-07-01", "2017-01-01",
)


def gps_utc_offset(utc_s: float) -> int:
    """Historical GPS-minus-UTC seconds, not a timezone correction."""
    return sum(utc_s >= datetime.fromisoformat(d).replace(tzinfo=UTC).timestamp()
               for d in LEAP_DATES)


def read_gnss_reference(record: Any) -> dict:
    """Read only native channels owned by an unexpired inspection token."""
    if record.native_channels_path is None:
        raise ValueError("GNSS_NATIVE_CACHE_UNAVAILABLE")
    channels = record.manifest.get("channels", [])
    wanted = {"speed", "gps_lat", "gps_lon", "gps_fix"}
    selected = [c for c in channels if c.get("available") and (
        (c.get("canonical_name") in wanted and c.get("source") == "gps_receiver")
        or c.get("normalized_name") == "timtpitow")]
    if not any(c.get("normalized_name") == "timtpitow" for c in selected):
        raise ValueError("AIM_TOW_UNAVAILABLE")
    frame = pd.read_parquet(record.native_channels_path,
                            filters=[("channel_id", "in", [c["channel_id"] for c in selected])],
                            columns=["channel_id", "timecode_ms", "value"])
    if len(frame) > 1_000_000:
        raise ValueError("GNSS_SAMPLE_LIMIT")
    series = {}
    for channel in selected:
        data = frame[frame.channel_id == channel["channel_id"]]
        key = "tow" if channel.get("normalized_name") == "timtpitow" else channel["canonical_name"]
        if key in series:
            continue
        values = data.value.to_numpy(dtype=float)
        if key == "tow":
            if channel.get("unit") != "ms":
                raise ValueError("AIM_TOW_UNIT_UNSUPPORTED")
            values = values / 1000
        else:
            values = convert_units(key, values, channel.get("unit"))
        series[key] = (data.timecode_ms.to_numpy(dtype=float)/1000, values)
    sources = [{"name": c.get("name"), "canonical_name": c.get("canonical_name"),
                "unit": c.get("unit"), "source": c.get("source"), "timebase": "native_timecode_ms"}
               for c in selected]
    return {"series": series, "source_channels": sources, "metadata": record.manifest.get("metadata", {}),
            "lap_timing": record.manifest.get("lap_timing", [])}


def _ordered(times: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Reject clock reversal and excessive spans; preserve invalid-value gaps."""
    if len(times) < 8 or not np.isfinite(times).all() or np.any(np.diff(times) < 0):
        raise ValueError("GNSS_CLOCK_NONMONOTONIC")
    keep = np.r_[True, np.diff(times) > 0]
    times, values = times[keep], values[keep]
    if len(times) < 8 or times[-1]-times[0] > 3600:
        raise ValueError("GNSS_INTERVAL_LIMIT")
    return times, values


def _clock(times: np.ndarray, utc: np.ndarray) -> dict:
    """Fit alternating 30s blocks; report separate held-out clock residuals."""
    good = np.isfinite(utc)
    t, u = times[good], utc[good]
    if len(t) < 20 or t[-1]-t[0] < 30:
        raise ValueError("GNSS_CLOCK_INSUFFICIENT")
    if np.any(np.diff(u) < 0) or np.ptp(u) < 20:
        raise ValueError("GNSS_CLOCK_UNSTABLE")
    train = (np.floor((t-t[0])/30).astype(int) % 2) == 0
    if train.all() or (~train).sum() < 8:
        raise ValueError("GNSS_CLOCK_INSUFFICIENT")
    # Center epoch-sized timestamps for stable regression. Drift is measured,
    # not applied to the player's constant-offset calibration.
    delta = u-t
    slope, centered = np.polyfit(t[train]-t[0], delta[train]-delta[train][0], 1)
    intercept = delta[train][0]+centered-slope*t[0]
    residual = delta[~train]-(intercept+slope*t[~train])
    return {"intercept_utc_s": float(intercept), "median_epoch_s": float(np.median(delta[train])),
            "rate_error_ppm": round(float(slope*1e6), 3),
            "validation_rms_s": round(float(np.sqrt(np.mean(residual**2))), 6),
            "validation_max_s": round(float(np.max(np.abs(residual))), 6),
            "train_samples": int(train.sum()), "validation_samples": int((~train).sum()),
            "split": "alternating_30s_blocks", "span_s": round(float(t[-1]-t[0]), 3)}


def _correlation(a: np.ndarray, b: np.ndarray) -> float | None:
    """Score actual, varying common speed samples only."""
    good = np.isfinite(a) & np.isfinite(b)
    if good.sum() < 40 or np.std(a[good]) < 3 or np.std(b[good]) < 3:
        return None
    return float(np.corrcoef(a[good], b[good])[0, 1])


def _fixed_series(reference: dict, key: str) -> tuple[np.ndarray, np.ndarray]:
    """Mask AiM GPS with nearby native fix states; never interpolate fix enums."""
    t, values = _ordered(*reference["series"][key])
    if "gps_fix" not in reference["series"]:
        return t, values
    ft, fv = _ordered(*reference["series"]["gps_fix"])
    right = np.clip(np.searchsorted(ft, t), 0, len(ft)-1)
    left = np.maximum(right-1, 0)
    index = np.where(np.abs(ft[left]-t) < np.abs(ft[right]-t), left, right)
    valid = (np.abs(ft[index]-t) <= .25) & (fv[index] >= 3)
    return t, np.where(valid, values, np.nan)


def verify_gnss_alignment(video_clock: list[dict], video_gps: list[dict], reference: dict) -> dict:
    """Locate recording overlap by GNSS, check speed on held-out intervals."""
    reasons = ["AIM_TIME_VALIDITY_UNEXPOSED", "SENSOR_VIDEO_LATENCY_UNCALIBRATED"]
    vt, vu = _ordered(np.array([r["time_s"] for r in video_clock]),
                      np.array([r["utc_s"] if r["fix"] >= 3 else np.nan for r in video_clock]))
    usable = vu[np.isfinite(vu)]
    if not len(usable):
        raise ValueError("GOPRO_GPS_FIX_UNAVAILABLE")
    date = datetime.fromtimestamp(float(np.median(usable)), UTC)
    try:
        log_date = datetime.strptime(reference["metadata"]["Log Date"], "%m/%d/%Y").replace(tzinfo=UTC)
    except (KeyError, TypeError, ValueError):
        raise ValueError("AIM_SESSION_DATE_UNAVAILABLE") from None
    if abs((date.date()-log_date.date()).days) > 1:
        raise ValueError("GNSS_SESSION_DATE_MISMATCH")
    if date < datetime(1980, 1, 6, tzinfo=UTC) or date > datetime.now(UTC)+timedelta(days=1):
        raise ValueError("GNSS_DATE_UNSUPPORTED")
    if "tow" not in reference["series"]:
        raise ValueError("AIM_TOW_UNAVAILABLE")
    if "gps_fix" not in reference["series"]:
        reasons.append("AIM_GPS_FIX_UNAVAILABLE")
    tt, tow = _fixed_series(reference, "tow")
    valid = np.isfinite(tow) & (tow > 0) & (tow < WEEK_S)
    if valid.sum() < 20:
        raise ValueError("AIM_TOW_UNAVAILABLE")
    # A rollover is accepted only at the actual GPS week boundary.
    jumps = np.diff(tow[valid])
    if np.any((jumps < 0) & (jumps > -WEEK_S*.9)):
        raise ValueError("AIM_TOW_RESET")
    unwrapped = np.unwrap(tow[valid]*2*np.pi/WEEK_S)*WEEK_S/(2*np.pi)
    anchor_utc = float(np.median(usable))
    leap = gps_utc_offset(anchor_utc)
    week = round((anchor_utc+leap-GPS_EPOCH-float(np.median(unwrapped)))/WEEK_S)
    aim_utc = np.full_like(tow, np.nan)
    aim_utc[valid] = GPS_EPOCH+week*WEEK_S+unwrapped-leap
    camera, aim = _clock(vt, vu), _clock(tt, aim_utc)
    clock_offset = aim["median_epoch_s"]-camera["median_epoch_s"]
    positive_steps = jumps[(jumps > 0) & (jumps < 5)]
    quantization = float(np.median(positive_steps)) if len(positive_steps) else None
    if quantization and np.mean(jumps == 0) > .25:
        reasons.append("AIM_TOW_QUANTIZED")
    if camera["validation_max_s"] > .5 or aim["validation_max_s"] > 1.5:
        raise ValueError("GNSS_CLOCK_UNSTABLE")
    relative_drift_s = abs(aim["rate_error_ppm"]-camera["rate_error_ppm"])*min(aim["span_s"], camera["span_s"])/1e6
    if relative_drift_s > .2:
        reasons.append("CLOCK_DRIFT_REQUIRES_ANCHORS")
    offset = clock_offset
    windows, speed_check, spatial = [], {}, {}
    gps = pd.DataFrame(video_gps)
    if not gps.empty and "speed" in reference["series"]:
        gt, gs = _ordered(gps.time_s.to_numpy(), gps.speed_kmh.to_numpy())
        gs = np.where(gps.fix.to_numpy()[np.r_[True, np.diff(gps.time_s) > 0]] >= 3, gs, np.nan)
        st, ss = _fixed_series(reference, "speed")
        start, end = max(st[0], gt[0]-offset), min(st[-1], gt[-1]-offset)
        for index, a in enumerate(np.arange(start+2, end-17, 20)):
            q = np.arange(a, min(a+18, end-2), .2)
            speed = _sample(st, ss, q)
            candidates = [(float(o), _correlation(speed, _sample(gt, gs, q+o)))
                          for o in np.arange(clock_offset-2, clock_offset+2.001, .05)]
            candidates = [(o, r) for o, r in candidates if r is not None]
            if candidates:
                o, r = max(candidates, key=lambda item: item[1])
                windows.append({"session_center_s": round(float(np.mean(q)), 3),
                                "offset_s": round(o, 3), "correlation": round(r, 4),
                                "role": "fit" if index % 2 == 0 else "validation"})
        fit = [w for w in windows if w["role"] == "fit" and w["correlation"] >= .8]
        held = [w for w in windows if w["role"] == "validation"]
        if len(fit) >= 2 and len(held) >= 2:
            proposed = float(np.median([w["offset_s"] for w in fit]))
            residuals = [abs(w["offset_s"]-proposed) for w in held]
            passed = max(residuals) <= .25 and min(w["correlation"] for w in held) >= .8 and abs(proposed-clock_offset) < 1.8
            speed_check = {"passed": passed, "proposed_offset_s": proposed,
                           "validation_max_residual_s": round(max(residuals), 4),
                           "validation_samples": len(held), "fit_samples": len(fit)}
            if passed:
                offset = proposed
            else:
                reasons.append("GNSS_SPEED_DISAGREEMENT")
        else:
            reasons.append("GNSS_SPEED_VALIDATION_INSUFFICIENT")
        if {"gps_lat", "gps_lon"}.issubset(reference["series"]):
            q = np.arange(max(st[0], gt[0]-offset), min(st[-1], gt[-1]-offset), .5)
            lat = _sample(*_fixed_series(reference, "gps_lat"), q)
            lon = _sample(*_fixed_series(reference, "gps_lon"), q)
            vg = gps.drop_duplicates("time_s")
            valid_fix = vg.fix.to_numpy() >= 3
            vlat = _sample(gt, np.where(valid_fix, vg.lat, np.nan), q+offset)
            vlon = _sample(gt, np.where(valid_fix, vg.lon, np.nan), q+offset)
            dx = (vlon-lon)*111320*np.cos(np.deg2rad(lat))
            dy = (vlat-lat)*111320
            error = np.hypot(dx, dy)
            error = error[np.isfinite(error)]
            if len(error) >= 20:
                spatial = {"sample_count": len(error), "median_error_m": round(float(np.median(error)), 3),
                           "p95_error_m": round(float(np.quantile(error, .95)), 3), "translation_applied": False}
                if spatial["median_error_m"] > 100:
                    raise ValueError("GNSS_LOCATION_MISMATCH")
                if spatial["p95_error_m"] > 30:
                    reasons.append("GNSS_POSITION_DISAGREEMENT")
    if not spatial:
        reasons.append("GNSS_POSITION_VALIDATION_UNAVAILABLE")
    start, end = max(tt[valid][0], vt[np.isfinite(vu)][0]-offset), min(tt[valid][-1], vt[np.isfinite(vu)][-1]-offset)
    if end-start < 15:
        raise ValueError("GNSS_NO_RECORDING_OVERLAP")
    coverage = []
    for row in reference.get("lap_timing", []):
        a, b = row["start_time_ms"]/1000, row["end_time_ms"]/1000
        if a < end and b > start:
            coverage.append({"lap": row["lap"], "coverage": "full" if a >= start and b <= end else "partial"})
    candidate = speed_check.get("passed", False) and bool(spatial) and not any(
        r in reasons for r in ("CLOCK_DRIFT_REQUIRES_ANCHORS", "GNSS_POSITION_DISAGREEMENT", "AIM_GPS_FIX_UNAVAILABLE"))
    return {"method": "gpmf_gnss_v1", "offset_ms": round(offset*1000),
            "status": "candidate" if candidate else "weak", "requires_manual_confirmation": True,
            "manually_confirmed": False, "body_dynamics_available": False,
            "evidence": {"clock_offset_ms": round(clock_offset*1000), "camera_clock": camera, "aim_clock": aim,
                         "aim_tow_step_s": quantization, "aim_time_validity": "not_exposed_by_parser",
                         "aim_week_source": "video_utc_date_cross_checked_with_logger_date",
                         "gps_minus_utc_s": leap, "drift_correction_applied": False,
                         "offset_convention": "video_time_s = telemetry_session_time_s + offset_ms / 1000",
                         "matched_video_range_s": [round(start+offset, 3), round(end+offset, 3)],
                         "matched_telemetry_range_s": [round(start, 3), round(end, 3)],
                         "lap_coverage": coverage, "speed_check": speed_check, "windows": windows,
                         "spatial_check": spatial, "reason_codes": reasons,
                         "source_channels": reference.get("source_channels", []),
                         "accuracy_claim": "none; held-out signal agreement is not frame-level ground truth"}}
