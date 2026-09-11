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
from .native_signals import bounded_resample, native_frame, save_native_channels, timestamp_quality


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
    ),
    "lateral_g": (
        "GPS_LateralAcc",
        "GPS Lateral Acceleration",
    ),
    "accel_x": ("AccelerometerX", "Accel X", "AccX"),
    "accel_y": ("AccelerometerY", "Accel Y", "AccY"),
    "accel_z": ("AccelerometerZ", "Accel Z", "AccZ"),
    "yaw_rate": ("GPS_Yaw_Rate",),
    "gyro_x": ("Gyro X", "GyrX"),
    "gyro_y": ("Gyro Y", "GyrY"),
    "gyro_z": ("Gyro Z", "GyrZ"),
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
    native_path = output_dir / "native_channels.parquet"
    native_rows = save_native_channels(log, channel_descriptions, native_path)
    sensors = sensor_capabilities(channel_descriptions)
    provenance = {
        canonical: {
            **next(row for row in channel_descriptions if row["name"] == source_name),
            "display_processing": normalized.attrs.get("processing", {}).get(canonical, {}),
        }
        for canonical, source_name in resolved.items()
    }
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
        "has_gps_speed": normalize_channel_name(resolved.get("speed", "")) == "gpsspeed",
        "has_rpm": "rpm" in resolved,
        "has_accelerometer": sensors["accelerometer_present"],
        "has_gyro": sensors["gyro_present"],
        "has_gps_yaw": "yaw_rate" in resolved,
        "sensor_capabilities": sensors,
        "channel_provenance": provenance,
        "native_data": {"schema_version": 1, "rows": native_rows, "time_unit": "ms", "value_units": "per_channel_original", "retention": "inspection_fixed_expiry"},
        "has_lap_timing": bool(valid_laps),
        "has_predefined_sectors": has_structured_sectors(log),
        "available_canonical_channels": sorted(resolved),
        "telemetry_rows": int(len(normalized)),
        "session_summary": session_summary(lap_segments, valid_laps),
        "warning_codes": inspection_warning_codes(resolved, log),
        "warnings": inspection_warnings(resolved, log),
        "processing_duration_ms": round((time.monotonic() - started_at) * 1000),
        "artifacts": {"telemetry": telemetry_path.name, "native_channels": native_path.name},
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
    for index, (name, table) in enumerate(log.channels.items()):
        normalized_name = normalize_channel_name(name)
        canonical = canonical_by_normalized.get(normalized_name)
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
            all_zero = bool(available and np.all(finite == 0.0))
            available = available and not (all_zero and canonical == "gear")
            if len(timecodes):
                first_timestamp_s = json_number(float(timecodes[0]) / 1000.0)
                last_timestamp_s = json_number(float(timecodes[-1]) / 1000.0)
            if len(timecodes) > 1 and timecodes[-1] > timecodes[0]:
                sample_rate_hz = json_number(
                    (len(timecodes) - 1)
                    / ((float(timecodes[-1]) - float(timecodes[0])) / 1000.0)
                )
        except (XrkImportError, TypeError, ValueError, OverflowError):
            pass
        normalized_name = normalize_channel_name(name)
        canonical = canonical_by_normalized.get(normalized_name)
        try:
            quality = timestamp_quality(native_frame(table, name))
        except (KeyError, TypeError, ValueError):
            quality = {"native_sample_rate_hz": None, "readable": False}
        source = channel_source(canonical, name)
        descriptions.append(
            {
                "channel_id": f"c{index:04d}",
                "name": name,
                "normalized_name": normalized_name,
                "canonical_name": canonical,
                "unit": channel_units(table, name),
                "unit_verified": units_supported(canonical, channel_units(table, name)),
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
                "present": True,
                "validity": "all_zero_information_insufficient" if all_zero else "finite_samples" if available else "no_usable_numeric_samples",
                "source": source,
                "evidence_class": "calculated" if source in {"gps_derived", "logger_calculated"} else "measured" if source in {"raw_sensor", "gps_receiver"} else "unknown",
                "raw_axis": canonical[-1] if canonical and canonical.startswith(("accel_", "gyro_")) else None,
                "body_frame_calibrated": False,
                "derived_from": ["GPS velocity/position (logger algorithm unspecified)"] if source == "gps_derived" else [],
                "timing_quality": quality,
                "native_sample_rate_hz": quality.get("native_sample_rate_hz"),
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
                    for name in sorted(available_names)
                    if normalize_channel_name(name) == normalize_channel_name(alias)
                ),
                None,
            )
            if match:
                resolved[canonical] = match
                break
    for row in descriptions:
        selected = resolved.get(row["canonical_name"]) == row["name"]
        row["selected"] = selected
        row["selection_reason"] = "first_usable_exact_alias" if selected else "not_selected_or_unrecognized"
        if selected and not row["unit_verified"]:
            row["selection_reason"] = "selected_native_only_unknown_units_normalized_unavailable"
        if not selected or not row["unit_verified"]:
            row["analysis_usage"] = []
    return descriptions, resolved


