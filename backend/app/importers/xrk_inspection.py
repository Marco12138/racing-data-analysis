"""Cross-platform AiM inspection and normalized telemetry extraction."""

from __future__ import annotations

import hashlib
import json
import math
import platform
import re
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .xrk import XrkImportError, channel_arrays, channel_units, json_safe, load_xrk


PARSER_LICENSE = "MIT"
PARSER_STATUS = "beta"


CHANNEL_ALIASES: dict[str, tuple[str, ...]] = {
    "rpm": ("RPM", "Engine RPM", "EngineSpeed"),
    "speed": ("GPS Speed", "Speed", "Vehicle Speed", "WheelSpeed"),
    "gps_lat": ("GPS Latitude", "Latitude"),
    "gps_lon": ("GPS Longitude", "Longitude"),
    "gps_altitude": ("GPS Altitude", "Altitude"),
    "gps_fix": ("GPS_Fix", "GPS Fix"),
    "gps_satellites": ("GPS_Satellites", "GPS Satellites"),
    "gps_accuracy_m": ("GPS_Position_Accuracy", "GPS Position Accuracy"),
    "gps_velocity_accuracy": (
        "GPS_Velocity_Accuracy",
        "GPS Velocity Accuracy",
    ),
    "longitudinal_g": (
        "GPS_InlineAcc",
        "GPS Longitudinal Acceleration",
        "Longitudinal Acceleration",
        "Inline Acceleration",
        "Accel X",
    ),
    "lateral_g": (
        "GPS_LateralAcc",
        "GPS Lateral Acceleration",
        "Lateral Acceleration",
        "Accel Y",
    ),
    "vertical_g": ("Vertical Acceleration", "Accel Z"),
    "yaw_rate": ("GPS_Yaw_Rate", "Yaw Rate", "Gyro Z"),
    "gyro_x": ("Gyro X",),
    "gyro_y": ("Gyro Y",),
    "steering_angle": ("Steering Angle", "Steering"),
    "gear": ("Calculated_Gear", "Gear"),
    "predictive_time": ("Predictive Time",),
    "best_run_diff": ("Best Run Diff", "Best Time Diff"),
    "throttle": ("Throttle", "Throttle Position", "TPS"),
    "brake": ("Brake Pressure", "Brake", "Brake Position"),
}


