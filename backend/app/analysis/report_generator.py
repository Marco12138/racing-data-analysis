"""Driver review report generation."""

from __future__ import annotations


def generate_report(lap_result: dict, telemetry_result: dict | None, handling_flags: list[dict]) -> str:
    """Generate an AI-style natural language report from structured findings."""
    understeer = [flag for flag in handling_flags if flag["event_type"] == "Possible Understeer"]
    oversteer = [flag for flag in handling_flags if flag["event_type"] == "Possible Oversteer"]
    lines = [
        f"Session Summary: The driver completed {lap_result['total_laps']} laps.",
        f"The fastest lap was Lap {lap_result['fastest_lap']['lap']} at {lap_result['fastest_lap']['lap_time']:.3f}s.",
        f"The theoretical best lap is {lap_result['theoretical_best_lap']:.3f}s, leaving {lap_result['potential_gain']:.3f}s of potential gain.",
        f"The largest performance loss comes from {lap_result['main_loss_sector'].replace('sector_', 'Sector ')}.",
    ]
    if telemetry_result:
        if telemetry_result.get("maximum_speed") is not None:
            lines.append(
                f"Maximum speed reached {telemetry_result['maximum_speed']:.1f} km/h with average speed {telemetry_result['average_speed']:.1f} km/h."
            )
        if telemetry_result.get("maximum_lateral_g") is not None:
            lines.append(f"Maximum lateral G was {telemetry_result['maximum_lateral_g']:.2f} g.")
    lines.append(
        f"Driving Behavior Assistant flagged {len(understeer)} possible understeer event(s) and {len(oversteer)} possible oversteer event(s)."
    )
    lines.append("Recommended focus: review braking point stability, entry speed consistency, and corner exit throttle application.")
    lines.append("Handling analysis is heuristic and must be validated by a driver or coach.")
    return "\n\n".join(lines)

