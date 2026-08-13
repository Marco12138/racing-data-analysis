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
        "训练重点一：Zone 4（512.4-590.0 m）保持油门恢复。\n"
        "对应证据：Lap 13 为 40.326s，净收益 0.24s。\n"
        "练习建议：在 512.4 m 只测试油门恢复并核对 0.24s。\n"
        "停止条件：若净收益低于 0.24s，停止实验。\n"
        "训练重点二：Zone 4（512.4-590.0 m）保持速度。\n"
        "对应证据：Lap 13 为 40.326s，Zone 4 损失 0.24s。\n"
        "练习建议：在 590.0 m 核对速度对应的 0.24s。\n"
        "停止条件：若损失高于 0.24s，停止实验。\n"
        "训练重点三：Zone 4（512.4-590.0 m）保持 RPM 恢复。\n"
        "对应证据：真实圈为 Lap 13 和 Lap 8，损失 0.24s。\n"
        "练习建议：在 512.4 m 只测试 RPM 恢复并核对 0.24s。\n"
        "停止条件：若损失高于 0.24s，停止实验。"
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


def test_llm_narrative_falls_back_when_output_contains_forbidden_filler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    captured: dict = {}
    block = (
        "训练重点一：Zone 4（512.4-590.0 m）注意提高油门恢复。\n"
        "对应证据：Lap 13 为 40.326s，净收益 0.24s。\n"
        "练习建议：在 512.4 m 核对 0.24s。\n"
        "停止条件：若损失高于 0.24s，停止实验。"
    )
    content = "\n".join(
        block.replace("训练重点一", label)
        for label in ("训练重点一", "训练重点二", "训练重点三")
    )
    assert run_with_transport(content, "zh", captured) is None


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
