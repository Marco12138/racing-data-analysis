"""Tests for the human-decision narrative evaluation artifacts."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts"))

evaluate = importlib.import_module("evaluate_narrative")
verdict = importlib.import_module("print_evaluation_verdict")


def test_evaluation_aborts_when_connectivity_probe_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        evaluate,
        "verify_from_env",
        lambda: SimpleNamespace(
            ok=False,
            message="HTTP 401",
            warnings=[],
            model="model-a",
            latency_ms=10,
        ),
    )
    monkeypatch.setattr(
        evaluate,
        "load_samples",
        lambda _limit: pytest.fail("samples must not load before verification succeeds"),
    )
    monkeypatch.setattr(sys, "argv", ["evaluate_narrative.py"])
    assert evaluate.main() == 1


def test_add_win_rates_keeps_counts_and_adds_percentages() -> None:
    result = evaluate.add_win_rates(
        {"accurate": {"llm_win": 2, "structured_win": 1, "tie": 1}}
    )
    assert result["accurate"] == {
        "llm_win": 2,
        "structured_win": 1,
        "tie": 1,
        "total": 4,
        "llm_win_rate": 0.5,
        "structured_win_rate": 0.25,
        "tie_rate": 0.25,
    }


def test_safety_check_allows_prohibition_but_rejects_synthetic_claim() -> None:
    assert evaluate.is_safe("本报告不生成理论圈或合成圈。") is True
    assert evaluate.is_safe("No synthetic target lap is generated.") is True
    assert evaluate.is_safe("建议使用合成圈作为训练目标。") is False


def test_recommendation_requires_real_complete_safe_outputs() -> None:
    llm_dimensions = {
        "specificity_score": 9,
        "accurate": True,
        "language_ok": True,
        "executable": True,
        "safe": True,
    }
    structured_dimensions = {
        "specificity_score": 6,
        "accurate": False,
        "language_ok": False,
        "executable": False,
        "safe": False,
    }
    rows = [
        {
            "source": "user-sample",
            "llm_narrative": "grounded narrative",
            "dims": {
                "llm": llm_dimensions,
                "structured": structured_dimensions,
            },
        }
    ]
    tally = evaluate.compare_rows(rows)
    assert evaluate.decide_recommendation(rows, tally) == ("ENABLE_LLM", [])

    rows[0]["source"] = "demo-artifact"
    recommendation, reasons = evaluate.decide_recommendation(rows, tally)
    assert recommendation == "KEEP_STRUCTURED"
    assert "demo" in reasons[0]


def test_recommendation_keeps_structured_when_any_dimension_ties() -> None:
    dimensions = {
        "specificity_score": 9,
        "accurate": True,
        "language_ok": True,
        "executable": True,
        "safe": True,
    }
    rows = [
        {
            "source": "user-sample",
            "llm_narrative": "grounded narrative",
            "dims": {
                "llm": dimensions,
                "structured": {**dimensions, "specificity_score": 6},
            },
        }
    ]
    recommendation, weak_dims = evaluate.decide_recommendation(
        rows, evaluate.compare_rows(rows)
    )
    assert recommendation == "KEEP_STRUCTURED"
    assert "accurate" in weak_dims


def test_report_contains_bilingual_review_text_and_demo_warning(tmp_path: Path) -> None:
    summary = {
        "generated_at": "2026-08-13T00:00:00+00:00",
        "sessions": 1,
        "calls": 2,
        "sample_sources": ["demo-artifact"],
        "overall_recommendation": "KEEP_STRUCTURED",
        "weak_dims": ["accurate"],
        "win_rate": evaluate.add_win_rates(
            {"accurate": {"llm_win": 0, "structured_win": 0, "tie": 2}}
        ),
    }
    rows = [
        {
            "inspection_id": "demo",
            "source": "demo-artifact",
            "language": language,
            "model": "model-a",
            "specificity_score": {"llm": 8, "structured": 6},
            "issues": [],
            "llm_narrative": narrative,
            "structured_fallback": baseline,
        }
        for language, narrative, baseline in (
            ("zh", "中文教练叙事", "中文结构化基线"),
            ("en", "English coaching narrative", "English structured baseline"),
        )
    ]
    evaluate.write_report(tmp_path, summary, rows)
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "中文教练叙事" in report
    assert "English coaching narrative" in report
    assert "demo-artifact" in report
    assert "只能作为流程冒烟" in report


@pytest.mark.parametrize(
    ("recommendation", "exit_code"),
    [("ENABLE_LLM", 0), ("KEEP_STRUCTURED", 1)],
)
def test_verdict_exit_code_matches_recommendation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    recommendation: str,
    exit_code: int,
) -> None:
    summary_path = tmp_path / "summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "generated_at": "2026-08-13T00:00:00+00:00",
                "sessions": 1,
                "calls": 2,
                "dry_run": False,
                "sample_sources": ["user-sample"],
                "uses_demo_fallback": False,
                "overall_recommendation": recommendation,
                "weak_dims": [],
                "win_rate": evaluate.add_win_rates(
                    {"accurate": {"llm_win": 2, "structured_win": 0, "tie": 0}}
                ),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "argv", ["print_evaluation_verdict.py", "--path", str(summary_path)])
    assert verdict.main() == exit_code
