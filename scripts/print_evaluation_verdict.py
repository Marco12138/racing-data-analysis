#!/usr/bin/env python3
"""Print a human-readable verdict for the latest narrative evaluation.

Finds the newest tmp/narrative_eval/*/summary.json (or --path), prints the
per-dimension win table, the top issues, and the final recommendation.
Exit code: 0 = recommend enabling the LLM, 1 = keep structured/keep tuning.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
EVAL_ROOT = REPOSITORY_ROOT / "tmp/narrative_eval"

CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
RESET = "\033[0m"


def latest_summary(path: Path | None) -> tuple[Path, Path]:
    if path is not None:
        target = Path(path).expanduser().resolve()
        if not target.is_file():
            raise SystemExit(f"找不到 summary.json：{target}")
        return target, target.parent
    candidates = sorted(EVAL_ROOT.glob("*/summary.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(
            "tmp/narrative_eval/ 下没有 summary.json。"
            "请先运行 scripts/evaluate_narrative.py。"
        )
    return candidates[0], candidates[0].parent


def collect_issues(directory: Path, limit: int = 5) -> list[str]:
    issues: list[str] = []
    for path in sorted(directory.glob("*_*.json")):
        if path.name == "summary.json":
            continue
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for issue in row.get("issues", []):
            if issue not in issues:
                issues.append(issue)
        if len(issues) >= limit:
            break
    return issues[:limit]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, default=None)
    args = parser.parse_args()
    summary_path, directory = latest_summary(args.path)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    recommendation = summary.get("overall_recommendation", "KEEP_STRUCTURED")

    print(f"{CYAN}=== LLM 叙事评估 Verdict ==={RESET}")
    print(f"评估目录：{directory}")
    print(f"生成时间：{summary.get('generated_at')}")
    print(f"样本数：{summary.get('sessions')}；调用数：{summary.get('calls')}")
    if summary.get("dry_run"):
        print(f"{YELLOW}本次为 dry-run，未调用 LLM。{RESET}")
    print()
    print(f"{CYAN}各维度胜率（LLM vs 结构化）{RESET}")
    print(f"{'维度':<22}{'LLM 胜':>8}{'结构化胜':>10}{'平局':>8}{'LLM 胜率':>12}")
    print("-" * 62)
    for dim, counts in summary.get("win_rate", {}).items():
        total = counts.get("total") or sum(
            counts.get(key, 0) for key in ("llm_win", "structured_win", "tie")
        )
        rate = counts.get("llm_win_rate")
        if rate is None:
            rate = counts.get("llm_win", 0) / max(1, total)
        print(
            f"{dim:<22}{counts['llm_win']:>8}{counts['structured_win']:>10}"
            f"{counts['tie']:>8}{rate:>11.0%}"
        )

    sources = summary.get("sample_sources", [])
    if sources:
        print(f"数据来源：{', '.join(sources)}")
    if summary.get("uses_demo_fallback"):
        print(f"{YELLOW}本次包含 demo 工件，只能作为流程冒烟，不能单独支持生产启用。{RESET}")

    issues = collect_issues(directory)
    if issues:
        print()
        print(f"{YELLOW}关键 issue（前 {len(issues)} 条）{RESET}")
        for issue in issues:
            print(f"  - {issue}")

    weak_dims = summary.get("weak_dims", [])
    print()
    if recommendation == "ENABLE_LLM":
        print(f"{GREEN}最终建议：启用 LLM 叙事（5 个维度全面优于结构化基线）。{RESET}")
        return 0
    print(f"{RED}最终建议：KEEP_STRUCTURED —— 继续调 prompt 后再评估。{RESET}")
    if weak_dims:
        print(f"{YELLOW}待改进维度：{', '.join(weak_dims)}{RESET}")
    print("请人工阅读 report.md；如需继续调优，可将去敏后的报告交给开发者。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
