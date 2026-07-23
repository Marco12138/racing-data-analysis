#!/usr/bin/env python3
"""Convert one AiM XRK/XRZ log into local platform CSV files."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.importers.xrk import XrkImportError, convert_xrk_file


def safe_output_name(stem: str) -> str:
    """Create a readable directory name without path control characters."""
    normalized = re.sub(r"[^\w.-]+", "_", stem, flags=re.UNICODE).strip("._")
    return normalized or "xrk_session"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="将 AiM XRK/XRZ 日志转换为赛车分析平台 CSV。"
    )
    parser.add_argument("source", type=Path, help="原始 .xrk 或 .xrz 文件")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="输出目录；默认位于 storage/xrk_imports/<文件名>",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir or (
        PROJECT_ROOT / "storage" / "xrk_imports" / safe_output_name(args.source.stem)
    )
    try:
        report = convert_xrk_file(args.source, output_dir)
    except XrkImportError as exc:
        print(f"XRK 转换失败：{exc}", file=sys.stderr)
        return 1

    outputs = report["outputs"]
    selection = report["lap_selection"]
    print("XRK 转换完成")
    print(f"有效圈：{selection['valid_laps']}")
    print(
        "虚拟分段边界："
        f"{report['virtual_sectors']['boundaries_m']} 米（等距派生，非官方分段）"
    )
    print(f"圈速 CSV：{outputs['laps_csv']}")
    print(f"遥测 CSV：{outputs['telemetry_csv']}")
    print(f"提取报告：{outputs['extraction_report']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

