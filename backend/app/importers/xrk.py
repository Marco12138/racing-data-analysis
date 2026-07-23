"""Convert AiM XRK/XRZ logs into the CSV schemas used by the platform."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import numpy as np


class XrkImportError(RuntimeError):
    """Raised when an XRK file cannot be converted safely."""


@dataclass
class LapProfile:
    """GPS-derived measurements for one logger lap segment."""

    number: int
    start_ms: int
    end_ms: int
    timecodes: np.ndarray
    latitude: np.ndarray
    longitude: np.ndarray
    speed_mps: np.ndarray
    distance_m: np.ndarray

    @property
    def duration_s(self) -> float:
        return (self.end_ms - self.start_ms) / 1000.0

    @property
    def track_distance_m(self) -> float:
        return float(self.distance_m[-1]) if len(self.distance_m) else 0.0


TELEMETRY_COLUMNS = [
    "time",
    "lap",
    "distance",
    "speed",
    "steering_angle",
    "rpm",
    "lateral_g",
    "longitudinal_g",
    "yaw_rate",
    "gps_lat",
    "gps_lon",
]

CHANNEL_MAPPING = {
    "steering_angle": "Steering Angle",
    "rpm": "RPM",
    "lateral_g": "GPS_LateralAcc",
    "longitudinal_g": "GPS_InlineAcc",
    "yaw_rate": "GPS_Yaw_Rate",
}


def load_xrk(path: Path) -> Any:
    """Load an XRK/XRZ file while keeping libxrk an optional dependency."""
    try:
        from libxrk import aim_xrk
    except ImportError as exc:
        raise XrkImportError(
            "XRK support is not installed. Run: "
            "python -m pip install -r requirements-xrk.txt"
        ) from exc
    try:
        return aim_xrk(str(path))
    except Exception as exc:
        raise XrkImportError(f"Unable to parse XRK file: {exc}") from exc


def convert_xrk_file(source: Path, output_dir: Path) -> dict[str, Any]:
    """Parse one logger file and write platform-compatible local artifacts."""
    source = source.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    if not source.is_file():
        raise XrkImportError(f"XRK source does not exist: {source}")
    if source.suffix.lower() not in {".xrk", ".xrz"}:
        raise XrkImportError("Only .xrk and .xrz files are supported.")

    log = load_xrk(source)
    try:
        parser_version = version("libxrk")
    except PackageNotFoundError:
        parser_version = "unknown"
    return convert_log(log, source, output_dir, parser_version=parser_version)


def convert_log(
    log: Any,
    source: Path,
    output_dir: Path,
    *,
    parser_version: str,
) -> dict[str, Any]:
    """Convert an already parsed log; split out for deterministic tests."""
    required = {"GPS Speed", "GPS Latitude", "GPS Longitude"}
    missing_required = sorted(required - set(log.channels))
    if missing_required:
        raise XrkImportError(
            f"XRK file is missing required GPS channels: {missing_required}"
        )

    reference_times, speed_mps = channel_arrays(log.channels["GPS Speed"], "GPS Speed")
    lat_times, lat_values = channel_arrays(log.channels["GPS Latitude"], "GPS Latitude")
    lon_times, lon_values = channel_arrays(log.channels["GPS Longitude"], "GPS Longitude")
    latitude = interpolate_channel(reference_times, lat_times, lat_values)
    longitude = interpolate_channel(reference_times, lon_times, lon_values)

    profiles = build_lap_profiles(
        log.laps.to_pylist(),
        reference_times,
        speed_mps,
        latitude,
        longitude,
    )
    valid_profiles, excluded_laps, selection_stats = select_valid_laps(profiles)
    if not valid_profiles:
        raise XrkImportError("No complete timed laps passed the GPS quality checks.")

    median_track_m = float(np.median([lap.track_distance_m for lap in valid_profiles]))
    sector_boundaries_m = [median_track_m / 3.0, median_track_m * 2.0 / 3.0]
    lap_rows = build_lap_rows(valid_profiles, sector_boundaries_m)
    telemetry_rows, used_channels, warnings = build_telemetry_rows(log, valid_profiles)

    output_dir.mkdir(parents=True, exist_ok=True)
    laps_path = output_dir / "laps.csv"
    telemetry_path = output_dir / "telemetry.csv"
    report_path = output_dir / "extraction_report.json"

    write_csv(
        laps_path,
        ["lap", "lap_time", "sector_1", "sector_2", "sector_3", "notes"],
        lap_rows,
    )
    write_csv(telemetry_path, TELEMETRY_COLUMNS, telemetry_rows)

    channel_report = describe_channels(log, used_channels)
    report: dict[str, Any] = {
        "source": {
            "name": source.name,
            "path": str(source),
            "size_bytes": source.stat().st_size,
            "sha256": sha256_file(source),
            "original_modified": False,
        },
        "parser": {"library": "libxrk", "version": parser_version},
        "metadata": json_safe(dict(log.metadata)),
        "lap_selection": {
            **selection_stats,
            "valid_laps": [lap.number for lap in valid_profiles],
            "excluded_laps": excluded_laps,
        },
        "virtual_sectors": {
            "method": "equal_distance_thirds",
            "derived_not_official": True,
            "median_track_distance_m": round(median_track_m, 3),
            "boundaries_m": [round(value, 3) for value in sector_boundaries_m],
        },
        "channels": channel_report,
        "warnings": [
            "Sector times are derived from equal-distance GPS thirds, not official timing splits.",
            "Throttle and brake channels are unavailable; no throttle, braking, understeer, or oversteer conclusions are generated.",
            *channel_limitation_warnings(log),
            *warnings,
        ],
        "outputs": {
            "laps_csv": str(laps_path),
            "telemetry_csv": str(telemetry_path),
            "telemetry_rows": len(telemetry_rows),
        },
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report["outputs"]["extraction_report"] = str(report_path)
    return report


def build_lap_profiles(
    lap_rows: list[dict[str, Any]],
    reference_times: np.ndarray,
    speed_mps: np.ndarray,
    latitude: np.ndarray,
    longitude: np.ndarray,
) -> list[LapProfile]:
    """Build distance traces for all logger lap segments."""
    profiles: list[LapProfile] = []
    for row in lap_rows:
        start_ms = int(row["start_time"])
        end_ms = int(row["end_time"])
        mask = (reference_times >= start_ms) & (reference_times < end_ms)
        times = reference_times[mask]
        lat = latitude[mask]
        lon = longitude[mask]
        speed = speed_mps[mask]
        profiles.append(
            LapProfile(
                number=int(row["num"]),
                start_ms=start_ms,
                end_ms=end_ms,
                timecodes=times,
                latitude=lat,
                longitude=lon,
                speed_mps=speed,
                distance_m=cumulative_gps_distance(lat, lon),
            )
        )
    return profiles


def select_valid_laps(
    profiles: list[LapProfile],
) -> tuple[list[LapProfile], list[dict[str, Any]], dict[str, float]]:
    """Exclude non-numbered, incomplete, and duration-outlier lap segments."""
    candidates = [lap for lap in profiles if lap.number > 0 and len(lap.timecodes) >= 10]
    if not candidates:
        return [], [], {"median_duration_s": 0.0, "median_distance_m": 0.0}

    median_duration = float(np.median([lap.duration_s for lap in candidates]))
    median_distance = float(np.median([lap.track_distance_m for lap in candidates]))
    valid: list[LapProfile] = []
    excluded: list[dict[str, Any]] = []

    for lap in profiles:
        reasons: list[str] = []
        if lap.number <= 0:
            reasons.append("non_timed_or_out_lap")
        if len(lap.timecodes) < 10:
            reasons.append("insufficient_gps_samples")
        if lap.number > 0 and lap.duration_s > median_duration * 1.25:
            reasons.append("duration_above_1.25x_median")
        if lap.number > 0 and median_distance > 0 and not (
            median_distance * 0.85 <= lap.track_distance_m <= median_distance * 1.15
        ):
            reasons.append("gps_distance_outside_15_percent")
        if reasons:
            excluded.append(
                {
                    "lap": lap.number,
                    "duration_s": round(lap.duration_s, 3),
                    "distance_m": round(lap.track_distance_m, 3),
                    "reasons": reasons,
                }
            )
        else:
            valid.append(lap)

    return (
        valid,
        excluded,
        {
            "median_duration_s": round(median_duration, 3),
            "median_distance_m": round(median_distance, 3),
            "duration_limit_s": round(median_duration * 1.25, 3),
            "distance_range_m": [
                round(median_distance * 0.85, 3),
                round(median_distance * 1.15, 3),
            ],
        },
    )


def build_lap_rows(
    profiles: list[LapProfile],
    boundaries_m: list[float],
) -> list[dict[str, Any]]:
    """Build the lap CSV using equal-distance virtual sectors."""
    rows: list[dict[str, Any]] = []
    for lap in profiles:
        sector_1, sector_2, sector_3 = virtual_sector_times(lap, boundaries_m)
        rows.append(
            {
                "lap": lap.number,
                "lap_time": format_float(lap.duration_s, 3),
                "sector_1": format_float(sector_1, 3),
                "sector_2": format_float(sector_2, 3),
                "sector_3": format_float(sector_3, 3),
                "notes": "derived_equal_distance_sectors",
            }
        )
    return rows


def virtual_sector_times(
    lap: LapProfile,
    boundaries_m: list[float],
) -> tuple[float, float, float]:
    """Interpolate two distance crossings and preserve the official lap duration."""
    if len(boundaries_m) != 2 or len(lap.distance_m) < 2:
        raise XrkImportError("Virtual sectors require two boundaries and GPS samples.")
    if boundaries_m[1] >= lap.track_distance_m:
        raise XrkImportError(
            f"Lap {lap.number} does not reach the virtual sector boundary."
        )
    elapsed_ms = lap.timecodes.astype(float) - float(lap.start_ms)
    crossing_1 = float(np.interp(boundaries_m[0], lap.distance_m, elapsed_ms))
    crossing_2 = float(np.interp(boundaries_m[1], lap.distance_m, elapsed_ms))
    sector_1 = crossing_1 / 1000.0
    sector_2 = (crossing_2 - crossing_1) / 1000.0
    sector_3 = lap.duration_s - crossing_2 / 1000.0
    return sector_1, sector_2, sector_3


def build_telemetry_rows(
    log: Any,
    profiles: list[LapProfile],
) -> tuple[list[dict[str, Any]], set[str], list[str]]:
    """Align supported channels to the native GPS timebase."""
    aligned: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    used_channels = {"GPS Speed", "GPS Latitude", "GPS Longitude"}
    warnings: list[str] = []
    for output_name, source_name in CHANNEL_MAPPING.items():
        if source_name not in log.channels:
            warnings.append(f"Optional channel unavailable: {source_name}")
            continue
        times, values = channel_arrays(log.channels[source_name], source_name)
        finite = values[np.isfinite(values)]
        if not len(finite) or np.allclose(finite, 0.0):
            warnings.append(f"Optional channel contains no usable values: {source_name}")
            continue
        aligned[output_name] = (times, values)
        used_channels.add(source_name)

    rows: list[dict[str, Any]] = []
    for lap in profiles:
        optional_values = {
            output_name: interpolate_channel(lap.timecodes, times, values)
            for output_name, (times, values) in aligned.items()
        }
        for index, timecode in enumerate(lap.timecodes):
            row: dict[str, Any] = {
                "time": format_float((timecode - lap.start_ms) / 1000.0, 3),
                "lap": lap.number,
                "distance": format_float(float(lap.distance_m[index]), 3),
                "speed": format_float(float(lap.speed_mps[index]) * 3.6, 3),
                "gps_lat": format_float(float(lap.latitude[index]), 8),
                "gps_lon": format_float(float(lap.longitude[index]), 8),
            }
            for output_name, values in optional_values.items():
                row[output_name] = format_float(float(values[index]), 5)
            rows.append(row)
    return rows, used_channels, warnings


def channel_arrays(table: Any, channel_name: str) -> tuple[np.ndarray, np.ndarray]:
    """Return finite numeric time/value arrays from a libxrk channel table."""
    values = table.to_pydict()
    if "timecodes" not in values or channel_name not in values:
        raise XrkImportError(f"Malformed channel table: {channel_name}")
    times = np.asarray(values["timecodes"], dtype=np.int64)
    channel_values = np.asarray(values[channel_name], dtype=float)
    finite = np.isfinite(times) & np.isfinite(channel_values)
    times = times[finite]
    channel_values = channel_values[finite]
    if not len(times):
        raise XrkImportError(f"Channel has no numeric samples: {channel_name}")
    order = np.argsort(times, kind="stable")
    return times[order], channel_values[order]


def interpolate_channel(
    target_times: np.ndarray,
    source_times: np.ndarray,
    source_values: np.ndarray,
) -> np.ndarray:
    """Linearly align an asynchronous numeric channel to target timecodes."""
    if not len(source_times):
        return np.full(len(target_times), np.nan)
    return np.interp(
        target_times.astype(float),
        source_times.astype(float),
        source_values.astype(float),
    )


def cumulative_gps_distance(latitude: np.ndarray, longitude: np.ndarray) -> np.ndarray:
    """Return cumulative Haversine distance while rejecting impossible GPS jumps."""
    if not len(latitude):
        return np.asarray([], dtype=float)
    lat_1 = np.radians(latitude[:-1])
    lat_2 = np.radians(latitude[1:])
    delta_lat = lat_2 - lat_1
    delta_lon = np.radians(longitude[1:] - longitude[:-1])
    haversine = (
        np.sin(delta_lat / 2.0) ** 2
        + np.cos(lat_1) * np.cos(lat_2) * np.sin(delta_lon / 2.0) ** 2
    )
    steps = 2.0 * 6_371_000.0 * np.arcsin(np.sqrt(np.clip(haversine, 0.0, 1.0)))
    steps = np.where(np.isfinite(steps) & (steps <= 30.0), steps, 0.0)
    return np.concatenate(([0.0], np.cumsum(steps)))


def describe_channels(log: Any, used_channels: set[str]) -> list[dict[str, Any]]:
    """Summarize channel availability without exporting raw samples."""
    descriptions: list[dict[str, Any]] = []
    for name, table in log.channels.items():
        try:
            _, values = channel_arrays(table, name)
            finite = values[np.isfinite(values)]
            all_zero = bool(len(finite) and np.allclose(finite, 0.0))
        except XrkImportError:
            all_zero = False
        status = "used" if name in used_channels else "available_not_exported"
        if all_zero:
            status = "excluded_all_zero"
        descriptions.append(
            {
                "name": name,
                "units": channel_units(table, name),
                "samples": int(getattr(table, "num_rows", 0)),
                "status": status,
            }
        )
    for missing in ["Throttle", "Brake Pressure"]:
        descriptions.append(
            {"name": missing, "units": None, "samples": 0, "status": "unavailable"}
        )
    return descriptions


def channel_limitation_warnings(log: Any) -> list[str]:
    """Describe known unusable or missing vehicle channels accurately."""
    warnings: list[str] = []
    for name in ["WheelSpeed", "Calculated_Gear"]:
        if name not in log.channels:
            warnings.append(f"Vehicle channel unavailable: {name}")
            continue
        _, values = channel_arrays(log.channels[name], name)
        finite = values[np.isfinite(values)]
        if not len(finite) or np.allclose(finite, 0.0):
            warnings.append(f"Vehicle channel contains only zero values and is excluded: {name}")
    return warnings


def channel_units(table: Any, channel_name: str) -> str | None:
    """Read units from PyArrow field metadata when available."""
    try:
        field = table.schema.field(channel_name)
        metadata = field.metadata or {}
        units = metadata.get(b"units")
        return units.decode("utf-8") if units else None
    except (AttributeError, KeyError):
        return None


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    """Write deterministic UTF-8 CSV output."""
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def sha256_file(path: Path) -> str:
    """Hash a file without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def format_float(value: float, decimals: int) -> str:
    """Format finite values consistently and leave unavailable values blank."""
    if not math.isfinite(value):
        return ""
    return f"{value:.{decimals}f}"


def json_safe(value: Any) -> Any:
    """Convert NumPy and path values into JSON-safe primitives."""
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    return value
