"""Describe real fast laps' split advantages without creating a composite lap."""

from __future__ import annotations

import math
from typing import Any


def build_top_lap_segments(
    top_laps: list[dict[str, Any]],
    lap_rows: list[dict[str, Any]],
    boundaries_m: list[float],
) -> dict[str, Any]:
    """Compare recorded splits from up to three quality-gated, completed laps.

    Downstream deltas always use the same pair of laps and the next full sector.
    Millisecond ties are retained; no statistical significance is inferred.
    """
    laps = list(dict.fromkeys(int(row["lap"]) for row in top_laps[:3] if row.get("analysis_eligible") is True))
    source = {int(row["lap"]): row for row in lap_rows if int(row["lap"]) in laps}
    segments = []
    for number in range(1, len(boundaries_m)):
        key = f"sector_{number}"
        values = []
        for lap in laps:
            value = source.get(lap, {}).get(key)
            if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
                values.append({"lap": lap, "time_s": round(float(value), 3)})
        values.sort(key=lambda row: (row["time_s"], laps.index(row["lap"])))
        complete = len(values) == len(laps) and len(laps) >= 2
        best = values[0]["time_s"] if values else None
        winners = [row["lap"] for row in values if row["time_s"] == best] if complete else []
        for row in values:
            row["delta_to_best_s"] = round(row["time_s"] - best, 3) if complete else None
        comparisons = []
        if complete:
            reference = winners[0]
            for row in values:
                if row["lap"] == reference:
                    continue
                target = row["lap"]
                next_values = [source.get(lap, {}).get(f"sector_{number + 1}") for lap in (reference, target)]
                next_delta = None
                if number < len(boundaries_m) - 1 and all(
                    isinstance(value, (int, float)) and math.isfinite(value) and value > 0
                    for value in next_values
                ):
                    next_delta = round(next_values[1] - next_values[0], 3)
                comparisons.append({
                    "reference_lap": reference, "target_lap": target,
                    "local_gain_s": row["delta_to_best_s"],
                    "next_sector_delta_s": next_delta,
                    "net_gain_through_next_s": (
                        round(row["delta_to_best_s"] + next_delta, 3) if next_delta is not None else None
                    ),
                })
        segments.append({
            "id": key, "number": number, "entry_m": boundaries_m[number - 1],
            "exit_m": boundaries_m[number], "rows": values, "winner_laps": winners,
            "status": "calculated" if complete else "insufficient_comparable_laps",
            "comparisons": comparisons,
        })
    return {
        "status": "calculated" if any(s["status"] == "calculated" for s in segments) else "unavailable",
        "laps": laps, "segments": segments, "source": "virtual_distance_sectors",
        "evidence_class": "Calculated", "confidence": "descriptive_only",
        "position_source": "GPS_distance_boundaries", "landmarks_used_for_positioning": False,
        "synthetic_curve_generated": False,
        "limitations": ["not_official_timing_gates", "not_a_causal_or_significance_test",
                        "next_sector_only_not_whole_lap_effect", "no_cross_lap_stitching"],
    }


def segment_report_lines(summary: dict[str, Any], language: str) -> list[str]:
    """Render traceable split observations, not driving instructions or targets."""
    lines = []
    for segment in summary.get("segments", []):
        if segment["status"] != "calculated":
            continue
        laps = ", ".join(str(lap) for lap in segment["winner_laps"])
        time = segment["rows"][0]["time_s"]
        if language == "zh":
            lines.append(f"- Sector {segment['number']}：第 {laps} 圈用时最短（{time:.3f}s）。")
        else:
            lines.append(f"- Sector {segment['number']}: Lap {laps} has the shortest split ({time:.3f}s).")
        for pair in segment["comparisons"]:
            if pair["next_sector_delta_s"] is None:
                continue
            if language == "zh":
                lines.append(
                    f"  相比第 {pair['target_lap']} 圈，第 {pair['reference_lap']} 圈本段快 "
                    f"{pair['local_gain_s']:.3f}s；连同下一段，净优势为 "
                    f"{pair['net_gain_through_next_s']:+.3f}s（负数表示优势被抵消）。"
                )
            else:
                lines.append(
                    f"  Lap {pair['reference_lap']} gains {pair['local_gain_s']:.3f}s here versus "
                    f"Lap {pair['target_lap']}; net gain including the next sector is "
                    f"{pair['net_gain_through_next_s']:+.3f}s (negative means the gain was lost)."
                )
    if lines:
        lines.append(
            "这些是 GPS 等距分段的描述性结果，不是官方计时点、因果结论或可拼接的目标圈。"
            if language == "zh" else
            "These GPS-distance splits are descriptive, not official timing gates, causal claims or a composite target lap."
        )
    return lines
