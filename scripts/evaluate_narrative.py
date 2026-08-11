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

DEMO_ARTIFACT = REPOSITORY_ROOT / "public/demo/reviewed-real-session.json"
SAMPLES_DIR = REPOSITORY_ROOT / "tmp/narrative_eval/samples"
FORBIDDEN_SAFETY = ("理论圈", "合成圈", "synthetic target lap", "synthetic rpm")


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
    lowered = text.lower()
    return not any(word in lowered for word in FORBIDDEN_SAFETY)


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
) -> list[dict[str, Any]]:
    analysis = session["analysis"]
    evidence = build_xrk_narrative_evidence(analysis)
    rows: list[dict[str, Any]] = []
    for language in languages:
        llm_text = await generate_llm_narrative(evidence, language=language)
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
        rows.append(
            {
                "inspection_id": session["inspection_id"],
                "source": session["source"],
                "language": language,
                "model": _llm_config()[2] if _llm_config() is not None else None,
                "llm_narrative": llm_text,
                "structured_fallback": structured_text,
                "specificity_score": {"llm": llm_eval["specificity_score"], "structured": structured_eval["specificity_score"]},
                "issues": issues,
                "dims": {"llm": llm_eval, "structured": structured_eval},
            }
        )
    return rows


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--languages", default="zh,en")
    args = parser.parse_args()
    languages = [item.strip() for item in args.languages.split(",") if item.strip() in {"zh", "en"}]
    if not languages:
        print("--languages must contain zh and/or en", file=sys.stderr)
        return 2

    samples = load_samples(max(1, min(args.limit, 10)))
    if not samples:
        print("No analysis samples available for evaluation.", file=sys.stderr)
        return 1

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out_dir = REPOSITORY_ROOT / "tmp/narrative_eval" / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict[str, Any]] = []
    for session in samples:
        rows = asyncio.run(evaluate_session(session, languages))
        all_rows.extend(rows)
        for row in rows:
            target = out_dir / f"{row['inspection_id']}_{row['language']}.json"
            payload = {
                key: row[key]
                for key in (
                    "inspection_id",
                    "source",
                    "language",
                    "model",
                    "llm_narrative",
                    "structured_fallback",
                    "specificity_score",
                    "issues",
                )
            }
            target.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "sessions": len(samples),
        "calls": len(all_rows),
        "win_rate": compare_rows(all_rows),
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Evaluated {len(samples)} sessions x {len(languages)} languages -> {out_dir}")
    print(json.dumps(summary["win_rate"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
