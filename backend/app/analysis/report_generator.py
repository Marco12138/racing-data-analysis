"""Driver review report generation."""

from __future__ import annotations


_FOCUS_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "consistency": "sector speed consistency",
        "steering": "steering trace",
        "rpm": "RPM trace",
        "lateral_g": "lateral G",
        "brake": "braking point stability",
        "throttle": "corner exit throttle application",
    },
    "zh": {
        "consistency": "弯中速度一致性",
        "steering": "转向轨迹",
        "rpm": "RPM 曲线",
        "lateral_g": "横向 G",
        "brake": "刹车点稳定性",
        "throttle": "出弯油门施加",
    },
}

_TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "summary": "Session Summary: The driver completed {total_laps} laps.",
        "fastest": "The fastest lap was Lap {lap} at {lap_time:.3f}s.",
        "main_loss": "The largest performance loss comes from {sector}.",
        "all_real": (
            "All lap references are real completed laps; sector best values are "
            "local diagnostics and are not combined into a target lap."
        ),
        "max_speed": (
            "Maximum speed reached {maximum_speed:.1f} km/h with average speed "
            "{average_speed:.1f} km/h."
        ),
        "max_g": "Maximum lateral G was {maximum_lateral_g:.2f} g.",
        "flags": (
            "Driving Behavior Assistant flagged {understeer} possible understeer "
            "event(s) and {oversteer} possible oversteer event(s)."
        ),
        "unavailable": (
            "Driving Behavior Assistant is unavailable because brake and throttle "
            "channels were not recorded."
        ),
        "focus": "Recommended focus: review {focus}.",
        "synthetic": (
            "No synthetic target lap or RPM trace is generated, and no combination "
            "of local improvements is guaranteed to coexist in one lap."
        ),
        "heuristic": "Handling analysis is heuristic and must be validated by a driver or coach.",
    },
    "zh": {
        "summary": "会话摘要：车手共完成 {total_laps} 圈。",
        "fastest": "最快圈为第 {lap} 圈，{lap_time:.3f}s。",
        "main_loss": "最大的时间损失来自 {sector}。",
        "all_real": "所有参考圈均为真实完成圈；Sector 最优值仅作本地诊断，不合并为理论圈。",
        "max_speed": "最高速度 {maximum_speed:.1f} km/h，平均速度 {average_speed:.1f} km/h。",
        "max_g": "最大横向 G 为 {maximum_lateral_g:.2f} g。",
        "flags": "驾驶行为助手标记 {understeer} 个可能的转向不足事件、{oversteer} 个可能的转向过度事件。",
        "unavailable": "驾驶行为助手不可用：未记录刹车与油门通道。",
        "focus": "建议复盘重点：{focus}。",
        "synthetic": "不生成合成目标圈或 RPM 曲线；本地改进的组合不保证能在一圈内共存。",
        "heuristic": "操控分析为启发式判断，需由车手或教练验证。",
    },
}


def generate_report(
    lap_result: dict,
    telemetry_result: dict | None,
    handling_flags: list[dict],
    language: str = "en",
) -> str:
    """Generate an AI-style natural language report from structured findings."""
    understeer = [flag for flag in handling_flags if flag["event_type"] == "Possible Understeer"]
    oversteer = [flag for flag in handling_flags if flag["event_type"] == "Possible Oversteer"]
    available_channels = set(telemetry_result.get("available_channels", [])) if telemetry_result else set()
    has_brake = "brake" in available_channels
    has_throttle = "throttle" in available_channels
    t = _TEMPLATES["zh" if language == "zh" else "en"]
    focus_labels = _FOCUS_LABELS["zh" if language == "zh" else "en"]
    lines = [
        t["summary"].format(total_laps=lap_result["total_laps"]),
        t["fastest"].format(
            lap=lap_result["fastest_lap"]["lap"],
            lap_time=lap_result["fastest_lap"]["lap_time"],
        ),
        t["main_loss"].format(
            sector=lap_result["main_loss_sector"].replace("sector_", "Sector "),
        ),
        t["all_real"],
    ]
    if telemetry_result:
        if telemetry_result.get("maximum_speed") is not None:
            lines.append(
                t["max_speed"].format(
                    maximum_speed=telemetry_result["maximum_speed"],
                    average_speed=telemetry_result["average_speed"],
                )
            )
        if telemetry_result.get("maximum_lateral_g") is not None:
            lines.append(
                t["max_g"].format(maximum_lateral_g=telemetry_result["maximum_lateral_g"])
            )
    if has_brake or has_throttle:
        lines.append(
            t["flags"].format(understeer=len(understeer), oversteer=len(oversteer))
        )
    else:
        lines.append(t["unavailable"])

    focus = [focus_labels["consistency"]]
    if "steering_angle" in available_channels:
        focus.append(focus_labels["steering"])
    if "rpm" in available_channels:
        focus.append(focus_labels["rpm"])
    if "lateral_g" in available_channels:
        focus.append(focus_labels["lateral_g"])
    if has_brake:
        focus.append(focus_labels["brake"])
    if has_throttle:
        focus.append(focus_labels["throttle"])
    lines.append(t["focus"].format(focus=", ".join(focus)))
    lines.append(t["synthetic"])
    lines.append(t["heuristic"])
    return "\n\n".join(lines)
