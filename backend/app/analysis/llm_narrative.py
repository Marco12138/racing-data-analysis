"""Optional evidence-bounded LLM narrative for XRK driver reviews."""

from __future__ import annotations

import json
import math
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

import httpx

from .text_locale import is_specific_text

LLM_TIMEOUT_SECONDS = 30.0
_NUMBER_PATTERN = re.compile(r"(?<![\w.])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?")
_FORBIDDEN_FILLER = (
    "注意",
    "改善",
    "提高",
    "更好",
    "尝试优化",
    "overall",
    "generally",
    "try to improve",
    "better",
    "theoretical best",
    "synthetic target lap",
    "synthetic rpm",
)

SYSTEM_PROMPT = """你是一名谨慎的卡丁车数据复盘教练。
你只能使用用户提供的 JSON 证据，不得补充、推算、换算或编造任何数字。
测量值、计算值和推断必须保持原有证据边界；不能把疑似制动写成确认制动。
所有参考圈都是真实完成且通过质量门的圈，不得生成理论圈、合成圈或目标 RPM 曲线。
每个训练重点必须同时包含：弯角/Zone 编号与距离、时间或 RPM 数字、具体驾驶动作、
可验证练习、停止条件。禁止使用“注意”“改善”“提高”“更好”“尝试优化”
“overall”“generally”“try to improve”“better”等宽泛措辞。
请使用 {language} 输出恰好三个训练重点。中文使用以下四行结构：
训练重点一/二/三：简短结论
对应证据：只复述 JSON 中已有的事实和数字
练习建议：具体动作及验证指标
停止条件：何时停止本项实验
英文使用 Training focus one/two/three、Evidence、Drill、Stop condition 四行结构。
如果证据不足，中文用“证据不足，暂不建议改变现有操作”，英文用
“Evidence is insufficient; do not change the existing operation.”，不得补造依据。

好示例（方括号是字段占位符，输出时只能替换为 JSON 中已有值）：
训练重点一：[corner]（[entry_distance_m]-[exit_distance_m] m）保持 RPM 恢复。
对应证据：真实圈 [supporting_laps]，净收益 [net_gain]s，下游代价 [downstream_cost]s。
练习建议：只改变恢复动作，在 [entry_distance_m] m 核对 [net_gain]s。
停止条件：若下游代价高于 [downstream_cost]s，停止本项实验。

训练重点二：[corner]（[entry_distance_m]-[exit_distance_m] m）保持最低 RPM。
对应证据：参考圈 [reference] rpm，目标圈 [target] rpm，差值 [difference] rpm。
练习建议：只改变证据支持的动作，在 [entry_distance_m] m 核对 [target] rpm。
停止条件：若 RPM 低于 [target] rpm，停止本项实验。

Bad case 1（缺少弯角/距离，禁止模仿）：
训练重点：注意改善整体节奏。
对应证据：车手表现一般。
练习建议：try to improve 综合表现。
修正：首句必须写 Zone 编号和距离，证据只引用 JSON 数字，并补停止条件。

Bad case 2（练习不可验证，禁止模仿）：“保持节奏，多练习几圈。”
修正：写明只改变哪个动作、在哪个距离核对何种时间/RPM 数字、何时停止。

Bad case 3（语言混杂，禁止模仿）：“训练重点：improve exit，保持 overall consistency。”
修正：除 RPM、GPS、Zone、Sector、Lap 与单位外，必须完全使用目标语言。
"""

ENGLISH_OUTPUT_RULE = """MANDATORY OUTPUT LANGUAGE: English only.
The policy below is written in Chinese, but your entire answer must use English.
Use exactly these labels for all three blocks: Training focus one/two/three,
Evidence, Drill, Stop condition. Do not output Chinese characters.

"""


def build_xrk_narrative_evidence(result: dict[str, Any]) -> dict[str, Any]:
    """Select compact report evidence without raw telemetry or plotting arrays."""
    quality = result.get("lap_quality") or {}
    consensus = result.get("consensus_benchmark") or {}
    coach = result.get("ai_coach_summary") or {}
    zones = (result.get("zones") or {}).get("comparisons", [])
    events = result.get("events") or []
    return _round_evidence_numbers({
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
    })


