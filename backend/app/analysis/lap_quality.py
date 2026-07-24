"""Quality-gate timed laps before they can become driving references."""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np
import pandas as pd


DEFAULT_LAP_QUALITY_CONFIG: dict[str, float] = {
    "absolute_gap_threshold_s": 0.5,
    "relative_gap_threshold_pct": 1.0,
    "minimum_samples": 20.0,
    "minimum_distance_ratio": 0.85,
    "minimum_sample_ratio": 0.50,
    "maximum_stopped_fraction": 0.15,
}

REFERENCE_ELIGIBLE = "REFERENCE_ELIGIBLE"


def classify_lap_quality(
    laps: Any,
    telemetry: pd.DataFrame | None,
    config: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Classify timed laps and mark only comparable complete laps as references."""
    settings = {**DEFAULT_LAP_QUALITY_CONFIG, **(config or {})}
    rows = _normalize_laps(laps)
    if not rows:
        return []

    valid_times = [row["lap_time"] for row in rows if row["lap_time"] > 0]
    fastest_time = min(valid_times)
    gap_limit = max(
        settings["absolute_gap_threshold_s"],
        fastest_time * settings["relative_gap_threshold_pct"] / 100.0,
    )
    telemetry_stats = _telemetry_stats(telemetry)
    classifications: list[dict[str, Any]] = []

    for row in rows:
        lap_number = row["lap"]
        lap_time = row["lap_time"]
        notes = str(row.get("notes") or "").lower()
        reasons: list[str] = []
        status: str | None = None
        score = 1.0
        lap_frame = (
            telemetry[telemetry["lap"] == lap_number]
            if telemetry is not None and "lap" in telemetry
            else pd.DataFrame()
        )

        if lap_number <= 0 or not np.isfinite(lap_time) or lap_time <= 0:
            status = "INVALID"
            reasons.append("Lap timing is missing or invalid.")
        elif "warm" in notes:
            status = "WARMUP"
            reasons.append("Lap is marked as warm-up.")
        elif "cool" in notes:
            status = "COOLDOWN"
            reasons.append("Lap is marked as cool-down.")
        elif "pit" in notes or "out lap" in notes or "in lap" in notes:
            status = "PIT_LAP"
            reasons.append("Lap is marked as a pit, in, or out lap.")

        if telemetry is not None and not telemetry.empty:
            sample_count = len(lap_frame)
            if sample_count < settings["minimum_samples"]:
                status = status or "INCOMPLETE"
                reasons.append("Too few telemetry samples for a complete comparison.")
                score -= 0.45
            median_samples = telemetry_stats.get("median_samples", 0.0)
            if median_samples and sample_count < median_samples * settings["minimum_sample_ratio"]:
                status = status or "OUTLIER"
                reasons.append("Telemetry sample coverage is far below the session median.")
                score -= 0.25

            if not lap_frame.empty and "distance_m" in lap_frame:
                distance = _finite_max(lap_frame["distance_m"])
                median_distance = telemetry_stats.get("median_distance", 0.0)
                if (
                    median_distance
                    and distance < median_distance * settings["minimum_distance_ratio"]
                ):
                    status = status or "INCOMPLETE"
                    reasons.append("GPS distance does not cover a comparable full lap.")
                    score -= 0.35

            if not lap_frame.empty and "speed" in lap_frame:
                speed = pd.to_numeric(lap_frame["speed"], errors="coerce").dropna()
                stopped_fraction = float((speed < 2.0).mean()) if len(speed) else 0.0
                if stopped_fraction > settings["maximum_stopped_fraction"]:
                    status = status or "TRAFFIC_AFFECTED"
                    reasons.append("Extended near-stop period makes this lap non-comparable.")
                    score -= 0.30

            if not lap_frame.empty and "rpm" in lap_frame:
                rpm = pd.to_numeric(lap_frame["rpm"], errors="coerce")
                invalid_rpm_fraction = float((rpm.isna() | (rpm < 0)).mean())
                if invalid_rpm_fraction > 0.10:
                    status = status or "OUTLIER"
                    reasons.append("RPM coverage contains too many invalid samples.")
                    score -= 0.25

        gap = lap_time - fastest_time
        if status is None:
            if gap <= gap_limit + 1e-9:
                status = REFERENCE_ELIGIBLE
            else:
                status = "CONTEXT_ONLY"
                reasons.append(
                    f"Lap gap exceeds the {gap_limit:.3f}s reference threshold."
                )
                score -= min(0.45, gap / max(fastest_time, 1.0))

        score -= min(0.25, max(0.0, gap) / max(gap_limit, 0.001) * 0.08)
        classifications.append(
            {
                "lap": lap_number,
                "lap_time": round(lap_time, 6),
                "gap_to_fastest": round(gap, 6),
                "quality_status": status,
                "quality_score": round(float(np.clip(score, 0.0, 1.0)), 3),
                "reasons": reasons,
                "analysis_eligible": status == REFERENCE_ELIGIBLE,
            }
        )
    return classifications


def select_reference_eligible_laps(
    laps: Iterable[dict[str, Any]],
    fastest_lap_time: float | None = None,
    absolute_threshold_s: float = 0.5,
    relative_threshold_pct: float = 1.0,
) -> list[dict[str, Any]]:
    """Return ranked real laps that pass the configured pace threshold."""
    rows = [dict(row) for row in laps]
    if not rows:
        return []
    fastest = fastest_lap_time
    if fastest is None:
        fastest = min(float(row["lap_time"]) for row in rows)
    limit = max(absolute_threshold_s, fastest * relative_threshold_pct / 100.0)
    eligible = [
        row
        for row in rows
        if row.get("analysis_eligible", True)
        and float(row["lap_time"]) - fastest <= limit + 1e-9
    ]
    return sorted(eligible, key=lambda row: (float(row["lap_time"]), int(row["lap"])))


def select_fastest_consistent_lap(
    quality_rows: list[dict[str, Any]],
    telemetry: pd.DataFrame | None,
) -> dict[str, Any] | None:
    """Choose the quickest eligible lap whose aggregate behavior is least anomalous."""
    eligible = [row for row in quality_rows if row["analysis_eligible"]]
    if not eligible:
        return None
    if telemetry is None or telemetry.empty or "lap" not in telemetry:
        return dict(eligible[0])

    signatures: list[dict[str, float]] = []
    channels = [
        column
        for column in ("speed", "rpm", "longitudinal_g", "lateral_g", "curvature")
        if column in telemetry
    ]
    for row in eligible:
        frame = telemetry[telemetry["lap"] == row["lap"]]
        signature: dict[str, float] = {"lap": float(row["lap"])}
        for channel in channels:
            values = pd.to_numeric(frame[channel], errors="coerce").dropna()
            if len(values):
                signature[f"{channel}_median"] = float(values.median())
                signature[f"{channel}_spread"] = float(
                    values.quantile(0.90) - values.quantile(0.10)
                )
        signatures.append(signature)
    signature_frame = pd.DataFrame(signatures).set_index("lap")
    feature_columns = list(signature_frame.columns)
    if not feature_columns:
        return dict(eligible[0])

    median = signature_frame.median()
    scale = (signature_frame.quantile(0.75) - signature_frame.quantile(0.25)).replace(
        0.0, 1.0
    )
    anomaly = ((signature_frame - median).abs() / scale).median(axis=1).fillna(0.0)
    fastest_time = min(float(row["lap_time"]) for row in eligible)
    ranked: list[tuple[float, float, dict[str, Any]]] = []
    for row in eligible:
        behavior_anomaly = float(anomaly.get(float(row["lap"]), 0.0))
        pace_penalty = max(0.0, float(row["lap_time"]) - fastest_time)
        consistent_score = float(
            np.clip(row["quality_score"] - min(0.45, behavior_anomaly * 0.12), 0.0, 1.0)
        )
        output = {
            **row,
            "consistency_score": round(consistent_score, 3),
            "behavior_anomaly_score": round(behavior_anomaly, 3),
        }
        ranked.append((-consistent_score, pace_penalty, output))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return ranked[0][2]


def build_lap_quality_summary(
    quality_rows: list[dict[str, Any]],
    telemetry: pd.DataFrame | None,
    config: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Build the public quality-gate payload and real-lap reference ranking."""
    settings = {**DEFAULT_LAP_QUALITY_CONFIG, **(config or {})}
    eligible = sorted(
        (row for row in quality_rows if row["analysis_eligible"]),
        key=lambda row: (row["lap_time"], row["lap"]),
    )
    return {
        "config": {
            "absolute_gap_threshold_s": settings["absolute_gap_threshold_s"],
            "relative_gap_threshold_pct": settings["relative_gap_threshold_pct"],
        },
        "laps": quality_rows,
        "reference_eligible_count": len(eligible),
        "top_valid_laps": eligible[:3],
        "fastest_consistent_lap": select_fastest_consistent_lap(
            quality_rows, telemetry
        ),
        "minimum_top_laps_met": len(eligible) >= 3,
        "notice": (
            None
            if len(eligible) >= 3
            else f"Only {len(eligible)} reference-eligible lap(s) are available; "
            "lower-quality laps were not used to fill the Top 3."
        ),
    }


def _normalize_laps(laps: Any) -> list[dict[str, Any]]:
    """Normalize manifest timing, dataframe rows, or dictionaries."""
    if isinstance(laps, pd.DataFrame):
        source = laps.to_dict(orient="records")
    elif isinstance(laps, dict):
        source = [
            {"lap": lap, **(value if isinstance(value, dict) else {})}
            for lap, value in laps.items()
        ]
    else:
        source = list(laps or [])
    rows: list[dict[str, Any]] = []
    for source_row in source:
        lap = int(source_row.get("lap", source_row.get("num", 0)))
        lap_time = source_row.get(
            "lap_time",
            source_row.get("duration_s", source_row.get("lap_time_s")),
        )
        try:
            duration = float(lap_time)
        except (TypeError, ValueError):
            duration = float("nan")
        rows.append(
            {
                "lap": lap,
                "lap_time": duration,
                "notes": source_row.get("notes", ""),
            }
        )
    return sorted(rows, key=lambda row: row["lap"])


def _telemetry_stats(telemetry: pd.DataFrame | None) -> dict[str, float]:
    if telemetry is None or telemetry.empty or "lap" not in telemetry:
        return {}
    groups = telemetry.groupby("lap")
    stats = {"median_samples": float(groups.size().median())}
    if "distance_m" in telemetry:
        stats["median_distance"] = float(groups["distance_m"].max().median())
    return stats


def _finite_max(values: pd.Series) -> float:
    numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan)
    return float(numeric.max()) if numeric.notna().any() else 0.0
