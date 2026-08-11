"""Integration tests for the optional LLM narrative layer."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from backend.app.analysis.llm_narrative import generate_llm_narrative


def evidence() -> dict:
    return {
        "fastest_lap": {"lap": 13, "lap_time": 40.326},
        "reference_lap": 13,
        "selected_lap": 8,
        "evidence_laps": [13, 8],
        "top3_consensus": [
            {
                "corner_id": "zone-4",
                "entry_distance_m": 512.4,
                "exit_distance_m": 590.0,
                "net_gain": 0.24,
            }
        ],
        "zone_comparisons": [
            {
                "id": "zone-4",
                "entry_distance_m": 512.4,
                "exit_distance_m": 590.0,
                "estimated_zone_loss_s": 0.24,
            }
        ],
    }


def configure_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")


def run_with_transport(content: str, language: str, captured: dict) -> str | None:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )

    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative(evidence(), client=client, language=language)

    return asyncio.run(run())


def test_llm_narrative_parses_fixed_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    captured: dict = {}
    content = (
        "训练重点一：Zone 4（512.4-590.0 m）更早恢复油门，净收益 0.24s。\n"
        "对应证据：真实圈 13、8。\n"
        "练习建议：连续练习，在 512.4 m 对比弯心出口速度。停止条件：若出弯速度下降，停止实验。"
    )
    narrative = run_with_transport(content, "zh", captured)
    assert narrative is not None
    assert "Zone 4" in narrative
    assert "0.24s" in narrative


def test_llm_narrative_falls_back_when_output_has_no_numbers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    captured: dict = {}
    narrative = run_with_transport("训练重点：保持整体节奏稳定。", "zh", captured)
    assert narrative is None


def test_system_prompt_forwards_language_marker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    captured: dict = {}
    run_with_transport("test", "zh", captured)
    zh_prompt = captured["payload"]["messages"][0]["content"]
    assert "中文" in zh_prompt

    captured.clear()
    run_with_transport("test", "en", captured)
    en_prompt = captured["payload"]["messages"][0]["content"]
    assert "English" in en_prompt
