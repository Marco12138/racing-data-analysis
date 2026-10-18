"""Real-lap split comparisons do not create optimal laps or causal advice."""

from copy import deepcopy

from backend.app.analysis.top_lap_segments import build_top_lap_segments, segment_report_lines
from backend.app.analysis.llm_narrative import build_xrk_narrative_evidence


def sample():
    """Small invented test fixture, never shipped as user telemetry."""
    top = [{"lap": n, "analysis_eligible": True} for n in (5, 4, 6)]
    rows = [
        {"lap": 5, "sector_1": 10.0, "sector_2": 12.0, "sector_3": 10.0},
        {"lap": 4, "sector_1": 10.1, "sector_2": 11.8, "sector_3": 10.2},
        {"lap": 6, "sector_1": 10.2, "sector_2": 12.1, "sector_3": 9.9},
        {"lap": 9, "sector_1": 1.0, "sector_2": 1.0, "sector_3": 1.0},
    ]
    return top, rows


def test_real_pairs_and_downstream_cost_are_kept_not_stitched():
    """Local winners may lose the advantage in the next actual sector."""
    top, rows = sample()
    before = deepcopy(rows)
    result = build_top_lap_segments(top, rows, [0, 200, 400, 600])
    assert [s["winner_laps"] for s in result["segments"]] == [[5], [4], [6]]
    pair = result["segments"][0]["comparisons"][0]
    assert pair == {"reference_lap": 5, "target_lap": 4, "local_gain_s": .1,
                    "next_sector_delta_s": -.2, "net_gain_through_next_s": -.1}
    assert all(p["next_sector_delta_s"] is None for p in result["segments"][-1]["comparisons"])
    assert rows == before
    assert result["synthetic_curve_generated"] is False
    assert result["landmarks_used_for_positioning"] is False
    assert result["confidence"] == "descriptive_only"


def test_ties_missing_splits_and_quality_gate():
    """Keep ties and unavailable values; never fill missing fast laps."""
    top, rows = sample()
    rows[1]["sector_1"] = 10.0
    rows[2]["sector_2"] = None
    result = build_top_lap_segments(top, rows, [0, 200, 400, 600])
    assert result["segments"][0]["winner_laps"] == [5, 4]
    assert result["segments"][1]["status"] == "insufficient_comparable_laps"
    assert result["segments"][1]["winner_laps"] == []
    top[1]["analysis_eligible"] = False
    result = build_top_lap_segments(top, rows, [0, 200, 400, 600])
    assert result["laps"] == [5, 6]
    assert build_top_lap_segments(top[:1], rows, [0, 200])["status"] == "unavailable"


def test_report_and_llm_use_summary_only_and_do_not_invent_target():
    """Pass split evidence without telemetry arrays or causal interpretations."""
    top, rows = sample()
    summary = build_top_lap_segments(top, rows, [0, 200, 400, 600])
    zh = "\n".join(segment_report_lines(summary, "zh"))
    en = "\n".join(segment_report_lines(summary, "en"))
    assert "-0.100s" in zh and "Lap 5" in en
    assert "不是官方计时点" in zh and "composite target" in en
    evidence = build_xrk_narrative_evidence({"top_lap_segments": summary, "comparison": [{"raw_secret": 123}]})
    assert evidence["real_top_lap_segments"] == summary
    assert "raw_secret" not in str(evidence)
