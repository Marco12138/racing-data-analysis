"""Telemetry analysis functions for backend API."""

from __future__ import annotations

import pandas as pd


def analyze_telemetry(df: pd.DataFrame) -> dict:
    """Summarize available telemetry channels without requiring all fields."""
    working = df.copy()
    for column in working.columns:
        working[column] = pd.to_numeric(working[column], errors="coerce")

    result: dict[str, float | int | list[str] | None] = {
        "available_channels": [column for column in working.columns if working[column].notna().any()],
        "sample_count": int(len(working)),
    }
    if "speed" in working:
        result["maximum_speed"] = float(working["speed"].max())
        result["average_speed"] = float(working["speed"].mean())
        result["minimum_corner_speed"] = float(working["speed"].min())
    if "throttle" in working:
        result["average_throttle"] = float(working["throttle"].mean())
        result["full_throttle_percentage"] = float((working["throttle"] >= 95).mean() * 100)
    if "brake" in working:
        result["maximum_brake_pressure"] = float(working["brake"].max())
        result["braking_duration_percentage"] = float((working["brake"] > 5).mean() * 100)
    if "lateral_g" in working:
        result["maximum_lateral_g"] = float(working["lateral_g"].abs().max())
    return result