def channel_source(canonical: str | None, name: str) -> str:
    """Do not infer body axes or hardware existence from GPS-derived channels."""
    if canonical in {"longitudinal_g", "lateral_g", "yaw_rate"}:
        return "gps_derived"
    if canonical in {"gear", "predictive_time", "best_run_diff"}:
        return "logger_calculated"
    if canonical and canonical.startswith("gps_") or normalize_channel_name(name) == "gpsspeed":
        return "gps_receiver"
    if canonical and (canonical.startswith(("accel_", "gyro_")) or canonical in {"rpm", "brake", "throttle", "steering_angle"}):
        return "raw_sensor"
    return "unknown"


def sensor_capabilities(channels: list[dict[str, Any]]) -> dict[str, Any]:
    """Presence is not proof of calibrated, dynamic body-frame usability."""
    names = {row["canonical_name"] for row in channels if row.get("source") == "raw_sensor"}
    return {
        "accelerometer_present": bool(names & {"accel_x", "accel_y", "accel_z"}),
        "gyro_present": bool(names & {"gyro_x", "gyro_y", "gyro_z"}),
        "body_dynamics_available": False,
        "calibration_status": "not_calibrated",
        "reason": "Raw sensor axes require independent body-frame calibration and validation.",
    }


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
    processing: dict[str, Any] = {}
    for canonical, source_name in resolved.items():
        raw = native_frame(log.channels[source_name], source_name)
        times = raw["timecode_ms"].to_numpy(dtype=float)
        values = raw["value"].to_numpy(dtype=float)
        converted = convert_units(
            canonical,
            values,
            channel_units(log.channels[source_name], source_name),
        )
        aligned[canonical], processing[canonical] = bounded_resample(
            times / 1000.0, converted, reference_times.astype(float) / 1000.0,
            discrete=canonical in {"gear", "gps_fix", "gps_satellites"},
        )
        processing[canonical]["unit_conversion"] = {
            "source_unit": channel_units(log.channels[source_name], source_name),
            "target_unit": canonical_unit(canonical),
            "verified": units_supported(canonical, channel_units(log.channels[source_name], source_name)),
        }

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
    normalized.attrs["processing"] = processing
    return normalized


def convert_units(canonical: str, values: np.ndarray, unit: str | None) -> np.ndarray:
    """Convert selected source units into the platform canonical units."""
    result = values.astype(float, copy=True)
    if not units_supported(canonical, unit):
        return np.full_like(result, np.nan)
    normalized_unit = (unit or "").strip().lower()
    if canonical == "speed":
        if normalized_unit in {"m/s", "mps", "m s-1"}:
            result *= 3.6
        elif normalized_unit in {"mph"}:
            result *= 1.609344
    if canonical in {"predictive_time", "best_run_diff"} and normalized_unit == "ms":
        result /= 1000.0
    if canonical in {"longitudinal_g", "lateral_g", "accel_x", "accel_y", "accel_z"} and normalized_unit in {"m/s2", "m/s^2", "m/s²"}:
        result /= 9.80665
    if canonical in {"yaw_rate", "gyro_x", "gyro_y", "gyro_z"} and normalized_unit in {"rad/s", "radians/s"}:
        result = np.rad2deg(result)
    return result


def units_supported(canonical: str | None, unit: str | None) -> bool:
    """Fail closed for quantitative dynamics when physical units are unknown."""
    accepted = {
        "speed": {"km/h", "kph", "kmh", "m/s", "mps", "m s-1", "mph"},
        **{key: {"g", "m/s2", "m/s^2", "m/s²"} for key in
           ("longitudinal_g", "lateral_g", "accel_x", "accel_y", "accel_z")},
        **{key: {"deg/s", "rad/s", "radians/s"} for key in
           ("yaw_rate", "gyro_x", "gyro_y", "gyro_z")},
    }
    return canonical not in accepted or (unit or "").strip().lower() in accepted[canonical]


def canonical_unit(canonical: str) -> str | None:
    """Document display units independently of the preserved native units."""
    if canonical == "speed":
        return "km/h"
    if canonical in {"longitudinal_g", "lateral_g", "accel_x", "accel_y", "accel_z"}:
        return "g"
    if canonical in {"yaw_rate", "gyro_x", "gyro_y", "gyro_z"}:
        return "deg/s"
    if canonical in {"predictive_time", "best_run_diff"}:
        return "s"
    return {"rpm": "rpm", "gps_lat": "deg", "gps_lon": "deg"}.get(canonical)


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
