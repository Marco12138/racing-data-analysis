"""Lap and sector analysis functions for backend API."""

from __future__ import annotations

import pandas as pd


def sector_columns(df: pd.DataFrame) -> list[str]:
    """Return all sector columns in dataframe order."""
    return [column for column in df.columns if column.startswith("sector_")]


def analyze_laps(df: pd.DataFrame) -> dict:
    """Calculate fastest lap, theoretical best, deltas, sector loss, and ranking."""
    required = {"lap", "lap_time"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing lap columns: {sorted(missing)}")
    sectors = sector_columns(df)
    if not sectors:
        raise ValueError("At least one sector_ column is required.")

    working = df.copy()
    for column in ["lap", "lap_time", *sectors]:
        working[column] = pd.to_numeric(working[column], errors="coerce")
    working = working.dropna(subset=["lap", "lap_time", *sectors]).sort_values("lap")

    fastest = working.loc[working["lap_time"].idxmin()]
    sector_best = {sector: float(working[sector].min()) for sector in sectors}
    theoretical_best = float(sum(sector_best.values()))
    fastest_lap_time = float(fastest["lap_time"])

    lap_deltas = []
    sector_loss_rows = []
    for _, row in working.iterrows():
        lap_deltas.append(
            {
                "lap": int(row["lap"]),
                "lap_time": float(row["lap_time"]),
                "delta_to_best": float(row["lap_time"] - fastest_lap_time),
            }
        )
        losses = {f"{sector}_loss": float(row[sector] - sector_best[sector]) for sector in sectors}
        max_loss_sector = max(sectors, key=lambda sector: losses[f"{sector}_loss"])
        sector_loss_rows.append(
            {
                "lap": int(row["lap"]),
                **losses,
                "total_loss": float(sum(losses.values())),
                "max_loss_sector": max_loss_sector,
            }
        )

    sector_ranking = []
    for sector in sectors:
        values = working[sector]
        loss_values = [row[f"{sector}_loss"] for row in sector_loss_rows]
        sector_ranking.append(
            {
                "sector": sector,
                "best": float(values.min()),
                "average": float(values.mean()),
                "average_loss": float(sum(loss_values) / len(loss_values)),
                "range": float(values.max() - values.min()),
            }
        )

    main_loss = max(sector_ranking, key=lambda item: item["average_loss"])
    return {
        "total_laps": int(len(working)),
        "fastest_lap": {
            "lap": int(fastest["lap"]),
            "lap_time": fastest_lap_time,
            "sectors": {sector: float(fastest[sector]) for sector in sectors},
        },
        "theoretical_best_lap": theoretical_best,
        "potential_gain": fastest_lap_time - theoretical_best,
        "average_lap_time": float(working["lap_time"].mean()),
        "sector_best": sector_best,
        "lap_deltas": lap_deltas,
        "sector_loss": sector_loss_rows,
        "sector_ranking": sector_ranking,
        "main_loss_sector": main_loss["sector"],
    }

