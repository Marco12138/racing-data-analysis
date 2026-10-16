"""Review facts must survive empty training gates without inventing driver inputs."""
import asyncio
import json

import httpx
import pytest

from backend.app.analysis.coach_debrief import build_coach_debrief
from backend.app.analysis.llm_narrative import build_xrk_narrative_evidence, generate_llm_narrative


def sample():
    """Small fictional test fixture, never used in the product."""
    return {"reference_lap": 1, "target_lap": 2, "lap_quality": {"top_valid_laps": [
        {"lap": 1, "lap_time": 41., "analysis_eligible": True}, {"lap": 2, "lap_time": 42., "analysis_eligible": True}]},
        "sectors": {"official": False, "sector_best": {"sector_1": 10.}, "lap_rows": [
            {"lap": 1, "sector_1": 10.}, {"lap": 2, "sector_1": 11.}, {"lap": 99, "sector_1": 8.}]},
        "ai_coach_summary": {"training_priorities": []}, "zones": {"comparisons": [
            {"id": "z1", "name": "Zone 1", "estimated_zone_loss_s": .2, "findings": [
                {"metric": "lift_distance_m", "reference": 280., "target": 275., "difference": -5., "unit": "m"},
                {"metric": "reacceleration_distance_m", "reference": 310., "target": 315., "difference": 5., "unit": "m"}]}]}}


def test_facts_and_reviews_survive_no_validated_training():
    """Do not confuse insufficient training evidence with no observable facts."""
    result = build_coach_debrief(sample(), "zh")
    assert result["observations"] and result["reviews"] and not result["training"]
    text = " ".join(row["text"] for row in result["observations"])
    assert "提前 5.0 米" in text and "推迟 5.0 米" in text
    assert "280" not in text and "刹车" not in text and "L99" not in text
    assert result["observations"][-1]["evidence"]["findings"][0]["evidence_class"] == "inferred"


def test_same_lap_is_not_a_review_candidate():
    """Comparing a lap with itself cannot establish an improvement."""
    data = sample(); data["target_lap"] = 1
    assert build_coach_debrief(data)["reviews"] == []


def test_zero_and_missing_do_not_get_conflated():
    """Zero difference is valid, a missing difference is not invented."""
    data = sample(); findings = data["zones"]["comparisons"][0]["findings"]
    findings[0]["difference"] = 0.; findings[1]["difference"] = None
    text = build_coach_debrief(data, "zh")["observations"][-1]["text"]
    assert "位置接近" in text and "重新加速" not in text


def run_narrative(monkeypatch, body, *, timeout=False, configured=True):
    """Exercise the HTTP boundary without sending any external request."""
    for name, value in [("LLM_BASE_URL", "https://test.invalid/v1"), ("LLM_API_KEY", "test-secret"), ("LLM_MODEL", "test")]:
        if configured: monkeypatch.setenv(name, value)
        else: monkeypatch.delenv(name, raising=False)
    result = sample(); result["coach_debrief"] = build_coach_debrief(result, "zh")
    evidence = build_xrk_narrative_evidence(result); diagnostics = {}; captured = {}
    def handler(request):
        captured.update(json.loads(request.content))
        if timeout: raise httpx.ReadTimeout("private upstream detail", request=request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(body, ensure_ascii=False)}}]})
    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative(evidence, client=client, language="zh", diagnostics=diagnostics)
    return asyncio.run(execute()), diagnostics, captured


def response():
    """No numeric prose: the renderer supplies the original evidence."""
    return {"observations": [{"evidence_id": "sector:sector_1", "explanation": "先看时间差建立的位置。"}],
            "reviews": [{"evidence_id": "zone:z1", "explanation": "对照画面核对减速与恢复过程。"}], "training": []}


def test_new_narrative_empty_training_and_code_authored_numbers(monkeypatch):
    text, status, captured = run_narrative(monkeypatch, response())
    assert "10.000" in text and "没有足够证据" in text
    assert status["status"] == "generated" and status["language"] == "zh"
    assert "Chinese" in captured["messages"][0]["content"]
    assert "raw_trace" not in captured["messages"][1]["content"]


@pytest.mark.parametrize("change", ["number", "wrong_tier", "unknown_id", "pedal_claim"])
def test_rejects_invented_numbers_tier_promotion_and_inputs(monkeypatch, change):
    body = response()
    if change == "number": body["reviews"][0]["explanation"] = "提前5米。"
    if change == "wrong_tier": body["training"] = body["reviews"]
    if change == "unknown_id": body["reviews"][0]["evidence_id"] = "zone:invented"
    if change == "pedal_claim": body["reviews"][0]["explanation"] = "因为刹车太晚。"
    text, status, _ = run_narrative(monkeypatch, body)
    assert text is None and status["reason"] == "policy_rejected"


def test_diagnostics_distinguish_timeout_and_configuration(monkeypatch):
    text, status, _ = run_narrative(monkeypatch, {}, timeout=True)
    assert text is None and status["reason"] == "timeout" and "private" not in str(status)
    text, status, captured = run_narrative(monkeypatch, {}, configured=False)
    assert text is None and status["reason"] == "not_configured" and not captured
