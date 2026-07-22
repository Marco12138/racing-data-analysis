"""Heuristic driving behavior assistant."""

from __future__ import annotations

import pandas as pd


def generate_handling_flags(df: pd.DataFrame) -> list[dict]:
    """Generate conservative possible understeer and oversteer flags."""
    if df is None or df.empty:
        return []

    working = df.copy()
    for column in working.columns:
        working[column] = pd.to_numeric(working[column], errors="coerce")
    flags: list[dict] = []

    required_understeer = {"lap", "steering_angle", "lateral_g", "brake"}
    if required_understeer.issubset(working.columns):
        for _, row in working.iterrows():
            if abs(row["steering_angle"]) >= 28 and abs(row["lateral_g"]) >= 0.85 and row["brake"] < 35:
                flags.append(
                    {
                        "lap": int(row["lap"]),
                        "sector": _sector_from_distance(row.get("distance")),
                        "event_type": "Possible Understeer",
                        "confidence": "Medium" if "yaw_rate" in working.columns else "Low",
                        "reason": "Large steering input with high lateral G and limited speed reduction.",
                    }
                )

    required_oversteer = {"lap", "steering_angle", "lateral_g", "throttle"}
    if required_oversteer.issubset(working.columns):
        working = working.sort_values([column for column in ["lap", "time", "distance"] if column in working.columns])
        working["steering_delta"] = working.groupby("lap")["steering_angle"].diff().abs()
        working["lateral_delta"] = working.groupby("lap")["lateral_g"].diff().abs()
        for _, row in working.iterrows():
            if row["steering_delta"] >= 18 and row["lateral_delta"] >= 0.35 and row["throttle"] >= 55:
                flags.append(
                    {
                        "lap": int(row["lap"]),
                        "sector": _sector_from_distance(row.get("distance")),
                        "event_type": "Possible Oversteer",
                        "confidence": "Low",
                        "reason": "Counter-steering pattern after throttle application; yaw_rate is unavailable.",
                    }
                )
    return flags


def _sector_from_distance(distance: float | None) -> str:
    if pd.isna(distance):
        return "Unknown sector"
    if float(distance) < 260:
        return "Sector 1"
    if float(distance) < 560:
        return "Sector 2"
    return "Sector 3"

