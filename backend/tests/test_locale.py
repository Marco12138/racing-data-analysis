"""Locale-aware copy and specificity tests for the analysis text layer."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from backend.app.analysis.corner_consensus import build_ai_coach_summary
from backend.app.analysis.llm_narrative import generate_llm_narrative
from backend.app.analysis.report_generator import generate_report
from backend.app.analysis.session_storyboard import build_storyboard
from backend.app.analysis.text_locale import _is_specific, is_specific_text
from backend.app.analysis.xrk_session_analysis import generate_xrk_report


def lap_result() -> dict:
    return {
        "total_laps": 2,
        "fastest_lap": {"lap": 2, "lap_time": 41.2},
        "main_loss_sector": "sector_2",
    }


def telemetry_result() -> dict:
    return {
        "available_channels": ["speed", "brake", "throttle"],
        "maximum_speed": 100.0,
        "average_speed": 70.0,
    }


def xrk_result() -> dict:
    return {
        "fastest_lap": {"lap": 13, "lap_time": 40.326},
        "reference_lap": 13,
        "target_lap": 8,
        "lap_rows": [{"lap": 13, "lap_time": 40.326}],
        "capabilities": {
            "gps": True,
            "rpm": True,
            "direct_brake": False,
            "direct_throttle": False,
        },
        "lap_quality": {
            "top_valid_laps": [
                {"lap": 13, "lap_time": 40.326},
                {"lap": 8, "lap_time": 40.534},
            ]
        },
        "achievable_improvement_range": {
            "minimum_improvement_s": 0.1,
            "maximum_improvement_s": 0.22,
            "confidence": "medium",
        },
        "zones": {
            "comparisons": [
                {
                    "name": "Zone 4",
                    "estimated_zone_loss_s": 0.24,
                    "findings": [
                        {
                            "label": "Minimum RPM",
                            "reference": 8740.0,
                            "target": 8420.0,
                            "difference": -320.0,
                            "unit": "rpm",
                        }
                    ],
                }
            ]
        },
        "events": [
            {"lap": 8, "event_type": "LIFTING"},
            {"lap": 8, "event_type": "COASTING"},
        ],
        "ai_coach_summary": {
            "training_priorities": [
                {
                    "corner": "Zone 4",
                    "what_to_test": "Test a sustained RPM recovery near 512.4 m.",
                }
            ],
            "rejected_apparent_improvements": [
                {
                    "corner": "Zone 3",
                    "local_gain_s": 0.2,
                    "downstream_cost_s": 0.25,
                    "net_gain_s": -0.05,
                }
            ],
            "fastest_lap_unique_features": [
                {"corner": "Zone 1", "features": ["Fastest-lap lift position differs by +5.0 m"]}
            ],
        },
    }


def test_report_locale_zh_and_en() -> None:
    zh = generate_report(lap_result(), telemetry_result(), [], language="zh")
    en = generate_report(lap_result(), telemetry_result(), [])
    assert "会话摘要" in zh
    assert "最快圈为第 2 圈" in zh
    assert "建议复盘重点" in zh
    assert "Session Summary" in en
    assert "The fastest lap was Lap 2" in en


def test_xrk_report_locale_zh_and_en() -> None:
    zh = generate_xrk_report(xrk_result(), language="zh")
    en = generate_xrk_report(xrk_result())
    assert "测量" in zh
    assert "AI 教练摘要" in zh
    assert "参考口径" in zh
    assert "Measured" in en
    assert "AI Coach Summary" in en
    assert "Reference policy" in en
    assert "theoretical" not in zh.lower()
    assert "theoretical" not in en.lower()


def _consensus_fixture() -> dict:
    corner = {
        "corner_id": "auto-zone-1",
        "corner": "Suggested Zone 1",
        "entry_distance_m": 110.0,
        "exit_distance_m": 171.0,
        "local_gain": 0.065,
        "downstream_cost": 0.018,
        "net_gain": 0.047,
        "repeatability_score": 0.8,
        "occurrence_count": 2,
        "supporting_laps": [13, 8],
        "common_fast_pattern": ["Lift position repeats near 110.0 m"],
        "fastest_lap_unique_features": [],
        "transferable_improvement": True,
        "confidence": "medium",
        "evidence": {
            "features_by_lap": [
                {"lap": 13, "reacceleration_distance_m": 140.0},
                {"lap": 8, "reacceleration_distance_m": 141.0},
            ]
        },
    }
    return {
        "corners": [corner],
        "reference_policy": "real_completed_reference_eligible_laps_only",
    }


def test_ai_coach_summary_locale_zh_and_en() -> None:
    consensus = _consensus_fixture()
    top_laps = [
        {"lap": 13, "lap_time": 40.326, "quality_status": "reference_eligible"},
        {"lap": 8, "lap_time": 40.534, "quality_status": "reference_eligible"},
    ]
    achievable = {"minimum_improvement_s": 0.1, "maximum_improvement_s": 0.2}
    zh = build_ai_coach_summary(top_laps, consensus, achievable, direct_brake_available=False, language="zh")
    en = build_ai_coach_summary(top_laps, consensus, achievable, direct_brake_available=False)

    assert "所有基准均来自真实完成" in zh["reference_statement"]
    priority_zh = zh["training_priorities"][0]
    assert "提前恢复 RPM" in priority_zh["what_to_test"]
    assert "停止条件" not in priority_zh["stop_condition"]
    assert "连续跑 3 圈" in priority_zh["training_drill"]
    assert "抬油门位置稳定在 110.0 m 附近" in zh["stable_strengths"][0]["finding"]

    assert "All benchmarks come from real" in en["reference_statement"]
    priority_en = en["training_priorities"][0]
    assert "Test a sustained RPM recovery near 140.5 m" in priority_en["what_to_test"]
    assert "Run three consecutive laps" in priority_en["training_drill"]
    assert "Lift position repeats near 110.0 m" in en["stable_strengths"][0]["finding"]


def test_storyboard_fallback_is_specific_and_language_aware() -> None:
    import json as jsonlib
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    analysis = jsonlib.loads(
        (repo / "public/demo/reviewed-real-session.json").read_text(encoding="utf-8")
    )["analysis"]
    from backend.app.analysis.session_storyboard import StoryboardAlignment

    alignment = StoryboardAlignment(offset_ms=0, video_duration_s=620.0)
    zh = build_storyboard(analysis, None, alignment=alignment, language="zh")
    en = build_storyboard(analysis, None, alignment=alignment, language="en")

    for node in zh["nodes"]:
        combined = f"{node['title']} {node['insight']} {node['drill']}"
        assert is_specific_text(combined, "zh")
        assert not any(word in combined for word in ("注意", "改善", "提高"))
    for node in en["nodes"]:
        combined = f"{node['title']} {node['insight']} {node['drill']}"
        assert is_specific_text(combined, "en")
        assert not any(word in combined.lower() for word in ("overall", "generally", "try to improve"))
    assert "第" in zh["nodes"][0]["title"]
    assert "Corner" in en["nodes"][0]["title"]


def _configure_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "test-model")


def _run_with_transport(content: str, language: str) -> str | None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )

    evidence = {
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
                "repeatability_score": 0.7,
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

    async def run() -> str | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_llm_narrative(evidence, client=client, language=language)

    return asyncio.run(run())


def test_llm_narrative_rejects_vague_output_and_forwards_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_llm(monkeypatch)
    vague = _run_with_transport(
        "训练重点一：注意改善整体节奏。\n对应证据：最快圈 40.326s。\n练习建议：提高综合表现。",
        "zh",
    )
    assert vague is None

    specific = _run_with_transport(
        "训练重点一：Zone 4（512.4-590.0 m）更早恢复油门，净收益 0.24s。\n"
        "对应证据：真实圈 13、8，净收益 0.24s。\n"
        "练习建议：连续练习，在 512.4 m 对比弯心出口速度。",
        "zh",
    )
    assert specific is not None
    assert "0.24s" in specific

    english = _run_with_transport(
        "Priority: earlier throttle recovery at Zone 4 (512.4-590.0 m).\n"
        "Evidence: real laps 13 and 8, net gain 0.24s.\n"
        "Drill: practice and compare corner-exit speed at 512.4 m.",
        "en",
    )
    assert english is not None


def test_is_specific_text_guards() -> None:
    assert is_specific_text("在 512.4 m 更早恢复油门，净收益 0.24s。", "zh")
    assert not is_specific_text("注意改善整体节奏。", "zh")
    assert not is_specific_text("Try to improve the overall flow.", "en")
    assert not is_specific_text("保持现状。", "zh")
    assert not is_specific_text("数字 123 但没有地点或距离锚点。", "zh")
    assert not _is_specific("improve overall stability at 123.", "en")


def test_narrative_feedback_api(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Any,
) -> None:
    from fastapi.testclient import TestClient

    from backend.app.core.config import Settings
    from backend.app.main import create_app
    from backend.app.utils import storage

    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
    )
    with TestClient(create_app(settings)) as client:
        created = client.post(
            "/api/v1/feedback",
            json={
                "node_id": "priority-1",
                "token": "inspection-abc",
                "source": "coach",
                "locale": "zh",
                "thumbs_up": True,
            },
        )
        assert created.status_code == 200
        assert created.json()["received"] is True

        storyboard_feedback = client.post(
            "/api/v1/feedback",
            json={
                "node_id": "corner-1",
                "token": "share-token-abc123456789",
                "source": "storyboard",
                "locale": "en",
                "thumbs_up": False,
            },
        )
        assert storyboard_feedback.status_code == 200

        stats = client.get("/api/v1/feedback/stats").json()
        assert stats["total"] == 2
        assert stats["thumbs_up_count"] == 1
        assert stats["thumbs_down_count"] == 1
        assert len(stats["recent"]) == 2
        assert stats["recent"][0]["source"] == "storyboard"

        invalid = client.post(
            "/api/v1/feedback",
            json={"node_id": "", "source": "coach", "locale": "zh", "thumbs_up": True},
        )
        assert invalid.status_code == 422


def test_capabilities_llm_narrative_follows_environment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Any,
) -> None:
    from fastapi.testclient import TestClient

    from backend.app.core.config import Settings
    from backend.app.main import create_app
    from backend.app.utils import storage

    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_server_import_enabled=False,
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )
    with TestClient(create_app(settings)) as client:
        unset = client.get("/api/v1/system/capabilities").json()["llm_narrative"]
        assert unset == {"available": False, "model": None}

    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com/v1")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    with TestClient(create_app(settings)) as client:
        configured = client.get("/api/v1/system/capabilities").json()["llm_narrative"]
        assert configured == {"available": True, "model": "deepseek-chat"}
        assert "LLM_API_KEY" not in json.dumps(
            client.get("/api/v1/system/capabilities").json(),
            ensure_ascii=False,
        )
