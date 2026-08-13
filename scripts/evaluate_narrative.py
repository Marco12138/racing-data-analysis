#!/usr/bin/env python3
"""Bounded read-only quality evaluation for the optional LLM narrative layer.

Usage:
    python scripts/evaluate_narrative.py [--limit 10] [--languages zh,en]

Data sources (read-only):
1. Real analysis JSON files placed in tmp/narrative_eval/samples/ — each file
   must be the full response of POST /api/v1/xrk/analyze (a complete analysis
   result dict). These are non-public sessions you export locally.
2. If no samples are present, the bundled reviewed demo artifact is used as a
   clearly-labeled smoke sample so the pipeline can run without a network.

The script never writes production data and makes at most
`limit x len(languages)` LLM calls (10 x 2 = 20 by default). The API key is
read from the environment only and is never written to output or logs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.app.analysis.llm_narrative import (  # noqa: E402
    _llm_config,
    build_xrk_narrative_evidence,
    generate_llm_narrative,
)
from backend.app.analysis.xrk_session_analysis import generate_xrk_report  # noqa: E402
from verify_llm_config import VerifyError, verify_from_env  # noqa: E402

DEMO_ARTIFACT = REPOSITORY_ROOT / "public/demo/reviewed-real-session.json"
SAMPLES_DIR = REPOSITORY_ROOT / "tmp/narrative_eval/samples"
FORBIDDEN_SAFETY = ("理论圈", "合成圈", "synthetic target lap", "synthetic rpm")
SAFETY_NEGATIONS = ("不", "无", "没有", "不得", "禁止", "拒绝", "no ", "not ", "never ", "without ")

COST_PER_1M_TOKENS: dict[str, dict[str, float]] = {
    "deepseek-chat": {"input": 0.27, "output": 1.10},
}


def score_specificity(text: str | None) -> int:
    """0-10 specificity: distinct numbers, corner/distance anchor, drill, stop."""
    if not text:
        return 0
    distinct_numbers = len(set(re.findall(r"\d+(?:\.\d+)?", text)))
    score = min(distinct_numbers, 6)
    if re.search(r"\b(m|km/h|rpm)\b|米|弯|Zone|Corner|Sector", text, re.IGNORECASE):
        score += 2
    if re.search(r"练习|训练|drill|practice", text, re.IGNORECASE):
        score += 1
    if re.search(r"停止|stop", text, re.IGNORECASE):
        score += 1
    return min(10, score)


def language_ok(text: str | None, language: str) -> bool:
    if not text:
        return False
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    ratio = cjk / max(1, len(text))
    return ratio >= 0.3 if language == "zh" else ratio < 0.3


def is_executable(text: str | None) -> bool:
    if not text:
        return False
    has_practice = bool(re.search(r"练习|训练|drill|practice", text, re.IGNORECASE))
    has_stop = bool(re.search(r"停止|stop", text, re.IGNORECASE))
    return has_practice and has_stop


def is_safe(text: str | None) -> bool:
    if not text:
        return False
    for sentence in re.split(r"[。！？.!?\n]+", text.lower()):
        if any(word in sentence for word in FORBIDDEN_SAFETY) and not any(
            negation in sentence for negation in SAFETY_NEGATIONS
        ):
            return False
    return True


def grounding_ok(text: str | None, analysis: dict[str, Any]) -> bool:
    if not text:
        return False
    from backend.app.analysis.llm_narrative import _numbers_are_grounded

    return _numbers_are_grounded(text, build_xrk_narrative_evidence(analysis))


def evaluate_text(
    text: str | None,
    language: str,
    analysis: dict[str, Any],
) -> dict[str, Any]:
    return {
        "specificity_score": score_specificity(text),
        "accurate": grounding_ok(text, analysis),
        "language_ok": language_ok(text, language),
        "executable": is_executable(text),
        "safe": is_safe(text),
    }


def load_samples(limit: int) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    if SAMPLES_DIR.is_dir():
        for path in sorted(SAMPLES_DIR.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                print(f"skip {path.name}: {exc}", file=sys.stderr)
                continue
            analysis = payload.get("analysis") if "analysis" in payload else payload
            if isinstance(analysis, dict) and analysis.get("fastest_lap"):
                samples.append(
                    {
                        "inspection_id": str(
                            analysis.get("inspection_id")
                            or path.stem
                            or "sample"
                        ),
                        "source": "user-sample",
                        "analysis": analysis,
                    }
                )
            else:
                print(f"skip {path.name}: not a complete analyze response", file=sys.stderr)
        if samples:
            return samples[:limit]
    print(
        "No real samples in tmp/narrative_eval/samples/; using the bundled demo "
        "artifact as a labeled smoke sample. Place real analyze JSON exports "
        "there for a production-quality evaluation.",
        file=sys.stderr,
    )
    if DEMO_ARTIFACT.is_file():
        reviewed = json.loads(DEMO_ARTIFACT.read_text(encoding="utf-8"))
        return [
            {
                "inspection_id": str(
                    reviewed.get("analysis", {}).get("inspection_id") or "demo"
                ),
                "source": "demo-artifact",
                "analysis": reviewed["analysis"],
            }
        ][:limit]
    return []


async def evaluate_session(
    session: dict[str, Any],
    languages: list[str],
    *,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    analysis = session["analysis"]
    evidence = build_xrk_narrative_evidence(analysis)
    rows: list[dict[str, Any]] = []
    for language in languages:
        llm_text = (
            None
            if dry_run
            else await generate_llm_narrative(evidence, language=language)
        )
        structured_text = generate_xrk_report(analysis, language=language)
        llm_eval = evaluate_text(llm_text, language, analysis)
        structured_eval = evaluate_text(structured_text, language, analysis)
        issues: list[str] = []
        if llm_text is None:
            issues.append("llm 未配置或生成失败，已使用结构化回退")
        else:
            if not llm_eval["accurate"]:
                issues.append("llm 出现证据之外的数字")
            if not llm_eval["language_ok"]:
                issues.append("llm 语言不符合目标 locale")
            if not llm_eval["executable"]:
                issues.append("llm 缺少练习或停止条件")
            if not llm_eval["safe"]:
                issues.append("llm 出现理论圈/合成圈等违规表述")
            if not re.search(r"弯|Zone|Corner|Sector|\bm\b", llm_text or "", re.IGNORECASE):
                issues.append("llm 未提及具体弯角编号")
        token_usage, cost_estimate = estimate_usage(evidence, llm_text)
        rows.append(
            {
                "inspection_id": session["inspection_id"],
                "source": session["source"],
                "language": language,
                "model": _llm_config()[2] if _llm_config() is not None else None,
                "llm_narrative": llm_text,
                "structured_fallback": structured_text,
                "token_usage": token_usage,
                "cost_estimate": cost_estimate,
                "specificity_score": {"llm": llm_eval["specificity_score"], "structured": structured_eval["specificity_score"]},
                "issues": issues,
                "dims": {"llm": llm_eval, "structured": structured_eval},
            }
        )
    return rows


def estimate_usage(
    evidence: dict[str, Any],
    llm_text: str | None,
) -> tuple[dict[str, int], dict[str, Any]]:
    """Estimate tokens and cost without exposing any secret."""
    input_tokens = max(1, len(json.dumps(evidence, ensure_ascii=False)) // 4)
    output_tokens = max(0, len(llm_text or "") // 4)
    model = _llm_config()[2] if _llm_config() is not None else None
    rates = COST_PER_1M_TOKENS.get(model or "")
    if rates is None:
        return (
            {"estimated_input_tokens": input_tokens, "estimated_output_tokens": output_tokens},
            {"estimated_usd": None, "note": "未知模型定价，跳过成本估算"},
        )
    cost = (
        input_tokens / 1_000_000 * rates["input"]
        + output_tokens / 1_000_000 * rates["output"]
    )
    return (
        {"estimated_input_tokens": input_tokens, "estimated_output_tokens": output_tokens},
        {"estimated_usd": round(cost, 5), "note": "按模型单价估算，仅供参考"},
    )


def compare_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    dims = ("specificity_score", "accurate", "language_ok", "executable", "safe")
    tally = {dim: {"llm_win": 0, "structured_win": 0, "tie": 0} for dim in dims}
    for row in rows:
        llm = row["dims"]["llm"]
        structured = row["dims"]["structured"]
        for dim in dims:
            if dim == "specificity_score":
                left, right = llm[dim], structured[dim]
            else:
                left, right = bool(llm[dim]), bool(structured[dim])
            if left > right:
                tally[dim]["llm_win"] += 1
            elif right > left:
                tally[dim]["structured_win"] += 1
            else:
                tally[dim]["tie"] += 1
    return tally


def add_win_rates(
    tally: dict[str, dict[str, int]],
) -> dict[str, dict[str, int | float]]:
    """Add explicit rates while retaining counts for backwards compatibility."""
    results: dict[str, dict[str, int | float]] = {}
    for dimension, counts in tally.items():
        total = sum(counts.values())
        denominator = max(1, total)
        results[dimension] = {
            **counts,
            "total": total,
            "llm_win_rate": round(counts["llm_win"] / denominator, 4),
            "structured_win_rate": round(counts["structured_win"] / denominator, 4),
            "tie_rate": round(counts["tie"] / denominator, 4),
        }
    return results


def decide_recommendation(
    rows: list[dict[str, Any]],
    tally: dict[str, dict[str, int]],
) -> tuple[str, list[str]]:
    """Recommend only when the LLM wins every dimension on real samples."""
    llm_generated = sum(1 for row in rows if row["llm_narrative"] is not None)
    if llm_generated != len(rows):
        return (
            "KEEP_STRUCTURED",
            [f"llm 仅成功生成 {llm_generated}/{len(rows)} 份叙事"],
        )
    if any(row["source"] == "demo-artifact" for row in rows):
        return "KEEP_STRUCTURED", ["仅有 demo 工件，缺少真实 session 评估"]

    weak_dims = [
        dimension
        for dimension, counts in tally.items()
        if counts["llm_win"] <= counts["structured_win"]
    ]
    if weak_dims:
        return "KEEP_STRUCTURED", weak_dims
    return "ENABLE_LLM", []


def write_report(out_dir: Path, summary: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    lines = [
        "# LLM 叙事质量评估报告",
        "",
        f"- 生成时间：{summary['generated_at']}",
        f"- 样本 session 数：{summary['sessions']}",
        f"- 评估调用数：{summary['calls']}",
        f"- 数据来源：{', '.join(summary['sample_sources'])}",
        f"- 结论：**{summary['overall_recommendation']}**",
        "- 决策门槛：必须使用真实样本，并且 LLM 在具体性、准确性、语言、可执行性和安全性五个维度均全面优于结构化基线。",
    ]
    if summary.get("weak_dims"):
        lines.append(f"- 待改进维度：{', '.join(summary['weak_dims'])}")
    lines.extend(["", "## 各维度胜率（LLM vs 结构化）", "", "| 维度 | LLM 胜 | 结构化胜 | 平局 | LLM 胜率 |", "| --- | ---: | ---: | ---: | ---: |"])
    for dim, counts in summary["win_rate"].items():
        lines.append(
            f"| {dim} | {counts['llm_win']} | {counts['structured_win']} | "
            f"{counts['tie']} | {counts['llm_win_rate']:.0%} |"
        )
    lines.extend(
        [
            "",
            "## 人工审阅说明",
            "",
            "以下内容按 session 和语言列出。请人工核对所有数字是否来自结构化证据，",
            "并判断训练建议是否可执行。`demo-artifact` 只能作为流程冒烟，不足以支持生产启用决策。",
            "",
            "## 样本明细",
            "",
        ]
    )
    for row in rows:
        lines.extend(
            [
                f"### {row['inspection_id']} · {row['language']}",
                "",
                f"- 来源：`{row['source']}`",
                f"- 模型：`{row['model'] or 'not-available'}`",
                f"- 具体性：LLM {row['specificity_score']['llm']} / 结构化 {row['specificity_score']['structured']}",
                f"- Issues：{'; '.join(row['issues']) if row['issues'] else '无'}",
                "",
                "#### LLM Narrative",
                "",
                row["llm_narrative"] or "_未生成，使用结构化回退。_",
                "",
                "#### Structured Baseline",
                "",
                row["structured_fallback"],
                "",
            ]
        )
    lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--languages", default="zh,en")
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true", help="不调用 LLM，只生成结构化样本")
    args = parser.parse_args()
    languages = [item.strip() for item in args.languages.split(",") if item.strip() in {"zh", "en"}]
    if not languages:
        print("--languages must contain zh and/or en", file=sys.stderr)
        return 2
    if not args.dry_run:
        try:
            verify_result = verify_from_env()
        except VerifyError as exc:
            print(f"错误：{exc}", file=sys.stderr)
            print("使用 --dry-run 可跳过 LLM，仅生成结构化样本。", file=sys.stderr)
            return 2
        if not verify_result.ok:
            print(f"LLM 配置验证失败：{verify_result.message}", file=sys.stderr)
            for warning in verify_result.warnings:
                print(f"警告：{warning}", file=sys.stderr)
            print("未开始评估，也未写入任何 API key。", file=sys.stderr)
            return 1
        print(
            f"LLM 配置验证通过：model={verify_result.model}，"
            f"latency_ms={verify_result.latency_ms}"
        )

    samples = load_samples(max(1, min(args.limit, 10)))
    if not samples:
        print("No analysis samples available for evaluation.", file=sys.stderr)
        return 1

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out_dir = args.output_dir or (REPOSITORY_ROOT / "tmp/narrative_eval" / timestamp)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict[str, Any]] = []
    for session in samples:
        rows = asyncio.run(evaluate_session(session, languages, dry_run=args.dry_run))
        all_rows.extend(rows)
        for row in rows:
            safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", row["inspection_id"]).strip("._") or "sample"
            target = out_dir / f"{safe_id}_{row['language']}.json"
            payload = {
                key: row[key]
                for key in (
                    "inspection_id",
                    "source",
                    "language",
                    "model",
                    "llm_narrative",
                    "structured_fallback",
                    "token_usage",
                    "cost_estimate",
                    "specificity_score",
                    "issues",
                )
            }
            target.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    tally = compare_rows(all_rows)
    win_rates = add_win_rates(tally)
    recommendation, weak_dims = decide_recommendation(all_rows, tally)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "sessions": len(samples),
        "calls": len(all_rows),
        "dry_run": args.dry_run,
        "sample_sources": sorted({sample["source"] for sample in samples}),
        "uses_demo_fallback": any(sample["source"] == "demo-artifact" for sample in samples),
        "win_rate": win_rates,
        "overall_recommendation": recommendation,
        "weak_dims": weak_dims,
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_report(out_dir, summary, all_rows)
    print(f"Evaluated {len(samples)} sessions x {len(languages)} languages -> {out_dir}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
