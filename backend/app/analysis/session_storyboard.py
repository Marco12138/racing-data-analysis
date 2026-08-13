"""Build shareable teaching storyboards from real XRK analysis evidence.

A storyboard is a 3-5 node teaching summary for one session. Every node must
map to a real, quality-gated lap and carry a bounded video clip window derived
from the video-telemetry alignment offset. No synthetic lap, curve, or number
is ever produced here; when evidence is insufficient the builder fails closed.
"""

from __future__ import annotations

import json
import logging
import re
import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import numpy as np
import pandas as pd

from .llm_narrative import (
    _contains_forbidden_filler,
    _llm_config,
    _numbers_are_grounded,
)
from .text_locale import is_specific_text, localize_pattern

STORYBOARD_SCHEMA_VERSION = 1
WATERMARK = "AI 生成，请与教练核实"
DEFAULT_TTL_SECONDS = 7 * 24 * 3600
NARRATIVE_CACHE_TTL_SECONDS = 6 * 3600

logger = logging.getLogger("racing.storyboard")

STORYBOARD_SYSTEM_PROMPT = """你是一名谨慎的卡丁车数据复盘教练，负责把一次 session 的关键洞察
组织成 60-90 秒的复盘内容。对每个教学时刻输出三项，全部使用 {language}：
title：一句短视频标题，必须包含证据中的数字（距离/时间/转速）；
insight：1-2 句教练建议，只复述证据中已有的数字；
drill：1 条可执行练习建议，必须包含练习动作、具体距离与停止条件。
只返回 JSON 数组：[{{"id":"...","title":"...","insight":"...","drill":"..."}}]。
禁止编造证据之外的数字、合成圈或理论圈；禁止使用“注意”“改善”“提高”
“overall”“generally”“try to improve”等没有数字的宽泛措辞；
证据不足时用“证据不足，暂不建议改变现有操作”明确说明。

好示例（含弯角、距离、时间与练习）：
{{"id":"corner-4","title":"第 4 弯：更早恢复油门，净收益 0.24s",
"insight":"真实圈 10、13 在 512.4-590.0 m 提前恢复油门，净收益 0.24s。",
"drill":"练习：连续 3 圈只改恢复点，在 540 m 对比弯心出口速度。停止条件：若出弯速度下降，停止实验。"}}

{{"id":"corner-1","title":"第 1 弯：抬油门位置稳定，净收益 0.05s",
"insight":"真实圈 8、13 的抬油门位置均为 110 m，净收益 0.05s。",
"drill":"练习：连续 3 圈保持抬油门点不变，对比 Sector 1 用时。停止条件：若弯中最低速度下降，停止实验。"}}

差示例（宽泛、无数字，禁止模仿）：
{{"id":"corner-4","title":"第 4 弯：注意改善",
"insight":"整体表现一般，建议提高稳定性。",
"drill":"try to improve 综合表现。"}}
"""

# In-process narrative cache keyed by the evidence fingerprint so an identical
# session/analysis does not pay repeated LLM calls. Failures are never cached.
_NARRATIVE_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
narrative_stats = {
    "calls": 0,
    "failures": 0,
    "cache_hits": 0,
}

MIN_NODES = 1
MAX_NODES = 5
MIN_VIDEO_CLIP_S = 1.0
MAX_VIDEO_CLIP_S = 8.0
OVERLAY_MAX_POINTS = 80
OVERLAY_DISTANCE_PADDING_M = 15.0
VIDEO_PADDING_S = 1.0

@dataclass(frozen=True)
class StoryboardAlignment:
    """Video-telemetry alignment anchor with the same offset convention as the UI."""

    offset_ms: int
    video_duration_s: float
    target_lap: int | None = None
    telemetry_session_time_s: float | None = None
    video_time_s: float | None = None

    @property
    def offset_s(self) -> float:
        return self.offset_ms / 1000.0