def inspect_xrk_file(source: Path, output_dir: Path) -> dict[str, Any]:
    """Read real channel samples and create a normalized Parquet session."""
    started_at = time.monotonic()
    source = source.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    if not source.is_file():
        raise XrkImportError("XRK source does not exist.")
    if source.suffix.lower() not in {".xrk", ".xrz"}:
        raise XrkImportError("Only .xrk and .xrz files are supported.")

    log = load_xrk(source)
    output_dir.mkdir(parents=True, exist_ok=True)
    channel_descriptions, resolved = inspect_channels(log)
    lap_segments = normalize_lap_segments(log)
    valid_laps, excluded_laps = select_timed_laps(lap_segments)
    normalized = build_normalized_telemetry(log, valid_laps, resolved)
    if normalized.empty:
        raise XrkImportError("No usable numeric telemetry channels were found.")

    try:
        parser_version = version("libxrk")
    except PackageNotFoundError:
        parser_version = "unknown"

    telemetry_path = output_dir / "telemetry.parquet"
    normalized.to_parquet(telemetry_path, index=False)
    manifest = {
        "filename": source.name,
        "file_size_bytes": source.stat().st_size,
        "fingerprint": sha256_file(source),
        "parser": {
            "library": "libxrk",
            "version": parser_version,
            "license": PARSER_LICENSE,
            "status": PARSER_STATUS,
            "platform": platform.system().lower(),
        },
        "metadata": json_safe(dict(log.metadata)),
        "laps": len(valid_laps),
        "lap_segments": len(lap_segments),
        "valid_laps": [int(row["num"]) for row in valid_laps],
        "lap_timing": [
            {
                "lap": int(row["num"]),
                "start_time_ms": int(row["start_time"]),
                "end_time_ms": int(row["end_time"]),
                "duration_s": round(
                    (row["end_time"] - row["start_time"]) / 1000.0,
                    3,
                ),
            }
            for row in valid_laps
        ],
        "excluded_laps": excluded_laps,
        "channels": channel_descriptions,
        "has_gps": {"gps_lat", "gps_lon", "speed"}.issubset(resolved),
        "has_gps_speed": "speed" in resolved,
        "has_rpm": "rpm" in resolved,
        "has_accelerometer": bool(
            {"longitudinal_g", "lateral_g", "vertical_g"}.intersection(resolved)
        ),
        "has_gyro": bool({"gyro_x", "gyro_y", "yaw_rate"}.intersection(resolved)),
        "has_lap_timing": bool(valid_laps),
        "has_predefined_sectors": has_structured_sectors(log),
        "available_canonical_channels": sorted(resolved),
        "telemetry_rows": int(len(normalized)),
        "session_summary": session_summary(lap_segments, valid_laps),
        "warning_codes": inspection_warning_codes(resolved, log),
        "warnings": inspection_warnings(resolved, log),
        "processing_duration_ms": round((time.monotonic() - started_at) * 1000),
        "artifacts": {"telemetry": telemetry_path.name},
    }
    (output_dir / "inspection.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def inspect_channels(
    log: Any,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Return every real channel plus canonical channel resolution."""
    canonical_by_normalized: dict[str, str] = {}
    for canonical, aliases in CHANNEL_ALIASES.items():
        for alias in aliases:
            canonical_by_normalized[normalize_channel_name(alias)] = canonical

    descriptions: list[dict[str, Any]] = []
    available_names: set[str] = set()
    for name, table in log.channels.items():
        sample_count = int(getattr(table, "num_rows", 0))
        all_zero = False
        available = False
        first_timestamp_s: float | None = None
        last_timestamp_s: float | None = None
        sample_rate_hz: float | None = None
        try:
            timecodes, values = channel_arrays(table, name)
            finite = values[np.isfinite(values)]
            available = bool(len(finite))
            all_zero = bool(available and np.allclose(finite, 0.0))
            available = available and not all_zero
            if len(timecodes):
                first_timestamp_s = json_number(float(timecodes[0]) / 1000.0)
                last_timestamp_s = json_number(float(timecodes[-1]) / 1000.0)
            if len(timecodes) > 1 and timecodes[-1] > timecodes[0]:
                sample_rate_hz = json_number(
                    (len(timecodes) - 1)
                    / ((float(timecodes[-1]) - float(timecodes[0])) / 1000.0)
                )
        except XrkImportError:
            pass
        normalized_name = normalize_channel_name(name)
        canonical = canonical_by_normalized.get(normalized_name)
        descriptions.append(
            {
                "name": name,
                "normalized_name": normalized_name,
                "canonical_name": canonical,
                "unit": channel_units(table, name),
                "sample_count": sample_count,
                "sample_rate_hz": (
                    round(sample_rate_hz, 3) if sample_rate_hz is not None else None
                ),
                "first_timestamp_s": (
                    round(first_timestamp_s, 3)
                    if first_timestamp_s is not None
                    else None
                ),
                "last_timestamp_s": (
                    round(last_timestamp_s, 3)
                    if last_timestamp_s is not None
                    else None
                ),
                "available": available,
                "all_zero": all_zero,
                "analysis_usage": analysis_usage(canonical, available),
            }
        )
        if available:
            available_names.add(name)

    resolved: dict[str, str] = {}
    for canonical, aliases in CHANNEL_ALIASES.items():
        for alias in aliases:
            match = next(
                (
                    name
                    for name in available_names
                    if normalize_channel_name(name) == normalize_channel_name(alias)
                ),
                None,
            )
            if match:
                resolved[canonical] = match
                break
    return descriptions, resolved


def normalize_lap_segments(log: Any) -> list[dict[str, int]]:
    """Return validated logger lap rows without assuming sector support."""
    rows: list[dict[str, int]] = []
    for row in log.laps.to_pylist():
        try:
            start = int(row["start_time"])
            end = int(row["end_time"])
            number = int(row["num"])
        except (KeyError, TypeError, ValueError) as exc:
            raise XrkImportError("XRK lap timing table is malformed.") from exc
        if end <= start:
            continue
        rows.append({"num": number, "start_time": start, "end_time": end})
    return rows


def select_timed_laps(
    segments: list[dict[str, int]],
) -> tuple[list[dict[str, int]], list[dict[str, Any]]]:
    """Exclude out laps and large duration outliers conservatively."""
    candidates = [row for row in segments if row["num"] > 0]
    if not candidates:
        return [], [
            {"lap": row["num"], "reasons": ["non_timed_or_out_lap"]}
            for row in segments
        ]
    durations = np.asarray(
        [(row["end_time"] - row["start_time"]) / 1000.0 for row in candidates],
        dtype=float,
    )
    median_duration = float(np.median(durations))
    limit = median_duration * 1.25
    valid: list[dict[str, int]] = []
    excluded: list[dict[str, Any]] = []
    for row in segments:
        duration = (row["end_time"] - row["start_time"]) / 1000.0
        reasons: list[str] = []
        if row["num"] <= 0:
            reasons.append("non_timed_or_out_lap")
        if row["num"] > 0 and duration > limit:
            reasons.append("duration_above_1.25x_median")
        if reasons:
            excluded.append(
                {
                    "lap": row["num"],
                    "duration_s": round(duration, 3),
                    "reasons": reasons,
                }
            )
        else:
            valid.append(row)
    return valid, excluded


def build_normalized_telemetry(
    log: Any,
    valid_laps: list[dict[str, int]],
    resolved: dict[str, str],
) -> pd.DataFrame:
    """Align canonical channels to the best available native timebase."""
    if not resolved:
        return pd.DataFrame()
    reference_canonical = next(
        (name for name in ("speed", "rpm", "gps_lat", "longitudinal_g") if name in resolved),
        next(iter(resolved)),
    )
    reference_name = resolved[reference_canonical]
    reference_times, _ = channel_arrays(log.channels[reference_name], reference_name)

    aligned: dict[str, np.ndarray] = {}
    for canonical, source_name in resolved.items():
        times, values = channel_arrays(log.channels[source_name], source_name)
        converted = convert_units(
            canonical,
            values,
            channel_units(log.channels[source_name], source_name),
        )
        aligned[canonical] = np.interp(
            reference_times.astype(float),
            times.astype(float),
            converted.astype(float),
        )

    frames: list[pd.DataFrame] = []
    for lap in valid_laps:
        mask = (reference_times >= lap["start_time"]) & (
            reference_times < lap["end_time"]
        )
        if int(mask.sum()) < 3:
            continue
        lap_times = reference_times[mask]
        data: dict[str, Any] = {
            "lap": np.full(int(mask.sum()), lap["num"], dtype=int),
            "session_time_s": lap_times.astype(float) / 1000.0,
            "lap_time_s": (
                lap_times.astype(float) - float(lap["start_time"])
            )
            / 1000.0,
        }
        for canonical, values in aligned.items():
            data[canonical] = values[mask]
        frames.append(pd.DataFrame(data))
    if not frames:
        return pd.DataFrame()
    normalized = pd.concat(frames, ignore_index=True)
    normalized.replace([np.inf, -np.inf], np.nan, inplace=True)
    return normalized


def convert_units(canonical: str, values: np.ndarray, unit: str | None) -> np.ndarray:
    """Convert selected source units into the platform canonical units."""
    result = values.astype(float, copy=True)
    normalized_unit = (unit or "").strip().lower()
    if canonical == "speed":
        if normalized_unit in {"m/s", "mps", "m s-1"}:
            result *= 3.6
        elif normalized_unit in {"mph"}:
            result *= 1.609344
    if canonical in {"predictive_time", "best_run_diff"} and normalized_unit == "ms":
        result /= 1000.0
    return result


def has_structured_sectors(log: Any) -> bool:
    """Report sectors only when a parser exposes a structured sector table."""
    sectors = getattr(log, "sectors", None)
    return bool(sectors is not None and getattr(sectors, "num_rows", 0))


def inspection_warnings(resolved: dict[str, str], log: Any) -> list[str]:
    """Describe data boundaries without turning missing channels into failures."""
    warnings: list[str] = []
    if not {"gps_lat", "gps_lon", "speed"}.issubset(resolved):
        warnings.append("GPS track analysis is unavailable for this session.")
    if "rpm" not in resolved:
        warnings.append("RPM behavior analysis is unavailable for this session.")
    if "brake" not in resolved:
        warnings.append(
            "No direct brake channel is available; braking can only be inferred."
        )
    if "throttle" not in resolved:
        warnings.append(
            "No direct throttle channel is available; throttle percentage is not estimated."
        )
    if not has_structured_sectors(log):
        warnings.append(
            "No parser-confirmed official sectors are available; virtual sectors may be generated."
        )
    return warnings


def inspection_warning_codes(resolved: dict[str, str], log: Any) -> list[str]:
    """Return stable codes for optional channel limitations."""
    codes: list[str] = []
    if not {"gps_lat", "gps_lon", "speed"}.issubset(resolved):
        codes.append("XRK_GPS_UNAVAILABLE")
    if "rpm" not in resolved:
        codes.append("XRK_RPM_UNAVAILABLE")
    if "brake" not in resolved:
        codes.append("XRK_BRAKE_UNAVAILABLE")
    if "throttle" not in resolved:
        codes.append("XRK_THROTTLE_UNAVAILABLE")
    if not has_structured_sectors(log):
        codes.append("XRK_OFFICIAL_SECTORS_UNAVAILABLE")
    return codes


def session_summary(
    segments: list[dict[str, int]],
    valid_laps: list[dict[str, int]],
) -> dict[str, Any]:
    """Summarize logger timing without inferring absent sectors."""
    fastest = min(
        valid_laps,
        key=lambda row: row["end_time"] - row["start_time"],
        default=None,
    )
    if segments:
        duration_s = (max(row["end_time"] for row in segments) - min(
            row["start_time"] for row in segments
        )) / 1000.0
    else:
        duration_s = 0.0
    return {
        "lap_segments": len(segments),
        "timed_laps": len(valid_laps),
        "session_duration_s": round(duration_s, 3),
        "fastest_lap": (
            {
                "lap": int(fastest["num"]),
                "lap_time_s": round(
                    (fastest["end_time"] - fastest["start_time"]) / 1000.0,
                    3,
                ),
            }
            if fastest
            else None
        ),
    }


def analysis_usage(canonical: str | None, available: bool) -> list[str]:
    """Describe which analysis surfaces can consume a channel."""
    if not canonical or not available:
        return []
    usage = {
        "rpm": ["rpm_analysis", "driver_actions", "lap_comparison"],
        "speed": ["track_map", "driver_actions", "lap_comparison"],
        "gps_lat": ["track_map", "distance_alignment"],
        "gps_lon": ["track_map", "distance_alignment"],
        "longitudinal_g": ["driver_actions", "lap_comparison"],
        "lateral_g": ["track_map", "lap_comparison"],
        "yaw_rate": ["track_map", "zone_detection"],
        "brake": ["confirmed_braking"],
        "throttle": ["throttle_analysis"],
        "gear": ["shift_filtering"],
        "predictive_time": ["lap_comparison"],
        "best_run_diff": ["lap_comparison"],
    }
    return usage.get(canonical, ["channel_inspection"])


def normalize_channel_name(name: str) -> str:
    """Normalize a channel label for exact alias matching."""
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def sha256_file(path: Path) -> str:
    """Hash an uploaded file without retaining it in memory."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_number(value: Any) -> float | None:
    """Return a finite JSON number or null."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
