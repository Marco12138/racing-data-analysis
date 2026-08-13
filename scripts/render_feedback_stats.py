#!/usr/bin/env python3
"""Render local narrative_feedback aggregates without modifying the database."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = REPOSITORY_ROOT / "tmp/narrative_feedback"


def default_database_path() -> Path:
    """Resolve the local SQLite URL used by the MVP backend."""
    url = os.getenv("DATABASE_URL", "sqlite:///./storage/sessions.sqlite3").strip()
    prefixes = ("sqlite:////", "sqlite:///")
    if url.startswith(prefixes[0]):
        return Path("/" + url[len(prefixes[0]):]).expanduser().resolve()
    if url.startswith(prefixes[1]):
        return (REPOSITORY_ROOT / url[len(prefixes[1]):]).expanduser().resolve()
    raise ValueError("render_feedback_stats.py 目前只支持 SQLite DATABASE_URL。")


def load_feedback_rows(database: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    """Load feedback plus resolvable storyboard copy in read-only mode."""
    if not database.is_file():
        raise FileNotFoundError(f"找不到 SQLite：{database}")
    uri = f"file:{database}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "narrative_feedback" not in tables:
            raise ValueError("SQLite 中不存在 narrative_feedback 表。")
        rows = [
            dict(row)
            for row in conn.execute(
                "SELECT node_id, token, source, locale, thumbs_up, created_at "
                "FROM narrative_feedback ORDER BY id"
            ).fetchall()
        ]
        storyboard_copy: dict[str, dict[str, str]] = {}
        if "storyboards" in tables:
            for row in conn.execute("SELECT token, payload_json FROM storyboards"):
                try:
                    payload = json.loads(row["payload_json"])
                except (TypeError, json.JSONDecodeError):
                    continue
                for node in payload.get("nodes", []):
                    if not isinstance(node, dict) or not node.get("id"):
                        continue
                    storyboard_copy[f"{row['token']}:{node['id']}"] = {
                        "title": str(node.get("title") or ""),
                        "copy": " | ".join(
                            str(node.get(key) or "") for key in ("insight", "drill")
                        ).strip(" |"),
                    }
    return rows, storyboard_copy


def aggregate_feedback(
    rows: list[dict[str, Any]],
    storyboard_copy: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Aggregate by source/locale/node and identify the ten most disliked nodes."""
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    patterns: dict[str, dict[str, int]] = defaultdict(lambda: {"up": 0, "down": 0})
    for row in rows:
        key = (str(row["source"]), str(row["locale"]), str(row["node_id"]))
        item = grouped.setdefault(
            key,
            {
                "source": key[0],
                "locale": key[1],
                "node_id": key[2],
                "thumbs_up": 0,
                "thumbs_down": 0,
                "copy_excerpt": "",
            },
        )
        direction = "thumbs_up" if bool(row["thumbs_up"]) else "thumbs_down"
        item[direction] += 1
        copy = storyboard_copy.get(f"{row.get('token', '')}:{row['node_id']}")
        copy_text = ""
        if copy and not item["copy_excerpt"]:
            copy_text = " | ".join(
                value for value in (copy["title"], copy["copy"]) if value
            )
            item["copy_excerpt"] = _excerpt(copy_text)
        elif copy:
            copy_text = " | ".join(
                value for value in (copy["title"], copy["copy"]) if value
            )
        pattern = _copy_pattern(copy_text or key[2])
        patterns[pattern]["up" if bool(row["thumbs_up"]) else "down"] += 1

    aggregates = []
    for item in grouped.values():
        total = item["thumbs_up"] + item["thumbs_down"]
        item["thumbs_up_ratio"] = round(item["thumbs_up"] / max(1, total), 4)
        item["thumbs_down_ratio"] = round(item["thumbs_down"] / max(1, total), 4)
        item["total"] = total
        aggregates.append(item)
    aggregates.sort(
        key=lambda item: (item["thumbs_down"], item["thumbs_down_ratio"], item["total"]),
        reverse=True,
    )
    pattern_rows = [
        {
            "pattern": pattern,
            "thumbs_up": counts["up"],
            "thumbs_down": counts["down"],
            "thumbs_down_ratio": round(
                counts["down"] / max(1, counts["up"] + counts["down"]), 4
            ),
        }
        for pattern, counts in patterns.items()
    ]
    pattern_rows.sort(key=lambda item: (item["thumbs_down"], item["thumbs_down_ratio"]), reverse=True)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "total_feedback": len(rows),
        "aggregates": aggregates,
        "top_disliked_nodes": aggregates[:10],
        "top_disliked_patterns": pattern_rows[:10],
    }


def _excerpt(value: str, limit: int = 180) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized if len(normalized) <= limit else normalized[: limit - 1] + "…"


def _copy_pattern(value: str, limit: int = 120) -> str:
    """Normalize evidence numbers so repeated wording groups together."""
    normalized = re.sub(r"[-+]?\d+(?:\.\d+)?", "{n}", value.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return _excerpt(normalized, limit)


def write_feedback_report(result: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "feedback_stats.json"
    md_path = output_dir / "feedback_stats.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Narrative Feedback Statistics",
        "",
        f"- 生成时间：{result['generated_at']}",
        f"- 反馈总数：{result['total_feedback']}",
        "- 聚合口径：source / locale / node_id。旧数据中的 storyboard/coach source 会原样保留。",
        "",
        "## 被点踩最多的前 10 个节点",
        "",
        "| Source | Locale | Node | 👍 | 👎 | 👎 比例 | 文案摘要 |",
        "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    for item in result["top_disliked_nodes"]:
        lines.append(
            f"| {item['source']} | {item['locale']} | {item['node_id']} | "
            f"{item['thumbs_up']} | {item['thumbs_down']} | "
            f"{item['thumbs_down_ratio']:.0%} | {item['copy_excerpt'] or '不可解析/已过期'} |"
        )
    lines.extend(
        [
            "",
            "## 被点踩最多的节点模式",
            "",
            "| Node pattern | 👍 | 👎 | 👎 比例 |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for item in result["top_disliked_patterns"]:
        lines.append(
            f"| {item['pattern']} | {item['thumbs_up']} | {item['thumbs_down']} | "
            f"{item['thumbs_down_ratio']:.0%} |"
        )
    lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()
    try:
        database = (args.database or default_database_path()).expanduser().resolve()
        rows, storyboard_copy = load_feedback_rows(database)
        result = aggregate_feedback(rows, storyboard_copy)
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        output_dir = args.output_dir or (DEFAULT_OUTPUT_ROOT / timestamp)
        json_path, md_path = write_feedback_report(result, output_dir)
    except (FileNotFoundError, ValueError, sqlite3.Error) as exc:
        print(f"错误：{exc}")
        return 1
    print(f"Feedback JSON: {json_path}")
    print(f"Feedback report: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