def select_teaching_moments(
    analysis: dict[str, Any],
    *,
    max_nodes: int = MAX_NODES,
) -> list[dict[str, Any]]:
    """Select the most important transferable teaching moments from real laps.

    Raises ValueError when the analysis contains synthetic curves or when there
    is no real corner/event evidence to teach from.
    """
    consensus = analysis.get("consensus_benchmark") or {}
    if consensus.get("synthetic_curve_generated") is True:
        raise ValueError("Synthetic curves cannot be used for a teaching storyboard.")
    if (analysis.get("top_laps_comparison") or {}).get("synthetic_curve_generated") is True:
        raise ValueError("Synthetic curves cannot be used for a teaching storyboard.")
    if not analysis.get("track"):
        raise ValueError("GPS/track analysis is required for a teaching storyboard.")

    corners = [
        corner
        for corner in consensus.get("corners", [])
        if corner.get("transferable_improvement") is True
        and _finite(corner.get("net_gain"))
        and corner.get("net_gain") >= 0.0
    ]
    corners.sort(
        key=lambda corner: (
            float(corner.get("net_gain", 0.0)),
            float(corner.get("repeatability_score", 0.0)),
        ),
        reverse=True,
    )

    priorities = {
        str(item.get("corner")): item
        for item in (analysis.get("ai_coach_summary") or {}).get(
            "training_priorities",
            [],
        )
        if item.get("corner")
    }
    moments: list[dict[str, Any]] = []
    for corner in corners[:max_nodes]:
        priority = priorities.get(str(corner.get("corner")))
        moments.append(
            {
                "kind": "corner",
                "corner_id": str(corner.get("corner_id") or ""),
                "corner": str(corner.get("corner") or ""),
                "entry_distance_m": float(corner["entry_distance_m"]),
                "exit_distance_m": float(corner["exit_distance_m"]),
                "net_gain": float(corner["net_gain"]),
                "local_gain": float(corner.get("local_gain") or 0.0),
                "downstream_cost": float(corner.get("downstream_cost") or 0.0),
                "repeatability_score": float(corner.get("repeatability_score") or 0.0),
                "supporting_laps": [int(lap) for lap in corner.get("supporting_laps", [])],
                "pattern": _first_pattern(corner),
                "what_to_test": str((priority or {}).get("what_to_test") or ""),
                "training_drill": str((priority or {}).get("training_drill") or ""),
                "stop_condition": str((priority or {}).get("stop_condition") or ""),
            }
        )

    if not moments:
        moments = _event_moments(analysis, max_nodes=max_nodes)
    if not moments:
        raise ValueError(
            "No transferable teaching moments were found in the quality-gated laps."
        )
    return moments[:max_nodes]


