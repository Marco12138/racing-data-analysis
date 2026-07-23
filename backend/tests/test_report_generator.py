"""Report wording must respect unavailable telemetry channels."""

from __future__ import annotations

from backend.app.analysis.report_generator import generate_report


def lap_result() -> dict:
    return {
        "total_laps": 2,
        "fastest_lap": {"lap": 2, "lap_time": 41.2},
        "theoretical_best_lap": 41.0,
        "potential_gain": 0.2,
        "main_loss_sector": "sector_2",
    }


def test_report_does_not_invent_brake_or_throttle_findings() -> None:
    telemetry = {
        "available_channels": [
            "time",
            "lap",
            "distance",
            "speed",
            "steering_angle",
            "rpm",
            "lateral_g",
        ],
        "maximum_speed": 106.9,
        "average_speed": 70.1,
        "maximum_lateral_g": 2.8,
    }

    report = generate_report(lap_result(), telemetry, [])

    assert "unavailable because brake and throttle channels were not recorded" in report
    assert "braking point stability" not in report
    assert "corner exit throttle application" not in report
    assert "steering trace" in report
    assert "RPM trace" in report


def test_report_adds_recommendations_only_for_recorded_inputs() -> None:
    telemetry = {
        "available_channels": ["speed", "brake", "throttle"],
        "maximum_speed": 100.0,
        "average_speed": 70.0,
    }

    report = generate_report(lap_result(), telemetry, [])

    assert "braking point stability" in report
    assert "corner exit throttle application" in report
    assert "flagged 0 possible understeer" in report