async def generate_llm_narrative(
    evidence: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
    language: str = "en",
) -> str | None:
    """Return an optional narrative, falling back silently on any failure."""
    config = _llm_config()
    if config is None:
        return None
    base_url, api_key, model = config
    evidence_json = json.dumps(
        evidence,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    numeric_whitelist = list(dict.fromkeys(_NUMBER_PATTERN.findall(evidence_json)))
    english_only = language == "en"
    payload = {
        "model": model,
        "temperature": 0.0,
        "max_tokens": 1400,
        "messages": [
            {
                "role": "system",
                "content": (
                    (ENGLISH_OUTPUT_RULE if english_only else "")
                    + SYSTEM_PROMPT.format(
                        language="中文" if language == "zh" else "English"
                    )
                ),
            },
            {
                "role": "user",
                "content": (
                    (
                        "Numeric whitelist (copy every output number verbatim from "
                        "this list; do not change precision or add repetition counts):\n"
                        if english_only
                        else "数字白名单（输出中的每个阿拉伯数字必须从此列表逐字复制，"
                        "不得改变精度或添加练习次数）：\n"
                    )
                    + json.dumps(numeric_whitelist, ensure_ascii=False)
                    + (
                        "\nThis JSON is the only permitted evidence:\n"
                        if english_only
                        else "\n以下是唯一允许使用的结构化证据：\n"
                    )
                    + evidence_json
                ),
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
        if not _numbers_are_grounded(narrative, evidence):
            return None
        if not is_specific_text(narrative, language):
            return None
        if not _passes_narrative_policy(narrative, language):
            return None
        return narrative
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


def _round_evidence_numbers(value: Any) -> Any:
    """Bound LLM evidence precision without changing the analysis result."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        return round(value, 3) if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _round_evidence_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round_evidence_numbers(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_round_evidence_numbers(item) for item in value)
    return value


def _numbers_are_grounded(text: str, evidence: dict[str, Any]) -> bool:
    allowed = _evidence_numbers(evidence)
    for match in _NUMBER_PATTERN.findall(text):
        try:
            if Decimal(match.lstrip("+")) not in allowed:
                return False
        except InvalidOperation:
            return False
    return True


def _contains_forbidden_filler(text: str) -> bool:
    """Reject broad coaching filler and synthetic-reference language."""
    lowered = text.lower()
    return any(phrase in lowered for phrase in _FORBIDDEN_FILLER)


def _passes_narrative_policy(text: str, language: str) -> bool:
    """Require three evidence-anchored, testable coaching blocks."""
    if _contains_forbidden_filler(text):
        return False
    if language == "en" and re.search(r"[\u4e00-\u9fff]", text):
        return False
    if language == "zh":
        blocks = re.split(r"(?=训练重点[一二三])", text)
        blocks = [block for block in blocks if block.startswith("训练重点")]
        labels = ("对应证据", "练习建议", "停止条件")
        action_pattern = r"恢复|收油|制动|刹车|油门|转速|RPM|速度|保持"
    else:
        blocks = re.split(r"(?=Training focus (?:one|two|three))", text, flags=re.IGNORECASE)
        blocks = [block for block in blocks if re.match(r"Training focus", block, re.IGNORECASE)]
        labels = ("evidence", "drill", "stop condition")
        action_pattern = r"recover|lift|brak|throttle|rpm|speed|hold|maintain"
    if len(blocks) != 3:
        return False
    for block in blocks:
        lowered = block.lower()
        if not all(label.lower() in lowered for label in labels):
            return False
        if not re.search(r"(?:zone|corner|sector|弯)\s*\d+|\d+(?:\.\d+)?\s*m\b", block, re.IGNORECASE):
            return False
        if not re.search(r"\d+(?:\.\d+)?\s*(?:s|秒|rpm|km/h)\b", block, re.IGNORECASE):
            return False
        if not re.search(action_pattern, block, re.IGNORECASE):
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
