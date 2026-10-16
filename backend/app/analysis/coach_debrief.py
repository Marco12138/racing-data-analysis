"""Driver-facing observations, review questions and separately gated training."""

from __future__ import annotations

import math
import re
from typing import Any


def _number(value: Any) -> float | None:
    """Accept finite measured/calculated values, including legitimate zero."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _corner_name(value: str, zh: bool) -> str:
    """Localize generated zones without inventing official corner numbers."""
    if zh:
        return re.sub(r"^(?:Suggested )?Zone\s+", "区间 ", value, flags=re.I)
    return value


def build_coach_debrief(result: dict[str, Any], language: str = "en") -> dict[str, Any]:
    """Describe real differences even when no change in driving is justified."""
    zh = language == "zh"
    quality = result.get("lap_quality") or {}
    top = quality.get("top_valid_laps", [])[:3]
    eligible = {row["lap"] for row in top if row.get("analysis_eligible", True)}
    observations: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    training: list[dict[str, Any]] = []
    for row in top:
        lap_time = _number(row.get("lap_time"))
        if row.get("lap") in eligible and lap_time is not None:
            observations.append({
                "id": f"lap:{row['lap']}", "location": f"L{row['lap']}", "evidence_class": "measured",
                "text": (f"真实有效圈 L{row['lap']}：{lap_time:.3f} 秒。" if zh else
                         f"Real eligible lap L{row['lap']}: {lap_time:.3f} s."),
                "evidence": {"lap": row["lap"], "lap_time_s": lap_time},
            })
    sectors = result.get("sectors") or {}
    rows = [r for r in sectors.get("lap_rows", []) if r.get("lap") in eligible]
    for key in sorted(sectors.get("sector_best", {})):
        values = [(r["lap"], _number(r.get(key))) for r in rows]
        values = [(lap, value) for lap, value in values if value is not None]
        if len(values) < 2:
            continue
        best = min(value for _, value in values)
        winners = [lap for lap, value in values if value == best]
        name = key.replace("sector_", "Sector ")
        laps = ", ".join(f"L{lap}" for lap in winners)
        observations.append({
            "id": f"sector:{key}", "location": name, "evidence_class": "calculated",
            "text": (f"{name}：前三快有效圈中，{laps} 用时最短，为 {best:.3f} 秒。"
                     if zh else f"{name}: among the eligible Top 3, {laps} is quickest at {best:.3f} s."),
            "evidence": {"lap_times": [{"lap": lap, "time_s": value} for lap, value in values],
                         "official": bool(sectors.get("official"))},
        })

    reference, target = result.get("reference_lap"), result.get("target_lap")
    for zone in (result.get("zones") or {}).get("comparisons", []):
        if reference == target:
            continue
        location = _corner_name(str(zone.get("name", zone.get("id", ""))), zh)
        details = []
        evidence = []
        for finding in zone.get("findings", []):
            delta = _number(finding.get("difference"))
            if delta is None:
                continue
            metric = finding.get("metric")
            absolute = abs(delta)
            if metric in {"lift_distance_m", "reacceleration_distance_m"}:
                # These are inferred signal events, never direct pedal measurements.
                event = ("转速下降迹象" if metric == "lift_distance_m" else "重新加速迹象") if zh else (
                    "RPM reduction pattern" if metric == "lift_distance_m" else "acceleration recovery pattern")
                direction = ("提前" if delta < 0 else "推迟") if zh else ("earlier" if delta < 0 else "later")
                details.append((f"{event}比参考圈{direction} {absolute:.1f} 米" if zh else
                                f"the {event} occurs {absolute:.1f} m {direction} than the reference lap")
                               if absolute >= .05 else (f"{event}位置接近" if zh else f"the {event} occurs at a similar position"))
                evidence_class = "inferred"
            elif metric in {"minimum_rpm", "exit_speed_kmh", "elapsed_time_s"}:
                label = {"minimum_rpm": ("最低转速", "minimum RPM", "rpm"),
                         "exit_speed_kmh": ("出弯速度", "exit speed", "km/h"),
                         "elapsed_time_s": ("区间用时", "zone time", "s")}[metric]
                digits = {"minimum_rpm": 0, "exit_speed_kmh": 2, "elapsed_time_s": 3}[metric]
                amount = f"{absolute:.{digits}f}"
                if float(amount) == 0:
                    details.append(f"{label[0]}数值接近" if zh else f"{label[1]} values are similar")
                else:
                    word = ("低" if delta < 0 else "高") if zh else ("lower" if delta < 0 else "higher")
                    if metric == "elapsed_time_s":
                        word = ("快" if delta < 0 else "慢") if zh else ("shorter" if delta < 0 else "longer")
                    details.append(f"{label[0]}比参考圈{word} {amount} {label[2]}" if zh else
                                   f"{label[1]} is {amount} {label[2]} {word} than the reference lap")
                evidence_class = "calculated"
            else:
                continue
            evidence.append({key: finding[key] for key in ("metric", "reference", "target", "difference", "unit") if key in finding})
            evidence[-1]["evidence_class"] = evidence_class
        if not details:
            continue
        identifier = f"zone:{zone['id']}"
        observations.append({
            "id": identifier, "location": location, "corner_id": zone["id"],
            "evidence_class": "calculated_and_inferred", "reference_lap": reference, "target_lap": target,
            "text": f"{location} · L{target} / L{reference}：" + "；".join(details) + "。" if zh else
                    f"{location} · L{target} / L{reference}: " + "; ".join(details) + ".",
            "evidence": {"findings": evidence},
        })
        loss = _number(zone.get("estimated_zone_loss_s"))
        differences = {f["metric"]: f["difference"] for f in evidence}
        recovery, exit_speed = differences.get("reacceleration_distance_m"), differences.get("exit_speed_kmh")
        if recovery is not None and recovery < 0 and exit_speed is not None and exit_speed <= 0:
            question = ("重新加速迹象更早，但出弯速度数值没有更高。请对照两圈画面，核对恢复过程是否连续，"
                        "并查看优势有没有延续到下游。" if zh else
                        "The recovery pattern is earlier, but exit speed is not numerically higher. Compare the footage for continuity of recovery and check the downstream outcome.")
        elif exit_speed is not None and exit_speed < 0:
            question = ("目标圈的出弯速度数值更低。优先复盘最低速度位置到出弯的画面，核对差异从何时开始。" if zh else
                        "The selected lap has a numerically lower exit speed. Review the footage from minimum speed to the exit to locate the start of the difference.")
        else:
            question = ("对照两圈减速、最低速度和出弯恢复的画面，检查这个区间的时间差是否在下游保留。" if zh else
                        "Compare deceleration, minimum speed and recovery on video; check whether the zone-time difference persists downstream.")
        reviews.append({
            "id": identifier, "corner_id": zone["id"], "location": location,
            "text": f"{location}：{question}" if zh else f"{location}: {question}",
            "observed_zone_delta_s": loss, "requires_video_confirmation": True,
        })
    reviews.sort(key=lambda row: abs(row["observed_zone_delta_s"] or 0), reverse=True)
    priorities = (result.get("ai_coach_summary") or {}).get("training_priorities", [])
    for index, priority in enumerate(priorities[:3]):
        location = _corner_name(priority["corner"], zh)
        training.append({
            "id": f"training:{index}", "location": location,
            "text": f"{location}：{priority.get('why', '')}\n{priority.get('training_drill', '')}\n{priority.get('stop_condition', '')}" if zh else
                    f"{location}: {priority.get('why', '')}\n{priority.get('training_drill', '')}\n{priority.get('stop_condition', '')}",
            "confidence": priority.get("confidence", "low"),
            "evidence": {"why": priority.get("why"), "limitation": priority.get("limitation")},
        })
    return {
        "version": 1, "language": "zh" if zh else "en", "observations": observations,
        "reviews": reviews[:3], "training": training,
        "no_training_reason": ("目前没有足够证据建议改变驾驶操作；上面的观察仍可用于视频复盘。" if zh else
                               "There is not enough evidence to change driving inputs yet; the observations still support video review."),
        "limitations": (["相对距离描述信号事件的位置差，不是要求移动刹车点。",
                         "观察差异不等于已排除测量误差，也不证明驾驶原因。",
                         "自动区间不是官方弯号；没有合成参考圈，也不保证获得时间收益。"] if zh else
                        ["Relative distances describe signal-event differences, not instructions to move a braking point.",
                         "Observed differences do not establish separation from measurement error or a driving cause.",
                         "Suggested zones are not official corner numbers. No synthetic references or guaranteed gains."]),
    }
