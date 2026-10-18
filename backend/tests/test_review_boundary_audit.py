"""The private boundary experiment must not invent timing or alter real anchors."""
from copy import deepcopy

import pytest

from scripts.audit_review_boundaries import interpolate, make_windows


def test_bounded_interpolation_rejects_missing_spans_and_extrapolation():
    """Only interpolate adjacent measurements within the configured gap limit."""
    rows = [{"time": 0, "distance": 0}, {"time": .5, "distance": 2}, {"time": 2, "distance": 8}]
    assert interpolate(rows, .25, "time", "distance", 1) == 1
    for at in (-1, 1, 3):
        with pytest.raises(ValueError):
            interpolate(rows, at, "time", "distance", 1)
    rows[1]["distance"] = None
    with pytest.raises(ValueError):
        interpolate(rows, .25, "time", "distance", 1)


def fixture():
    """Small test-only traces deliberately have unequal speeds and lap durations."""
    rows = lambda start, speed: [{"distance_m": i, "session_time_s": start+i/speed, "speed": abs(i-50)+20} for i in range(201)]
    source, target = rows(100, 10), rows(120, 12)
    return {"target_lap": 4, "reference_lap": 5, "track": {"target": source, "reference": target},
            "top_lap_segments": {"segments": [{"id": "s1", "entry_m": 0, "exit_m": 100}]}}


def test_shared_start_position_and_five_seconds_do_not_imply_shared_end():
    """Use real timestamps rather than a repeated lap time or the other lap's slope."""
    analysis = fixture()
    before = deepcopy(analysis)
    windows = make_windows(analysis, 4, 23.464, [5], [])
    row = windows[0]
    assert row["start_distance_m"] == 30
    assert row["clips"]["4"]["start_s"] == pytest.approx(126.464)
    assert row["clips"]["5"]["start_s"] == pytest.approx(145.964)
    for clip in row["clips"].values():
        assert clip["end_s"]-clip["start_s"] == pytest.approx(5)
    assert row["clips"]["5"]["end_distance_m"]-row["clips"]["4"]["end_distance_m"] == pytest.approx(10)
    assert analysis == before


def test_five_second_preview_outside_lap_is_rejected_not_padded():
    """No replaying frames or crossing a lap boundary to make up five seconds."""
    with pytest.raises(ValueError):
        make_windows(fixture(), 4, 23.464, [5], [190])


@pytest.mark.parametrize("rows", [
    [{"time": 0, "distance": 0}, {"time": 0, "distance": 1}],
    [{"time": 1, "distance": 0}, {"time": 0, "distance": 1}],
    [{"time": 0, "distance": 0}, {"time": 1, "distance": float("nan")}],
])
def test_bad_axes_or_values_cannot_supply_a_preview_anchor(rows):
    """Invalid source values remain unavailable, even in this offline experiment."""
    with pytest.raises(ValueError):
        interpolate(rows, .5, "time", "distance", 1)
