"""Driver review report generation."""

from __future__ import annotations


def generate_report(lap_result: dict, telemetry_result: dict | None, handling_flags: list[dict]) -> str:
    """Generate an AI-style natural language report from structured findings."""
    understeer = [flag for flag in handling_flags if flag["event_type"] == "Possible Understeer"]
    oversteer = [flag for flag in handling_flags if flag["event_type"] == "Possible Oversteer"]
    available_channels = set(telemetry_result.get("available_channels", [])) if telemetry_result else set()
    has_brake = "brake" in available_channels
    has_throttle = "throttle" in available_channels
    lines = [
        f"Session Summary: The driver completed {lap_result['total_laps']} laps.",
        f"The fastest lap was Lap {lap_result['fastest_lap']['lap']} at {lap_result['fastest_lap']['lap_time']:.3f}s.",
        f"The largest performance loss comes from {lap_result['main_loss_sector'].replace('sector_', 'Sector ')}.",
        "All lap references are real completed laps; sector best values are local diagnostics and are not combined into a target lap.",
    ]
    if telemetry_result:
        if telemetry_result.get("maximum_speed") is not None:
            lines.append(
                f"Maximum speed reached {telemetry_result['maximum_speed']:.1f} km/h with average speed {telemetry_result['average_speed']:.1f} km/h."
            )
        if telemetry_result.get("maximum_lateral_g") is not None:
            lines.append(f"Maximum lateral G was {telemetry_result['maximum_lateral_g']:.2f} g.")
    if has_brake or has_throttle:
        lines.append(
            f"Driving Behavior Assistant flagged {len(understeer)} possible understeer event(s) and {len(oversteer)} possible oversteer event(s)."
        )
    else:
        lines.append(
            "Driving Behavior Assistant is unavailable because brake and throttle channels were not recorded."
        )

    focus = ["sector speed consistency"]
    if "steering_angle" in available_channels:
        focus.append("steering trace")
    if "rpm" in available_channels:
        focus.append("RPM trace")
    if "lateral_g" in available_channels:
        focus.append("lateral G")
    if has_brake:
        focus.append("braking point stability")
    if has_throttle:
        focus.append("corner exit throttle application")
    lines.append(f"Recommended focus: review {', '.join(focus)}.")
    lines.append(
        "No synthetic target lap or RPM trace is generated, and no combination of local improvements is guaranteed to coexist in one lap."
    )
    lines.append("Handling analysis is heuristic and must be validated by a driver or coach.")
    return "\n\n".join(lines)
