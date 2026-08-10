"""Storyboard selection, video bounds, and LLM grounding tests."""

from __future__ import annotations

import json
import types
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.api import storyboard_routes
from backend.app.analysis.session_storyboard import (
    StoryboardAlignment,
    build_storyboard,
    select_teaching_moments,
)
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.utils import storage
from backend.tests.test_xrk_analysis_api import write_inspection

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
REVIEWED_ARTIFACT = REPOSITORY_ROOT / "public/demo/reviewed-real-session.json"


def demo_analysis() -> dict[str, Any]:
    """Return the reviewed real analysis used by the public Demo."""
    reviewed = json.loads(REVIEWED_ARTIFACT.read_text(encoding="utf-8"))
    return reviewed["analysis"]


def alignment(**overrides: Any) -> StoryboardAlignment:
    values = {"offset_ms": 0, "video_duration_s": 620.0}
    values.update(overrides)
    return StoryboardAlignment(**values)


def test_storyboard_uses_only_real_quality_gated_laps() -> None:
    analysis = demo_analysis()
    eligible = {
        int(row["lap"])
        for row in analysis["lap_quality"]["top_valid_laps"]
    }
    storyboard = build_storyboard(analysis, None, alignment=alignment())

    nodes = storyboard["nodes"]
    assert 1 <= len(nodes) <= 5
    for node in nodes:
        assert node["source"] == "structured"
        assert node["title"] and node["insight"] and node["drill"]
        assert node["evidence_laps"]
        assert set(node["evidence_laps"]) <= eligible
        assert node["telemetry_overlay"]["speed_kmh"]
        assert len(node["telemetry_overlay"]["distance_m"]) == len(
            node["telemetry_overlay"]["speed_kmh"]
        )
        start, end = node["time_range"]
        assert 0 <= start < end <= 620.0
        assert end - start >= 1.0


def test_storyboard_rejects_synthetic_curves() -> None:
    analysis = demo_analysis()
    analysis["consensus_benchmark"]["synthetic_curve_generated"] = True
    with pytest.raises(ValueError, match="Synthetic curves"):
        build_storyboard(analysis, None, alignment=alignment())


def test_storyboard_requires_video_duration_and_in_bounds_evidence() -> None:
    analysis = demo_analysis()
    with pytest.raises(ValueError, match="video duration"):
        build_storyboard(
            analysis,
            None,
            alignment=alignment(video_duration_s=0),
        )
    with pytest.raises(ValueError, match="video evidence"):
        build_storyboard(
            analysis,
            None,
            alignment=alignment(video_duration_s=0.5),
        )
    with pytest.raises(ValueError, match="video evidence"):
        build_storyboard(
            analysis,
            None,
            alignment=alignment(offset_ms=-10_000_000),
        )


def test_teaching_moment_selection_prefers_transferable_corners() -> None:
    analysis = demo_analysis()
    moments = select_teaching_moments(analysis, max_nodes=5)
    assert moments
    assert all(moment["kind"] == "corner" for moment in moments)
    gains = [moment["net_gain"] for moment in moments]
    assert gains == sorted(gains, reverse=True)


def test_storyboard_extracts_measured_throttle_brake_overlay() -> None:
    analysis = demo_analysis()
    reference_lap = analysis["reference_lap"]
    track = analysis["track"]
    first = track["reference"][0]
    rows = []
    for index, point in enumerate(track["reference"]):
        rows.append(
            {
                "lap": reference_lap,
                "session_time_s": point["session_time_s"],
                "throttle": 40.0 + index,
                "brake": 5.0 + index,
            }
        )
    telemetry = pd.DataFrame(rows)
    storyboard = build_storyboard(
        analysis,
        telemetry,
        alignment=alignment(),
    )
    assert storyboard["nodes"]
    overlay = storyboard["nodes"][0]["telemetry_overlay"]
    assert overlay["throttle"] and overlay["brake"]
    assert all(value is not None for value in overlay["throttle"][:5])
    assert overlay["available"] == {"throttle": True, "brake": True}


class _FakeChatResponse:
    def __init__(self, content: str) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {"choices": [{"message": {"content": self.content}}]}


class _FakeChatClient:
    def __init__(self, content: str) -> None:
        self.content = content

    async def post(self, *args: Any, **kwargs: Any) -> _FakeChatResponse:
        return _FakeChatResponse(self.content)

    async def aclose(self) -> None:
        return None


