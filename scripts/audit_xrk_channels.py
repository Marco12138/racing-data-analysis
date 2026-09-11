"""Audit private XRK files locally; never include reports in a public commit."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from backend.app.analysis.channel_audit import audit_native_channels
from backend.app.analysis.xrk_session_analysis import analyze_xrk_session
from backend.app.importers.xrk_inspection import inspect_xrk_file


def main() -> int:
    """Produce actual per-file results; no assumed counts or quality scores."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("XRK_TEST_DATA_DIR", str(Path.home()/"racing数据"))))
    parser.add_argument("--file", type=Path, default=os.getenv("XRK_TEST_FILE_PATH"))
    parser.add_argument("--output", type=Path, default=Path("tmp/xrk-channel-audit"))
    args = parser.parse_args()
    sources = [args.file.expanduser()] if args.file else sorted(
        p for p in args.data_dir.expanduser().rglob("*")
        if p.is_file() and p.suffix.lower() in {".xrk", ".xrz"} and not p.name.startswith("._")
    )
    if not sources:
        parser.error("No XRK/XRZ files found. Configure XRK_TEST_DATA_DIR or XRK_TEST_FILE_PATH.")
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    rows = []
    for source in sources:
        row = {"filename": source.name}
        try:
            with tempfile.TemporaryDirectory(prefix="xrk-channel-audit-") as temp:
                directory = Path(temp)
                manifest = inspect_xrk_file(source, directory)
                analysis = analyze_xrk_session(pd.read_parquet(directory/"telemetry.parquet"), manifest)
                row.update({"status": "sample_verified", "sha256": manifest["fingerprint"],
                            "channels": manifest["channels"], "sensor_capabilities": manifest["sensor_capabilities"],
                            "valid_laps": manifest["valid_laps"], "lap_quality": analysis["lap_quality"],
                            "fastest_lap": analysis["fastest_lap"], "native_data": manifest["native_data"],
                            "parser": manifest["parser"], "warnings": manifest["warnings"],
                            "audit": audit_native_channels(pd.read_parquet(directory/"native_channels.parquet"), manifest)})
        except Exception as exc:
            row.update(status="failed", error_type=type(exc).__name__, message=str(exc))
        rows.append(row)
        print(source.name, row["status"], flush=True)
        summary = {"scope": "private_local_audit", "hardware_bandwidth_claimed": False,
                   "independent_imu_validation": False, "files": rows}
        (output/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False)+"\n")
    lines = ["# XRK 通道可信度本地审计", "", "真实私人样本，仅本地使用。GPS 派生量的一致性不是独立 IMU 验证。", "",
             "| 文件 | 状态 | 通道数 | 参考合格圈 | 原始加速度计 | 物理陀螺仪 |", "|---|---|---:|---:|---|---|"]
    for row in rows:
        cap = row.get("sensor_capabilities", {})
        lines.append(f"| {row['filename']} | {row['status']} | {len(row.get('channels', []))} | {row.get('lap_quality', {}).get('reference_eligible_count', '-')} | {cap.get('accelerometer_present', '-')} | {cap.get('gyro_present', '-')} |")
    for row in rows:
        lines += ["", "## " + row["filename"]]
        lines += ["", "### 原生通道", "",
                  "| 通道 | 来源 | 单位 | 原生 Hz | 时间范围 s | 选用 | 时间异常 |",
                  "|---|---|---|---:|---|---|---|"]
        for channel in row.get("channels", []):
            quality = channel.get("timing_quality", {})
            anomalies = {k: quality.get(k) for k in (
                "duplicate_timestamp_count", "backward_timestamp_count", "invalid_sample_count", "long_gap_count"
            )}
            lines.append(f"| {channel['name']} | {channel['source']} | {channel['unit']} | {channel.get('native_sample_rate_hz')} | {channel.get('first_timestamp_s')} .. {channel.get('last_timestamp_s')} | {channel['selection_reason']} | {json.dumps(anomalies)} |")
        lines += ["", "### 派生关系一致性", ""]
        for key, metric in row.get("audit", {}).get("relations", {}).items():
            lines.append(f"- {key}: `{json.dumps(metric, ensure_ascii=False)}`")
        lines += ["", "### 频谱与时延", ""]
        for key, spectrum in row.get("audit", {}).get("spectra", {}).items():
            compact = {k: v for k, v in spectrum.items() if k not in {"frequency_hz", "output_psd"}}
            lines.append(f"- {key}: `{json.dumps(compact, ensure_ascii=False)}`")
        for key, delay in row.get("audit", {}).get("raw_gyro_lag_candidates", {}).items():
            lines.append(f"- {key} 探索性时延: `{json.dumps(delay, ensure_ascii=False)}`")
    lines += ["", "## 证据边界", "- 代码确认：来源隔离、原生缓存和有界重采样；样本结果逐文件列出。",
              "- 尚未验证：车体轴标定、独立圈验证、传感器硬件带宽和轮胎抓地力。",
              "- PSD 是输出信号频谱；高频能量比例表示重采样可能丢失的信息，不是硬件带宽。",
              "- 陀螺时延仅为固定原始轴的探索性相关候选，不应用旋转、符号翻转或时间修正。",
              "- 原生缓存随本次临时目录清理；源 XRK 不删除。上传 API 的固定 TTL 和原文件删除契约保持不变。"]
    (output/"report.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    return int(any(row["status"] == "failed" for row in rows))


if __name__ == "__main__":
    raise SystemExit(main())
