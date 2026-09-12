"""Synthetic fixtures validate implementation, not real-world phase accuracy."""

import numpy as np
import pandas as pd

from backend.app.analysis.corner_dynamics import segment_corner_phases, lap_repeatability, analyze_corner_dynamics


def fixture(lap=1):
    """Create a test-only deceleration/corner/recovery with native time."""
    time = np.arange(0, 10, .05)
    speed = 70 - 30 * np.exp(-((time-5)/1.5)**2)
    distance = np.cumsum(speed/3.6*.05)
    frame = pd.DataFrame({"lap": lap, "lap_time_s": time, "speed": speed,
                          "distance_m": distance, "curvature": .025*np.exp(-((time-5)/1.2)**2)})
    zone = {"id": "test", "entry_distance_m": float(distance[50]), "exit_distance_m": float(distance[150])}
    return frame, zone


def test_kinematic_phases_and_missing_values():
    """Return ordered recovery and low-confidence, non-pedal observations."""
    frame, zone = fixture()
    result = segment_corner_phases(frame, zone)
    assert result["status"] == "calculated"
    assert result["complete"]
    assert result["events"]["deceleration_onset"]["lap_time_s"] < result["events"]["minimum_speed"]["lap_time_s"]
    assert result["events"]["minimum_speed"]["lap_time_s"] < result["events"]["acceleration_onset"]["lap_time_s"]
    assert not result["driver_input_confirmed"]
    frame.loc[80:90, "speed"] = np.nan
    assert segment_corner_phases(frame, zone)["status"] == "unavailable"


def test_repeatability_is_not_sensor_noise_or_single_pair_ci():
    """Use lap observations only and do not hardcode an assumed noise floor."""
    assert lap_repeatability([50, 51, 49, 50])["mean_ci95"] is None
    assert lap_repeatability([49, 50, 51, 52, 48]) == lap_repeatability([49, 50, 51, 52, 48])
    frames = [fixture(lap)[0] for lap in range(1, 7)]
    result = analyze_corner_dynamics(pd.concat(frames), [fixture()[1]], [1, 2, 3, 4, 5], 1, 6)
    comparison = result["corners"][0]["comparisons"]["minimum_speed_kmh"]
    assert comparison["repeatability"]["lap_count"] == 5
    assert comparison["target_minus_reference"] is None
    assert comparison["distinguishable_from_sensor_noise"] is None
    assert comparison["pair_effect_ci95"] is None
    assert result["default_035_kmh_applied"] is False


def test_straight_or_gapped_data_is_not_a_complete_corner():
    """Do not force five phases to satisfy a coverage target."""
    frame, zone = fixture()
    frame["curvature"] = 0
    assert segment_corner_phases(frame, zone)["reason"] == "no_resolved_curvature"
    frame, zone = fixture()
    frame.loc[100:, "lap_time_s"] += 2
    assert segment_corner_phases(frame, zone)["reason"] == "nonmonotonic_or_gapped_window"