def test_storyboard_llm_must_restate_evidence_numbers_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.analysis import session_storyboard

    analysis = demo_analysis()
    monkeypatch.setattr(
        session_storyboard,
        "_llm_config",
        lambda: ("https://llm.example", "test-key", "test-model"),
    )
    structured = build_storyboard(analysis, None, alignment=alignment())
    grounded_content = json.dumps(
        [
            {
                "id": node["id"],
                "title": f"第 {_node_number(node['id'])} 弯：可改进 {node['net_gain_s']:.3f} 秒",
                "insight": "基于真实圈，该模式可重复。",
                "drill": "连续三圈只改变这一处操作。",
            }
            for node in structured["nodes"]
        ],
        ensure_ascii=False,
    )
    grounded = build_storyboard(
        analysis,
        None,
        alignment=alignment(),
        llm_client=_FakeChatClient(grounded_content),
    )
    assert all(node["source"] == "llm" for node in grounded["nodes"])

    ungrounded_content = json.dumps(
        [
            {
                "id": node["id"],
                "title": f"第 {_node_number(node['id'])} 弯：可改进 {node['net_gain_s']:.3f} 秒",
                "insight": "理论上最多可提升 99.99 秒。",
                "drill": "连续三圈只改变这一处操作。",
            }
            for node in structured["nodes"]
        ],
        ensure_ascii=False,
    )
    ungrounded = build_storyboard(
        analysis,
        None,
        alignment=alignment(),
        llm_client=_FakeChatClient(ungrounded_content),
    )
    assert all(node["source"] == "structured" for node in ungrounded["nodes"])
    assert all("99.99" not in node["insight"] for node in ungrounded["nodes"])


def _node_number(node_id: str) -> str:
    import re

    match = re.search(r"(\d+)", node_id)
    return match.group(1) if match else "0"


def test_storyboard_api_create_and_share_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """POST creates an opaque token; GET serves it read-only; bad tokens 404."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        xrk_inspection_cache_dir=str(tmp_path / "cache"),
    )

    storyboard_payload = {
        "schema_version": 1,
        "watermark": "AI 生成，请与教练核实",
        "analysis": {
            "reference_lap": 1,
            "target_lap": 2,
            "fastest_lap": {"lap": 1, "lap_time": 10.0},
        },
        "video": {"duration_s": 120.0, "required": True, "uploaded": False},
        "nodes": [
            {
                "id": "corner-1",
                "kind": "corner",
                "title": "第 1 弯：可改进 0.050 秒",
                "time_range": [3.0, 5.0],
                "distance_range_m": [10.0, 30.0],
                "telemetry_overlay": {
                    "distance_m": [10.0, 20.0, 30.0],
                    "session_time_s": [3.0, 4.0, 5.0],
                    "speed_kmh": [60.0, 40.0, 55.0],
                    "rpm": [9000.0, 7000.0, 8500.0],
                    "longitudinal_g": [-0.5, -1.0, 0.1],
                    "lateral_g": [0.1, 1.0, 0.2],
                    "throttle": [],
                    "brake": [],
                    "available": {"throttle": False, "brake": False},
                },
                "insight": "基于真实圈 1、2 的净收益 0.050 秒。",
                "drill": "连续三圈只改变这一处操作。",
                "evidence_laps": [1, 2],
                "corner": {"name": "Zone 1", "entry_distance_m": 10.0, "exit_distance_m": 30.0},
                "source": "structured",
            }
        ],
    }

    def fake_analyze(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {
            "reference_lap": 1,
            "target_lap": 2,
            "fastest_lap": {"lap": 1, "lap_time": 10.0},
        }

    def fake_build(
        analysis: dict[str, Any],
        telemetry: Any,
        *,
        alignment: StoryboardAlignment,
        max_nodes: int,
    ) -> dict[str, Any]:
        assert alignment.video_duration_s == 120.0
        return storyboard_payload

    monkeypatch.setattr(storyboard_routes, "analyze_xrk_session", fake_analyze)
    monkeypatch.setattr(storyboard_routes, "build_storyboard", fake_build)
    monkeypatch.setattr(
        storyboard_routes,
        "pd",
        types.SimpleNamespace(read_parquet=lambda path: pd.DataFrame()),
    )

    with TestClient(create_app(settings)) as client:
        store = client.app.state.xrk_inspection_store
        inspection_id, directory, expires_at = store.create_directory()
        write_inspection(directory)
        store.finalize(inspection_id, directory, expires_at)

        created = client.post(
            "/api/v1/storyboard",
            json={
                "analysis": {
                    "inspection_id": inspection_id,
                    "reference_lap": 1,
                    "target_lap": 2,
                    "distance_step_m": 1,
                    "sector_count": 3,
                    "sector_boundaries_m": None,
                    "manual_zones": [],
                    "lap_quality_absolute_gap_s": 0.5,
                    "lap_quality_relative_gap_pct": 1,
                },
                "alignment": {
                    "offset_ms": 0,
                    "video_duration_s": 120.0,
                    "target_lap": 2,
                    "telemetry_session_time_s": 1.0,
                    "video_time_s": 1.0,
                    "video_size_bytes": 10,
                    "video_last_modified_ms": 10,
                    "video_mime_type": "video/mp4",
                },
            },
        )
        assert created.status_code == 200
        token = created.json()["token"]
        assert token

        shared = client.get(f"/api/v1/storyboards/{token}")
        assert shared.status_code == 200
        assert shared.json()["nodes"][0]["id"] == "corner-1"
        assert shared.json()["watermark"] == "AI 生成，请与教练核实"

        assert client.get("/api/v1/storyboards/not-a-real-token").status_code == 404
        assert client.get("/api/v1/storyboards/short").status_code == 404
