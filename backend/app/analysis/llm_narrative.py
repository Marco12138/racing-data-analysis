"""Optional evidence-bounded LLM narrative for XRK driver reviews."""

from __future__ import annotations

import json
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

import httpx

LLM_TIMEOUT_SECONDS = 30.0
_NUMBER_PATTERN = re.compile(r"(?<![\w.])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?")

SYSTEM_PROMPT = """你是一名谨慎的卡丁车数据复盘教练。
你只能使用用户提供的 JSON 证据，不得补充、推算、换算或编造任何数字。
测量值、计算值和推断必须保持原有证据边界；不能把疑似制动写成确认制动。
所有参考圈都是真实完成且通过质量门的圈，不得生成理论圈、合成圈或目标 RPM 曲线。
请使用中文，输出三个训练重点。每个重点严格使用以下结构，不使用阿拉伯数字编号：
训练重点一/二/三：简短结论
对应证据：只复述 JSON 中已有的事实和数字
练习建议：一句可执行、可在下一节练习验证的建议
如果证据不足，用“证据不足，暂不建议改变现有操作”明确说明，不得补造依据。
"""


def build_xrk_narrative_evidence(result: dict[str, Any]) -> dict[str, Any]:
    """Select compact report evidence without raw telemetry or plotting arrays."""
    quality = result.get("lap_quality") or {}
    consensus = result.get("consensus_benchmark") or {}
    coach = result.get("ai_coach_summary") or {}
    zones = (result.get("zones") or {}).get("comparisons", [])
    events = result.get("events") or []
    return {
        "reference_policy": consensus.get("reference_policy"),
        "capabilities": result.get("capabilities", {}),
        "evidence_catalog": result.get("evidence_catalog", {}),
        "fastest_lap": _pick(result.get("fastest_lap") or {}, "lap", "lap_time"),
        "reference_lap": result.get("reference_lap"),
        "selected_lap": result.get("target_lap"),
        "lap_quality_gate": {
            "reference_eligible_count": quality.get("reference_eligible_count"),
            "minimum_top_laps_met": quality.get("minimum_top_laps_met"),
            "notice": quality.get("notice"),
            "top_valid_laps": [
                _pick(
                    row,
                    "lap",
                    "lap_time",
                    "gap_to_fastest",
                    "quality_status",
                    "quality_score",
                    "reasons",
                )
                for row in quality.get("top_valid_laps", [])[:3]
            ],
        },
        "top3_consensus": [
            {
                **_pick(
                    corner,
                    "corner_id",
                    "corner",
                    "entry_distance_m",
                    "exit_distance_m",
                    "common_fast_pattern",
                    "fastest_lap_unique_features",
                    "repeatability_score",
                    "occurrence_count",
                    "supporting_laps",
                    "local_gain",
                    "downstream_cost",
                    "net_gain",
                    "transferable_improvement",
                    "confidence",
                ),
                "evidence_channels": (corner.get("evidence") or {}).get("channels", []),
            }
            for corner in consensus.get("corners", [])
        ],
        "achievable_improvement_range": result.get(
            "achievable_improvement_range", {}
        ),
        "zone_comparisons": [
            {
                **_pick(
                    zone,
                    "id",
                    "name",
                    "entry_distance_m",
                    "exit_distance_m",
                    "estimated_zone_loss_s",
                ),
                "findings": [
                    _pick(
                        finding,
                        "metric",
                        "label",
                        "reference",
                        "target",
                        "difference",
                        "unit",
                        "evidence_class",
                    )
                    for finding in zone.get("findings", [])[:4]
                ],
            }
            for zone in zones
        ],
        "rpm_behavior_events": _summarize_events(events),
        "coach_evidence": {
            "common_fast_patterns": coach.get("common_fast_patterns", []),
            "fastest_lap_net_differences": coach.get(
                "fastest_lap_net_differences", []
            ),
            "fastest_lap_unique_features": coach.get(
                "fastest_lap_unique_features", []
            ),
            "emerging_improvements": coach.get("emerging_improvements", []),
            "rejected_apparent_improvements": coach.get(
                "rejected_apparent_improvements", []
            ),
            "training_priorities": [
                _pick(
                    priority,
                    "corner",
                    "why",
                    "what_to_test",
                    "training_drill",
                    "success_criteria",
                    "stop_condition",
                    "confidence",
                    "limitation",
                )
                for priority in coach.get("training_priorities", [])[:3]
            ],
            "stable_strengths": [
                _pick(strength, "corner", "finding")
                for strength in coach.get("stable_strengths", [])[:3]
            ],
            "limitations": coach.get("limitations", []),
        },
    }


async def generate_llm_narrative(
    evidence: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
) -> str | None:
    """Return an optional narrative, falling back silently on any failure."""
    config = _llm_config()
    if config is None:
        return None
    base_url, api_key, model = config
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 900,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": "以下是唯一允许使用的结构化证据：\n"
                + json.dumps(evidence, ensure_ascii=False, separators=(",", ":")),
            },
        ],
    }
    owned_client = client is None
    active_client = client or httpx.AsyncClient(timeout=LLM_TIMEOUT_SECONDS)
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
        if not isinstance(content, str) or not content.strip():
            return None
        narrative = content.strip()
        return narrative if _numbers_are_grounded(narrative, evidence) else None
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None
    finally:
        if owned_client:
            await active_client.aclose()


def _llm_config() -> tuple[str, str, str] | None:
    values = tuple(
        os.getenv(name, "").strip()
        for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
    )
    if not all(values):
        return None
    base_url, api_key, model = values
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if os.getenv("APP_MODE", "local").lower() == "cloud" and parsed.scheme != "https":
        return None
    return base_url, api_key, model


def _summarize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    examples: list[dict[str, Any]] = []
    for event in events:
        event_type = str(event.get("event_type", "UNKNOWN"))
        counts[event_type] = counts.get(event_type, 0) + 1
        if len(examples) < 12:
            examples.append(
                {
                    **_pick(
                        event,
                        "lap",
                        "sector",
                        "zone",
                        "distance_m",
                        "lap_time_s",
                        "event_type",
                        "confidence",
                        "channels_used",
                    ),
                    "thresholds": event.get("thresholds", {}),
                    "evidence": event.get("evidence", {}),
                }
            )
    return {"counts": counts, "examples": examples}


def _pick(source: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: source[key] for key in keys if key in source}


def _numbers_are_grounded(text: str, evidence: dict[str, Any]) -> bool:
    allowed = _evidence_numbers(evidence)
    for match in _NUMBER_PATTERN.findall(text):
        try:
            if Decimal(match.lstrip("+")) not in allowed:
                return False
        except InvalidOperation:
            return False
    return True


def _evidence_numbers(value: Any) -> set[Decimal]:
    numbers: set[Decimal] = set()
    if isinstance(value, bool) or value is None:
        return numbers
    if isinstance(value, (int, float, Decimal)):
        try:
            numbers.add(Decimal(str(value)))
        except InvalidOperation:
            pass
        return numbers
    if isinstance(value, str):
        for match in _NUMBER_PATTERN.findall(value):
            try:
                numbers.add(Decimal(match.lstrip("+")))
            except InvalidOperation:
                pass
        return numbers
    if isinstance(value, dict):
        for key, item in value.items():
            numbers.update(_evidence_numbers(key))
            numbers.update(_evidence_numbers(item))
        return numbers
    if isinstance(value, (list, tuple)):
        for item in value:
            numbers.update(_evidence_numbers(item))
    return numbers
