"""Synthetic fixtures validate implementation, not real-world phase accuracy."""

import numpy as np
import pandas as pd
import pytest
from scipy.stats import t as student_t

from backend.app.analysis.corner_dynamics import (
    segment_corner_phases, lap_repeatability, analyze_corner_dynamics, fit_zone_thresholds, leave_two_out_band,
)


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
    calibration = fit_zone_thresholds({1: frame}, zone)
    result = segment_corner_phases(frame, zone, calibration)
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


@pytest.mark.parametrize("count", [5, 6, 8, 12, 20])
def test_t_interval_matches_formula(count):
    """Small-sample mean uncertainty uses the Student t correction, not bootstrap percentiles."""
    values = np.arange(count, dtype=float)
    result = lap_repeatability(values.tolist())
    margin = student_t.ppf(.975, count - 1) * np.std(values, ddof=1) / np.sqrt(count)
    assert result["mean_ci95"] == pytest.approx([values.mean() - margin, values.mean() + margin])
    assert result["ci_method"] == "student_t_iid_mean"
    assert "Serial correlation" in result["limitations"]
    assert result["pair_difference_band95"] is None


def test_background_excludes_both_selected_laps():
    """Changing either comparison observation cannot change its background band."""
    values = {lap: float(lap) for lap in range(1, 8)}
    original = leave_two_out_band(values, 1, 7)
    values.update({1: -1000., 7: 1000.})
    assert leave_two_out_band(values, 1, 7) == original
    assert original["source_laps"] == [2, 3, 4, 5, 6]
    assert original["pair_count"] == 10
    assert original["pair_difference_band95"] == pytest.approx(3.55)
    short = leave_two_out_band({lap: float(lap) for lap in range(1, 7)}, 1, 6)
    assert short["pair_difference_band95"] is None
    assert short["lap_count"] == 4
    assert short["reason"] == "fewer_than_five_background_laps"


def test_zone_thresholds_are_shared_and_selection_invariant():
    """Different real-lap profiles use one calibration, regardless of which pair is selected."""
    frames = []
    for lap in range(1, 8):
        frame, zone = fixture(lap)
        frame["curvature"] *= .7 + .1 * lap
        frame["speed"] += lap
        frames.append(frame)
    telemetry = pd.concat(frames)
    result = analyze_corner_dynamics(telemetry, [zone], list(range(1, 8)), 1, 7)
    corner = result["corners"][0]
    calibration = corner["calibration"]
    assert calibration["source_laps"] == list(range(1, 8))
    assert all(row["thresholds"] == calibration["thresholds"] for row in corner["phases"])
    other = analyze_corner_dynamics(telemetry, [zone], list(range(1, 8)), 3, 4)
    assert other["corners"][0]["calibration"] == calibration
    assert corner["comparisons"]["minimum_speed_kmh"]["background"]["source_laps"] == [2, 3, 4, 5, 6]


def test_minimum_value_and_location_use_same_smoothed_signal():
    """A raw isolated dip must not become a separate metric from the minimum event."""
    frame, zone = fixture()
    frame.loc[70, "speed"] = 1.
    result = segment_corner_phases(frame, zone, fit_zone_thresholds({1: frame}, zone))
    assert result["metrics"]["minimum_speed_kmh"] == result["events"]["minimum_speed"]["speed_kmh"]
    assert result["metrics"]["minimum_speed_kmh"] > 35
    assert result["events"]["minimum_speed"]["lap_time_s"] > frame.loc[70, "lap_time_s"]
    assert segment_corner_phases(frame, zone)["reason"] == "zone_thresholds_unavailable"