def build_storyboard(
    analysis: dict[str, Any],
    telemetry: pd.DataFrame | None,
    *,
    alignment: StoryboardAlignment,
    max_nodes: int = MAX_NODES,
    llm_client: httpx.AsyncClient | None = None,
    language: str = "en",
) -> dict[str, Any]:
    """Build the complete storyboard payload from analyzed real evidence."""
    if alignment.video_duration_s <= 0 or not np.isfinite(alignment.video_duration_s):
        raise ValueError("A finite positive video duration is required for a storyboard.")
    track = analysis.get("track")
    if not track:
        raise ValueError("GPS/track analysis is required for a teaching storyboard.")
    reference_points = _usable_reference_points(track.get("reference") or [])
    if len(reference_points) < 4:
        raise ValueError("Distance-aligned GPS evidence is insufficient for a storyboard.")

    moments = select_teaching_moments(analysis, max_nodes=max_nodes)
    nodes: list[dict[str, Any]] = []
    for moment in moments:
        if moment["kind"] == "corner":
            video_range = _video_bounds_for_distance(
                float(moment["entry_distance_m"]),
                float(moment["exit_distance_m"]),
                reference_points,
                alignment,
            )
            if video_range is None:
                continue
            overlay = _telemetry_overlay(
                analysis,
                telemetry,
                reference_points,
                float(moment["entry_distance_m"]) - OVERLAY_DISTANCE_PADDING_M,
                float(moment["exit_distance_m"]) + OVERLAY_DISTANCE_PADDING_M,
            )
            nodes.append(
                {
                    "id": f"corner-{_corner_number(moment['corner'], moment['corner_id'])}",
                    "kind": "corner",
                    "title": _fallback_title(moment, language),
                    "time_range": video_range,
                    "distance_range_m": [
                        round(float(moment["entry_distance_m"]), 3),
                        round(float(moment["exit_distance_m"]), 3),
                    ],
                    "telemetry_overlay": overlay,
                    "insight": _fallback_insight(moment, language),
                    "drill": _fallback_drill(moment, language),
                    "evidence_laps": moment["supporting_laps"],
                    "net_gain_s": round(float(moment["net_gain"]), 3),
                    "corner": {
                        "name": moment["corner"],
                        "entry_distance_m": round(float(moment["entry_distance_m"]), 3),
                        "exit_distance_m": round(float(moment["exit_distance_m"]), 3),
                    },
                    "source": "structured",
                }
            )
        else:
            video_range = _video_bounds_for_event(moment, alignment)
            if video_range is None:
                continue
            overlay = _telemetry_overlay(
                analysis,
                telemetry,
                reference_points,
                float(moment["start_distance_m"]) - OVERLAY_DISTANCE_PADDING_M,
                float(moment["end_distance_m"]) + OVERLAY_DISTANCE_PADDING_M,
            )
            nodes.append(
                {
                    "id": f"event-{moment['event_index']}",
                    "kind": "event",
                    "title": _fallback_event_title(moment, language),
                    "time_range": video_range,
                    "distance_range_m": [
                        round(float(moment["start_distance_m"]), 3),
                        round(float(moment["end_distance_m"]), 3),
                    ],
                    "telemetry_overlay": overlay,
                    "insight": _fallback_event_insight(moment, language),
                    "drill": _fallback_event_drill(moment, language),
                    "evidence_laps": [int(moment["lap"])],
                    "corner": None,
                    "source": "structured",
                }
            )

    if not nodes:
        raise ValueError(
            "No teaching moment maps to usable in-bounds video evidence. "
            "Re-check the video-telemetry alignment."
        )
    nodes = nodes[:max_nodes]
    if len(nodes) < MIN_NODES:
        raise ValueError("A storyboard requires at least one in-bounds teaching moment.")

    generated = _generate_or_load_narrative(
        nodes,
        analysis,
        client=llm_client,
        language=language,
    )
    if generated:
        for node, copy in zip(nodes, generated, strict=True):
            if not copy:
                continue
            if copy.get("title"):
                node["title"] = copy["title"]
            if copy.get("insight"):
                node["insight"] = copy["insight"]
            if copy.get("drill"):
                node["drill"] = copy["drill"]
            node["source"] = "llm"

    return {
        "schema_version": STORYBOARD_SCHEMA_VERSION,
        "watermark": WATERMARK,
        "analysis": {
            "reference_lap": analysis.get("reference_lap"),
            "target_lap": analysis.get("target_lap"),
            "fastest_lap": analysis.get("fastest_lap"),
            **_storyboard_display_metadata(analysis),
        },
        "video": {
            "duration_s": round(alignment.video_duration_s, 3),
            "required": True,
            "uploaded": False,
        },
        "nodes": nodes,
    }


def _storyboard_display_metadata(analysis: dict[str, Any]) -> dict[str, str | None]:
    """Select non-sensitive display labels already present in session metadata."""
    metadata = analysis.get("metadata") if isinstance(analysis.get("metadata"), dict) else {}
    normalized = {
        re.sub(r"[^a-z0-9]", "", str(key).lower()): str(value).strip()
        for key, value in metadata.items()
        if value is not None and str(value).strip()
    }

    def first(*keys: str) -> str | None:
        return next((normalized[key] for key in keys if normalized.get(key)), None)

    track = analysis.get("track") if isinstance(analysis.get("track"), dict) else {}
    return {
        "driver": first("driver", "racer", "pilot"),
        "vehicle": first("vehicle", "kart", "car"),
        "track": first("venue", "track", "circuit") or str(track.get("track_id") or "").strip() or None,
    }


