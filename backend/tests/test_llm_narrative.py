"""Evidence-boundary tests for the optional XRK LLM narrative."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from backend.app.analysis.llm_narrative import (
    build_xrk_narrative_evidence,
    generate_llm_narrative,
)


def analysis_result() -> dict:
    """Return compact analysis plus arrays that must never enter the prompt."""
    return {
        "capabilities": {"gps": True, "rpm": True, "direct_brake": False},
        "evidence_catalog": {
            "measured": ["RPM", "GPS speed"],
            "calculated": ["Distance-aligned lap delta"],
            "inferred": ["Lifting"],
        },
        "fastest_lap": {"lap": 13, "lap_time": 40.326},
        "reference_lap": 13,
        "target_lap": 10,
        "lap_quality": {
            "reference_eligible_count": 3,
            "minimum_top_laps_met": True,
            "notice": None,
            "top_valid_laps": [
                {
                    "lap": 13,
                    "lap_time": 40.326,
                    "gap_to_fastest": 0.0,
                    "quality_status": "reference_eligible",
                    "quality_score": 0.98,
                    "reasons": [],
                }
            ],
        },
        "consensus_benchmark": {
            "reference_policy": "real_completed_reference_eligible_laps_only",
            "corners": [
                {
                    "corner_id": "zone-4",
                    "corner": "Zone 4",
                    "entry_distance_m": 512.4,
                    "exit_distance_m": 590.0,
                    "common_fast_pattern": ["Earlier sustained RPM recovery"],
                    "fastest_lap_unique_features": [],
                    "repeatability_score": 0.67,
                    "occurrence_count": 2,
                    "supporting_laps": [10, 13],
                    "local_gain": 0.24,
                    "downstream_cost": 0.0,
                    "net_gain": 0.24,
                    "transferable_improvement": True,
                    "confidence": "medium",
                    "evidence": {
                        "channels": ["rpm", "speed"],
                        "features_by_lap": [{"raw_like_sample": 99999}],
                    },
                }
            ],
        },
        "achievable_improvement_range": {
            "minimum_improvement_s": 0.10,
            "maximum_improvement_s": 0.22,
            "confidence": "medium",
            "basis": ["Earlier sustained RPM recovery at Zone 4"],
            "source_laps": [10, 13],
            "limitations": [],
        },
        "zones": {
            "comparisons": [
                {
                    "id": "zone-4",
                    "name": "Zone 4",
                    "entry_distance_m": 512.4,
                    "exit_distance_m": 590.0,
                    "estimated_zone_loss_s": 0.24,
                    "reference": {"raw_trace": [1, 2, 3]},
                    "target": {"raw_trace": [4, 5, 6]},
                    "findings": [
                        {
                            "metric": "minimum_rpm",
                            "label": "Minimum RPM",
                            "reference": 8740.0,
                            "target": 8420.0,
                            "difference": -320.0,
                            "unit": "rpm",
                            "evidence_class": "measured",
                        }
                    ],
                }
            ]
        },
        "events": [
            {
                "lap": 10,
                "sector": 2,
                "distance_m": 512.4,
                "lap_time_s": 24.1,
                "event_type": "LIFTING",
                "confidence": "medium",
                "channels_used": ["rpm", "speed"],
                "thresholds": {"rpm_slope": -842.5},
                "evidence": {"speed_slope": -1.8},
                "raw_window": [7, 8, 9],
            }
        ],
        "ai_coach_summary": {
            "training_priorities": [
                {
                    "corner": "Zone 4",
                    "why": "Positive net gain without downstream cost.",
                    "what_to_test": "Repeat sustained RPM recovery.",
                    "training_drill": "Use one repeatable reference point.",
                    "success_criteria": ["Repeat on supporting laps"],
                    "stop_condition": "Stop when exit speed falls.",
                    "evidence": {"channels": ["rpm", "speed"]},
                    "confidence": "medium",
                    "limitation": None,
                }
            ],
            "common_fast_patterns": [],
            "fastest_lap_net_differences": [],
            "fastest_lap_unique_features": [],
            "emerging_improvements": [],
            "rejected_apparent_improvements": [],
            "stable_strengths": [],
            "limitations": ["No direct brake channel."],
        },
        "comparison": [{"distance_m": 1.0, "rpm": 9000.0}],
        "track": {"reference": [{"distance_m": 1.0}]},
        "channels": [{"name": "RPM", "sample_count": 12223}],
        "lap_rows": [{"lap": 13, "lap_time": 40.326}],
        "top_laps_comparison": {"aligned": [{"distance_m": 1.0}]},
    }


def configure_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "test-model")


def test_llm_success_uses_summary_evidence_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                "训练重点一：Zone 4 的出弯 RPM 恢复要连续完成\n"
                                "对应证据：Lap 13 为 40.326s，净收益为 0.24s。\n"
                                "练习建议：保持入弯准备不变，只测试连续 RPM 恢复并核对 0.24s。\n"
                                "停止条件：若下游代价高于 0.0s，停止实验。\n"
                                "训练重点二：Zone 4 保持最低 RPM 后的恢复质量\n"
                                "对应证据：参考圈为 8740 rpm，目标圈为 8420 rpm。\n"
                                "练习建议：只改变恢复动作，并核对 8420 rpm。\n"
                                "停止条件：若 RPM 低于 8420 rpm，停止实验。\n"
                                "训练重点三：Zone 4 核对收油与恢复衔接\n"
                                "对应证据：Lap 10 在 24.1s 出现 LIFTING。\n"
                                "练习建议：只调整收油与恢复衔接并核对 24.1s。\n"
                                "停止条件：若净收益低于 0.24s，停止实验。"
                            )
                        }
                    }
                ]
            },
        )

    evidence = build_xrk_narrative_evidence(analysis_result())
    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative(evidence, client=client, language="zh")

    narrative = asyncio.run(run())
    assert narrative is not None
    assert "40.326s" in narrative
    prompt = captured["messages"][1]["content"]
    assert "数字白名单" in prompt
    assert '"comparison"' not in prompt
    assert '"track"' not in prompt
    assert '"channels"' not in prompt
    assert '"lap_rows"' not in prompt
    assert '"aligned"' not in prompt
    assert '"entry_distance_m"' not in prompt
    assert '"exit_distance_m"' not in prompt
    assert "99999" not in prompt
    assert "12223" not in prompt
    assert "raw_window" not in prompt
    assert "raw_trace" not in prompt


def test_llm_evidence_rounds_display_precision_without_touching_raw_result() -> None:
    result = analysis_result()
    result["zones"]["comparisons"][0]["findings"][0]["reference"] = 8740.123456
    evidence = build_xrk_narrative_evidence(result)
    assert evidence["zone_comparisons"][0]["findings"][0]["reference"] == 8740.123
    assert result["zones"]["comparisons"][0]["findings"][0]["reference"] == 8740.123456


def test_llm_missing_configuration_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    assert asyncio.run(generate_llm_narrative({"fastest_lap": 13})) is None


def test_llm_timeout_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_llm(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative({"fastest_lap": 13}, client=client)

    assert asyncio.run(run()) is None


def test_llm_malformed_response_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json")

    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative({"fastest_lap": 13}, client=client)

    assert asyncio.run(run()) is None


def test_llm_rejects_number_absent_from_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "建议在 99.9 米处开始收油。"}}
                ]
            },
        )

    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative({"distance_m": 512.4}, client=client)

    assert asyncio.run(run()) is None


def test_cloud_mode_rejects_plain_http_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_llm(monkeypatch)
    monkeypatch.setenv("APP_MODE", "cloud")
    monkeypatch.setenv("LLM_BASE_URL", "http://llm.example/v1")
    assert asyncio.run(generate_llm_narrative({"lap": 13})) is None
