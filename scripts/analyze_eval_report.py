#!/usr/bin/env python3
"""Turn narrative evaluation artifacts into concrete prompt refinements."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
EVAL_ROOT = REPOSITORY_ROOT / "tmp/narrative_eval"

ISSUE_LABELS = {
    "missing_corner_anchor": "缺少弯角编号或距离锚点",
    "vague_drill": "练习不具体或缺少停止条件",
    "mixed_language": "中英文夹杂",
    "ungrounded_number": "数字与结构化证据不符",
    "forbidden_word": "出现禁词或宽泛措辞",
}
FORBIDDEN_WORDS = (
    "注意",
    "改善",
    "提高",
    "overall",
    "generally",
    "try to improve",
    "better",
    "理论圈",
    "合成圈",
    "synthetic target lap",
    "synthetic rpm",
)
ALLOWED_TELEMETRY_WORDS = {
    "ai",
    "gps",
    "lap",
    "rpm",
    "sector",
    "zone",
    "km",
    "m",
    "s",
}


def latest_evaluation_directory(path: Path | None = None) -> Path:
    """Resolve an explicit evaluation path or the newest summary directory."""
    if path is not None:
        candidate = path.expanduser().resolve()
        directory = candidate.parent if candidate.name == "summary.json" else candidate
        if not (directory / "summary.json").is_file():
            raise FileNotFoundError(f"找不到 summary.json：{directory}")
        return directory
    candidates = sorted(
        EVAL_ROOT.glob("*/summary.json"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(
            "tmp/narrative_eval/ 下没有评估结果，请先运行 evaluate_narrative.py。"
        )
    return candidates[0].parent


def load_evaluation_rows(directory: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Read one summary and its bounded per-language sample artifacts."""
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*_*.json")):
        if path.name == "summary.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and "language" in payload:
            payload["_artifact"] = path.name
            rows.append(payload)
    return summary, rows


def classify_row(row: dict[str, Any]) -> set[str]:
    """Classify common narrative failures without reading raw telemetry arrays."""
    text = str(row.get("llm_narrative") or "")
    language = str(row.get("language") or "")
    issues = " ".join(str(item) for item in row.get("issues", []))
    categories: set[str] = set()

    if not re.search(r"(?:第\s*\d+\s*弯|Zone\s*\d+|Corner\s*\d+|Sector\s*\d+|\d+(?:\.\d+)?\s*m\b)", text, re.IGNORECASE):
        categories.add("missing_corner_anchor")
    if not _has_verifiable_drill(text, language) or "缺少练习" in issues:
        categories.add("vague_drill")
    if _has_mixed_language(text, language) or "语言不符合" in issues:
        categories.add("mixed_language")
    if "证据之外的数字" in issues or "ungrounded" in issues.lower():
        categories.add("ungrounded_number")
    if _contains_forbidden_word(text) or "违规表述" in issues:
        categories.add("forbidden_word")
    return categories


def _has_verifiable_drill(text: str, language: str) -> bool:
    if not text:
        return False
    lowered = text.lower()
    if language == "zh":
        return "练习" in text and "停止条件" in text and bool(re.search(r"\d", text))
    return "drill" in lowered and "stop" in lowered and bool(re.search(r"\d", text))


def _has_mixed_language(text: str, language: str) -> bool:
    if not text:
        return False
    if language == "en":
        return len(re.findall(r"[\u4e00-\u9fff]", text)) >= 4
    english_words = {
        word.lower()
        for word in re.findall(r"\b[A-Za-z]{2,}\b", text)
        if word.lower() not in ALLOWED_TELEMETRY_WORDS
    }
    return len(english_words) >= 3


def _contains_forbidden_word(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in FORBIDDEN_WORDS)


def refinement_suggestions(counts: Counter[str]) -> list[str]:
    """Return three to five prompt changes ordered by observed frequency."""
    suggestions = {
        "missing_corner_anchor": "强制每个训练重点在首句写明 Corner/Zone 编号及起止距离，缺少锚点时直接输出证据不足。",
        "vague_drill": "将练习建议固定为“具体动作 + 验证指标 + 停止条件”，禁止仅写注意、改善或提高。",
        "mixed_language": "为中文和英文分别提供完整 few-shot，不允许除 RPM/GPS/Zone/Sector 等遥测术语外的语言混用。",
        "ungrounded_number": "继续执行数字白名单校验，并要求模型逐字复述 evidence JSON 中的原始精度，不做换算或四舍五入。",
        "forbidden_word": "把宽泛措辞、理论圈、合成圈和 synthetic RPM 纳入生成后禁词校验，命中即回退结构化摘要。",
    }
    ordered = [key for key, _count in counts.most_common() if key in suggestions]
    defaults = [
        "vague_drill",
        "missing_corner_anchor",
        "ungrounded_number",
        "mixed_language",
        "forbidden_word",
    ]
    for key in defaults:
        if key not in ordered:
            ordered.append(key)
    return [suggestions[key] for key in ordered[:5]]


def analyze_evaluation_directory(directory: Path) -> Path:
    """Write prompt_refinement_report.md beside one evaluation summary."""
    summary, rows = load_evaluation_rows(directory)
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        for category in classify_row(row):
            counts[category] += 1
            if len(examples[category]) < 3:
                examples[category].append(
                    f"{row.get('inspection_id', 'unknown')} · {row.get('language', '?')} · {row.get('_artifact')}"
                )

    lines = [
        "# Prompt Refinement Report",
        "",
        f"- 评估目录：`{directory}`",
        f"- 自动 verdict：**{summary.get('overall_recommendation', 'UNKNOWN')}**",
        f"- 样本文案数：{len(rows)}",
        f"- 数据来源：{', '.join(summary.get('sample_sources', [])) or 'unknown'}",
        "- 注意：本报告只读取摘要和叙事文案，不读取原始遥测数组。",
        "",
        "## 常见 Issue",
        "",
        "| Issue | 次数 | 样例 |",
        "| --- | ---: | --- |",
    ]
    for category in ISSUE_LABELS:
        sample_text = "; ".join(examples.get(category, [])) or "无"
        lines.append(f"| {ISSUE_LABELS[category]} | {counts[category]} | {sample_text} |")
    lines.extend(["", "## 建议的 Prompt 修改", ""])
    for index, suggestion in enumerate(refinement_suggestions(counts), start=1):
        lines.append(f"{index}. {suggestion}")
    lines.extend(
        [
            "",
            "## 人工复核重点",
            "",
            "- 逐条核对 LLM 中的数字是否存在于对应 evidence JSON。",
            "- 确认每项建议包含弯角/距离、时间或 RPM、具体动作、可验证练习和停止条件。",
            "- 任一维度持平或落后时继续保持 `KEEP_STRUCTURED`。",
            "",
        ]
    )
    target = directory / "prompt_refinement_report.md"
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=None)
    args = parser.parse_args()
    try:
        directory = latest_evaluation_directory(args.path)
        target = analyze_evaluation_directory(directory)
    except (FileNotFoundError, OSError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}")
        return 1
    print(f"Prompt refinement report: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