def _generate_or_load_narrative(
    nodes: list[dict[str, Any]],
    analysis: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
    language: str = "en",
) -> list[dict[str, Any]] | None:
    """Return cached or freshly generated node copies (None keeps structured)."""
    if not nodes or _llm_config() is None:
        return None
    cache_key = _narrative_cache_key(analysis, nodes, language)
    cached = _narrative_cache_get(cache_key)
    if cached is not None:
        narrative_stats["cache_hits"] += 1
        logger.info(
            "storyboard_narrative cache_hit key=%s nodes=%d",
            cache_key,
            len(nodes),
        )
        return cached
    try:
        generated = asyncio.run(
            _generate_node_copy(
                nodes,
                analysis,
                client=client,
                language=language,
            )
        )
    except RuntimeError:
        generated = None
    if generated is not None:
        _narrative_cache_set(cache_key, generated)
    return generated


def _narrative_cache_key(
    analysis: dict[str, Any],
    nodes: list[dict[str, Any]],
    language: str = "en",
) -> str:
    fingerprint = str(analysis.get("file_fingerprint") or "unknown")
    reference_lap = analysis.get("reference_lap")
    target_lap = analysis.get("target_lap")
    node_ids = "|".join(str(node.get("id")) for node in nodes)
    return f"{language}:{fingerprint}:{reference_lap}:{target_lap}:{node_ids}"


def _narrative_cache_get(key: str) -> list[dict[str, Any]] | None:
    entry = _NARRATIVE_CACHE.get(key)
    if entry is None:
        return None
    stored_at, value = entry
    if time.monotonic() - stored_at > NARRATIVE_CACHE_TTL_SECONDS:
        _NARRATIVE_CACHE.pop(key, None)
        return None
    return value


def _narrative_cache_set(key: str, value: list[dict[str, Any]]) -> None:
    _NARRATIVE_CACHE[key] = (time.monotonic(), value)


def clear_narrative_cache() -> None:
    """Clear the in-process narrative cache (used by tests)."""
    _NARRATIVE_CACHE.clear()


def narrative_stats_snapshot() -> dict[str, int]:
    """Return a copy of LLM narrative usage counters for observability."""
    return dict(narrative_stats)


def _event_moments(analysis: dict[str, Any], *, max_nodes: int) -> list[dict[str, Any]]:
    """Use high-confidence real events only when no corner moment is available."""
    priorities = [
        item
        for item in (analysis.get("ai_coach_summary") or {}).get(
            "training_priorities",
            [],
        )
        if item.get("corner")
        and _finite(item.get("entry_distance_m"))
        and _finite(item.get("exit_distance_m"))
    ]
    events = [
        event
        for event in analysis.get("events", [])
        if _finite(event.get("session_time_s"))
        and _finite(event.get("start_distance_m"))
        and _finite(event.get("end_distance_m"))
        and event.get("confidence") in {"high", "medium"}
        and event.get("evidence_class") != "synthetic"
    ]
    confidence_rank = {"high": 2, "medium": 1}
    events.sort(
        key=lambda event: confidence_rank.get(str(event.get("confidence")), 0),
        reverse=True,
    )
    moments: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        if len(moments) >= max_nodes:
            break
        priority = _priority_overlapping_event(priorities, event)
        if priority is None:
            continue
        moments.append(
            {
                "kind": "event",
                "event_index": index,
                "event_type": str(event.get("event_type") or "EVENT"),
                "lap": int(event["lap"]),
                "session_time_s": float(event["session_time_s"]),
                "start_distance_m": float(event["start_distance_m"]),
                "end_distance_m": float(event["end_distance_m"]),
                "confidence": str(event.get("confidence") or "medium"),
                "training_drill": str(priority.get("training_drill") or "").strip(),
                "what_to_test": str(priority.get("what_to_test") or "").strip(),
                "stop_condition": str(priority.get("stop_condition") or "").strip(),
            }
        )
    return moments


