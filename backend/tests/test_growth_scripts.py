"""Tests for narrative evaluation and feedback reporting scripts."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from scripts.analyze_eval_report import (
    analyze_evaluation_directory,
    classify_row,
)
from scripts.render_feedback_stats import (
    aggregate_feedback,
    load_feedback_rows,
    write_feedback_report,
)


def test_evaluation_analysis_classifies_common_prompt_issues(tmp_path: Path) -> None:
    summary = {
        "overall_recommendation": "KEEP_STRUCTURED",
        "sample_sources": ["real-analysis"],
    }
    (tmp_path / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False),
        encoding="utf-8",
    )
    sample = {
        "inspection_id": "sample-1",
        "language": "zh",
        "llm_narrative": "注意 improve overall driving 表现，建议多练习。",
        "issues": ["llm 出现证据之外的数字"],
    }
    (tmp_path / "sample-1_zh.json").write_text(
        json.dumps(sample, ensure_ascii=False),
        encoding="utf-8",
    )

    assert classify_row(sample) == {
        "missing_corner_anchor",
        "vague_drill",
        "mixed_language",
        "ungrounded_number",
        "forbidden_word",
    }
    report_path = analyze_evaluation_directory(tmp_path)
    report = report_path.read_text(encoding="utf-8")
    assert "Prompt Refinement Report" in report
    assert "缺少弯角编号或距离锚点 | 1" in report
    assert "数字与结构化证据不符 | 1" in report
    assert "只读取摘要和叙事文案" in report


def test_feedback_stats_aggregate_source_locale_node_and_copy(tmp_path: Path) -> None:
    database = tmp_path / "sessions.sqlite3"
    with sqlite3.connect(database) as conn:
        conn.execute(
            "CREATE TABLE narrative_feedback ("
            "id INTEGER PRIMARY KEY, node_id TEXT, token TEXT, source TEXT, "
            "locale TEXT, thumbs_up INTEGER, created_at TEXT)"
        )
        conn.execute(
            "CREATE TABLE storyboards (token TEXT, payload_json TEXT)"
        )
        payload = {
            "nodes": [
                {
                    "id": "corner-4",
                    "title": "第 4 弯",
                    "insight": "净收益来自真实圈。",
                    "drill": "练习并设置停止条件。",
                }
            ]
        }
        conn.execute(
            "INSERT INTO storyboards VALUES (?, ?)",
            ("story-token", json.dumps(payload, ensure_ascii=False)),
        )
        conn.executemany(
            "INSERT INTO narrative_feedback "
            "(node_id, token, source, locale, thumbs_up, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("corner-4", "story-token", "llm", "zh", 0, "2026-08-13"),
                ("corner-4", "story-token", "llm", "zh", 0, "2026-08-13"),
                ("corner-4", "story-token", "llm", "zh", 1, "2026-08-13"),
                ("corner-7", "", "structured", "en", 1, "2026-08-13"),
            ],
        )

    rows, copy = load_feedback_rows(database)
    result = aggregate_feedback(rows, copy)
    disliked = result["top_disliked_nodes"][0]
    assert result["total_feedback"] == 4
    assert disliked["source"] == "llm"
    assert disliked["locale"] == "zh"
    assert disliked["node_id"] == "corner-4"
    assert disliked["thumbs_down"] == 2
    assert disliked["thumbs_down_ratio"] == 0.6667
    assert "净收益来自真实圈" in disliked["copy_excerpt"]
    assert "第 {n} 弯" in result["top_disliked_patterns"][0]["pattern"]
    assert "净收益来自真实圈" in result["top_disliked_patterns"][0]["pattern"]

    json_path, markdown_path = write_feedback_report(result, tmp_path / "report")
    assert json.loads(json_path.read_text(encoding="utf-8"))["total_feedback"] == 4
    assert "被点踩最多的前 10 个节点" in markdown_path.read_text(encoding="utf-8")