def _priority_overlapping_event(
    priorities: list[dict[str, Any]],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    """Match an event to the training priority whose distance range contains it."""
    start = float(event["start_distance_m"])
    end = float(event["end_distance_m"])
    for priority in priorities:
        entry = float(priority["entry_distance_m"])
        exit_m = float(priority["exit_distance_m"])
        if start <= exit_m and end >= entry:
            return priority
    return None


def _video_bounds_for_distance(
    entry_m: float,
    exit_m: float,
    reference_points: list[dict[str, float]],
    alignment: StoryboardAlignment,
) -> list[float] | None:
    """Map a distance window to an in-bounds video clip using the alignment."""
    start_time = _time_at_distance(reference_points, entry_m)
    end_time = _time_at_distance(reference_points, exit_m)
    if start_time is None or end_time is None:
        return None
    return _clip_video_range(
        start_time + alignment.offset_s - VIDEO_PADDING_S,
        end_time + alignment.offset_s + VIDEO_PADDING_S,
        alignment.video_duration_s,
    )


def _video_bounds_for_event(
    moment: dict[str, Any],
    alignment: StoryboardAlignment,
) -> list[float] | None:
    """Build an in-bounds video clip directly from a real event timestamp."""
    session_time = float(moment["session_time_s"])
    return _clip_video_range(
        session_time + alignment.offset_s - VIDEO_PADDING_S,
        session_time + alignment.offset_s + VIDEO_PADDING_S,
        alignment.video_duration_s,
    )


def _clip_video_range(
    start_s: float,
    end_s: float,
    duration_s: float,
) -> list[float] | None:
    """Clamp and size-limit a video window without ever exceeding bounds."""
    if not all(np.isfinite(value) for value in (start_s, end_s, duration_s)):
        return None
    if end_s - start_s > MAX_VIDEO_CLIP_S:
        midpoint = (start_s + end_s) / 2.0
        start_s = midpoint - MAX_VIDEO_CLIP_S / 2.0
        end_s = midpoint + MAX_VIDEO_CLIP_S / 2.0
    start_s = max(0.0, start_s)
    end_s = min(duration_s, end_s)
    if end_s - start_s < MIN_VIDEO_CLIP_S:
        return None
    return [round(start_s, 3), round(end_s, 3)]


def _telemetry_overlay(
    analysis: dict[str, Any],
    telemetry: pd.DataFrame | None,
    reference_points: list[dict[str, float]],
    start_m: float,
    end_m: float,
) -> dict[str, Any]:
    """Extract bounded overlay curves from measured, distance-aligned evidence."""
    window = [
        point
        for point in reference_points
        if start_m <= point["distance_m"] <= end_m
    ]
    if not window:
        return _empty_overlay(analysis)
    window = _uniform_sample(window, OVERLAY_MAX_POINTS)
    overlay: dict[str, Any] = {
        "distance_m": [round(point["distance_m"], 3) for point in window],
        "session_time_s": [round(point["session_time_s"], 3) for point in window],
        "speed_kmh": [round(point["speed"], 3) for point in window],
        "rpm": [round(point["rpm"], 3) for point in window],
        "longitudinal_g": [round(point["longitudinal_g"], 3) for point in window],
        "lateral_g": [round(point["lateral_g"], 3) for point in window],
        "throttle": [],
        "brake": [],
        "available": {
            "throttle": bool((analysis.get("capabilities") or {}).get("direct_throttle")),
            "brake": bool((analysis.get("capabilities") or {}).get("direct_brake")),
        },
    }
    if telemetry is not None and not telemetry.empty:
        overlay["throttle"] = _channel_at_times(
            telemetry,
            "throttle",
            analysis.get("reference_lap"),
            overlay["session_time_s"],
        )
        overlay["brake"] = _channel_at_times(
            telemetry,
            "brake",
            analysis.get("reference_lap"),
            overlay["session_time_s"],
        )
    overlay["available"] = {
        "throttle": bool(overlay["throttle"]),
        "brake": bool(overlay["brake"]),
    }
    return overlay


def _channel_at_times(
    telemetry: pd.DataFrame,
    column: str,
    lap: int | None,
    session_times: list[float],
) -> list[float | None]:
    """Interpolate one measured canonical channel at the overlay time points."""
    if column not in telemetry.columns:
        return []
    rows = telemetry[telemetry["lap"] == lap].sort_values("session_time_s")
    if rows.empty:
        return []
    values = rows[column].to_numpy(dtype=float)
    times = rows["session_time_s"].to_numpy(dtype=float)
    if len(times) < 2 or not np.all(np.isfinite(values)):
        return []
    interpolated = np.interp(
        np.asarray(session_times, dtype=float),
        times,
        values,
    )
    return [
        None if not np.isfinite(value) else round(float(value), 3)
        for value in interpolated
    ]


def _empty_overlay(analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        "distance_m": [],
        "session_time_s": [],
        "speed_kmh": [],
        "rpm": [],
        "longitudinal_g": [],
        "lateral_g": [],
        "throttle": [],
        "brake": [],
        "available": {
            "throttle": bool((analysis.get("capabilities") or {}).get("direct_throttle")),
            "brake": bool((analysis.get("capabilities") or {}).get("direct_brake")),
        },
    }


def _usable_reference_points(
    points: list[dict[str, Any]],
) -> list[dict[str, float]]:
    usable: list[dict[str, float]] = []
    for point in points:
        values = [
            point.get("distance_m"),
            point.get("session_time_s"),
            point.get("speed"),
            point.get("rpm"),
            point.get("longitudinal_g"),
            point.get("lateral_g"),
        ]
        if all(_finite(value) for value in values):
            usable.append(
                {
                    "distance_m": float(point["distance_m"]),
                    "session_time_s": float(point["session_time_s"]),
                    "speed": float(point["speed"]),
                    "rpm": float(point["rpm"]),
                    "longitudinal_g": float(point["longitudinal_g"]),
                    "lateral_g": float(point["lateral_g"]),
                }
            )
    usable.sort(key=lambda point: point["distance_m"])
    return usable


def _time_at_distance(
    reference_points: list[dict[str, float]],
    distance_m: float,
) -> float | None:
    distances = np.asarray([point["distance_m"] for point in reference_points])
    times = np.asarray([point["session_time_s"] for point in reference_points])
    if distance_m <= distances[0]:
        return float(times[0])
    if distance_m >= distances[-1]:
        return float(times[-1])
    return float(np.interp(distance_m, distances, times))


def _uniform_sample(
    points: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    if len(points) <= limit:
        return points
    indexes = {
        round(index * (len(points) - 1) / (limit - 1))
        for index in range(limit)
    }
    return [points[index] for index in sorted(indexes)]


def _corner_number(corner: str, corner_id: str) -> int:
    match = re.search(r"(\d+)", f"{corner_id} {corner}")
    return int(match.group(1)) if match else 0


def _first_pattern(corner: dict[str, Any]) -> str:
    patterns = corner.get("common_fast_pattern") or []
    return str(patterns[0]) if patterns else ""


def _fallback_title(moment: dict[str, Any], language: str = "en") -> str:
    number = _corner_number(moment["corner"], moment["corner_id"])
    gain = float(moment["net_gain"])
    if language == "zh":
        prefix = f"第 {number} 弯" if number else str(moment["corner"])
        return f"{prefix}：可改进 {gain:.2f} 秒"
    prefix = f"Corner {number}" if number else str(moment["corner"])
    return f"{prefix}: gain {gain:.2f}s"


def _fallback_insight(moment: dict[str, Any], language: str = "en") -> str:
    pattern = localize_pattern(moment.get("pattern") or "", language)
    laps = ", ".join(str(lap) for lap in moment["supporting_laps"][:3])
    corner = moment.get("corner") or ""
    entry = float(moment["entry_distance_m"])
    exit_m = float(moment["exit_distance_m"])
    if language == "zh":
        base = (
            f"真实圈 {laps} 在 {corner}（{entry:.0f}-{exit_m:.0f} m）"
            f"净收益 {moment['net_gain']:.2f} 秒"
        )
        return f"{base}。{pattern}。" if pattern else f"{base}。"
    base = (
        f"Real laps {laps} show a net gain of {moment['net_gain']:.2f}s "
        f"at {corner} ({entry:.0f}-{exit_m:.0f} m)"
    )
    return f"{base}. {pattern}." if pattern else f"{base}."


def _fallback_drill(moment: dict[str, Any], language: str = "en") -> str:
    zh = language == "zh"
    entry = float(moment["entry_distance_m"])
    exit_m = float(moment["exit_distance_m"])
    existing = str(moment.get("training_drill") or moment.get("what_to_test") or "").strip()
    stop = str(moment.get("stop_condition") or "").strip()
    number = _corner_number(moment.get("corner") or "", moment.get("corner_id") or "")
    label = (
        (f"第 {number} 弯" if number else str(moment.get("corner") or "该区域"))
        if zh
        else (f"Corner {number}" if number else str(moment.get("corner") or "the area"))
    )
    if existing:
        if zh:
            return (
                f"练习：{existing}（{label} {entry:.0f}-{exit_m:.0f} m）。"
                f"停止条件：{stop or '若出现二次 RPM 下降、轨迹不稳定或下游时间损失，停止实验。'}"
            )
        return (
            f"Drill: {existing} ({label} {entry:.0f}-{exit_m:.0f} m). "
            f"Stop if: {stop or 'a secondary RPM drop, instability, or downstream time loss appears.'}"
        )
    if zh:
        return (
            f"练习：下一节专注 {label}（{entry:.0f}-{exit_m:.0f} m），"
            f"验证 {moment['net_gain']:.2f}s 净收益是否可重复。"
            "停止条件：若出弯速度下降或下游时间损失，停止实验。"
        )
    return (
        f"Drill: next session focus on {label} ({entry:.0f}-{exit_m:.0f} m) "
        f"and verify the {moment['net_gain']:.2f}s net gain repeats. "
        "Stop if exit speed drops or downstream time is lost."
    )


def _fallback_event_title(moment: dict[str, Any], language: str = "en") -> str:
    label = moment["event_type"].replace("_", " ").title()
    if language == "zh":
        return f"{label}：真实圈第 {moment['lap']} 圈行为事件"
    return f"{label}: real-lap behavior on Lap {moment['lap']}"


def _fallback_event_insight(moment: dict[str, Any], language: str = "en") -> str:
    if language == "zh":
        return (
            f"真实圈第 {moment['lap']} 圈在 {moment['start_distance_m']:.1f}-"
            f"{moment['end_distance_m']:.1f} m 出现 {moment['event_type']} 事件，"
            f"置信度 {moment['confidence']}。"
        )
    return (
        f"Real lap {moment['lap']} shows a {moment['event_type']} event between "
        f"{moment['start_distance_m']:.1f} and {moment['end_distance_m']:.1f} m "
        f"with {moment['confidence']} confidence."
    )


def _fallback_event_drill(moment: dict[str, Any], language: str = "en") -> str:
    existing = str(moment.get("training_drill") or moment.get("what_to_test") or "").strip()
    stop = str(moment.get("stop_condition") or "").strip()
    if existing:
        if language == "zh":
            return (
                f"练习：{existing}。"
                f"停止条件：{stop or '若行为不重复或带来时间损失，停止实验。'}"
            )
        return (
            f"Drill: {existing}. "
            f"Stop if: {stop or 'the behavior does not repeat or costs time.'}"
        )
    if language == "zh":
        return (
            f"练习：下一节观察第 {moment['lap']} 圈的 {moment['event_type']} "
            "是否可重复，并与最快圈对比。停止条件：若行为不重复或带来时间损失，停止实验。"
        )
    return (
        f"Drill: next session observe whether the {moment['event_type']} on "
        f"Lap {moment['lap']} repeats and compare with the fastest lap. "
        "Stop if it does not repeat or costs time."
    )


async def _generate_node_copy(
    nodes: list[dict[str, Any]],
    analysis: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
    language: str = "en",
) -> list[dict[str, Any]] | None:
    """Ask the configured LLM for per-node title/insight/drill with grounding."""
    base_url, api_key, model = _llm_config()
    evidence = [_node_llm_evidence(node, analysis) for node in nodes]
    prompt = (
        "以下是唯一允许使用的结构化证据（均来自真实完成且通过质量门的圈）：\n"
        + json.dumps(evidence, ensure_ascii=False, separators=(",", ":"))
    )
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 1400,
        "messages": [
            {
                "role": "system",
                "content": (
                    STORYBOARD_SYSTEM_PROMPT.format(
                        language="中文" if language == "zh" else "English"
                    )
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    owned_client = client is None
    active_client = client or httpx.AsyncClient(timeout=30.0)
    narrative_stats["calls"] += 1
    started_at = time.monotonic()
    estimated_input_tokens = len(prompt) // 4
    try:
        response = await active_client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        duration_ms = round((time.monotonic() - started_at) * 1000)
        logger.info(
            "storyboard_narrative success duration_ms=%d "
            "estimated_input_tokens=%d estimated_output_tokens=%d",
            duration_ms,
            estimated_input_tokens,
            len(content) // 4,
        )
        parsed = _parse_json_array(content)
        if not parsed:
            narrative_stats["failures"] += 1
            logger.warning(
                "storyboard_narrative failure reason=unparseable "
                "duration_ms=%d",
                duration_ms,
            )
            return None
        by_id = {str(item.get("id")): item for item in parsed}
        result: list[dict[str, Any]] = []
        for node, node_evidence in zip(nodes, evidence, strict=True):
            item = by_id.get(str(node["id"]))
            if not item:
                result.append({})
                continue
            candidate = {
                "title": str(item.get("title") or "").strip(),
                "insight": str(item.get("insight") or "").strip(),
                "drill": str(item.get("drill") or "").strip(),
            }
            if not all(candidate.values()):
                result.append({})
                continue
            combined = " ".join(candidate.values())
            if not _numbers_are_grounded(combined, node_evidence):
                narrative_stats["failures"] += 1
                logger.warning(
                    "storyboard_narrative failure reason=ungrounded node=%s",
                    node.get("id"),
                )
                result.append({})
                continue
            if not is_specific_text(combined, language):
                narrative_stats["failures"] += 1
                logger.warning(
                    "storyboard_narrative failure reason=unspecific node=%s",
                    node.get("id"),
                )
                result.append({})
                continue
            if _contains_forbidden_filler(combined) or not _valid_storyboard_copy(
                candidate,
                language,
            ):
                narrative_stats["failures"] += 1
                logger.warning(
                    "storyboard_narrative failure reason=policy node=%s",
                    node.get("id"),
                )
                result.append({})
                continue
            result.append(candidate)
        return result
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        narrative_stats["failures"] += 1
        logger.warning(
            "storyboard_narrative failure reason=%s duration_ms=%d",
            type(exc).__name__,
            round((time.monotonic() - started_at) * 1000),
        )
        return None
    finally:
        if owned_client:
            await active_client.aclose()


def _node_llm_evidence(node: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """Compact per-node evidence containing only measured/calculated values."""
    evidence: dict[str, Any] = {
        "id": node["id"],
        "fastest_lap": analysis.get("fastest_lap"),
        "reference_lap": analysis.get("reference_lap"),
        "target_lap": analysis.get("target_lap"),
        "time_range_s": node["time_range"],
        "distance_range_m": node["distance_range_m"],
        "evidence_laps": node["evidence_laps"],
    }
    if node.get("corner"):
        corner = node["corner"]
        evidence["corner"] = {
            "name": corner["name"],
            "entry_distance_m": corner["entry_distance_m"],
            "exit_distance_m": corner["exit_distance_m"],
        }
        evidence["net_gain_s"] = node.get("net_gain_s")
    return evidence


def _valid_storyboard_copy(candidate: dict[str, str], language: str) -> bool:
    """Require a location, performance number, action, drill, and stop condition."""
    combined = " ".join(candidate.values())
    if not re.search(r"(?:zone|corner|sector|弯)\s*\d+|\d+(?:\.\d+)?\s*m\b", combined, re.IGNORECASE):
        return False
    if not re.search(r"\d+(?:\.\d+)?\s*(?:s|秒|rpm|km/h)\b", combined, re.IGNORECASE):
        return False
    drill = candidate["drill"].lower()
    if language == "zh":
        return "练习" in candidate["drill"] and "停止条件" in candidate["drill"]
    return "drill" in drill and "stop" in drill


def _parse_json_array(content: str) -> list[dict[str, Any]] | None:
    cleaned = content.strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start == -1 or end <= start:
            return None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(parsed, list):
        return None
    return [item for item in parsed if isinstance(item, dict)]


def _finite(value: Any) -> bool:
    try:
        return value is not None and bool(np.isfinite(float(value)))
    except (TypeError, ValueError):
        return False
