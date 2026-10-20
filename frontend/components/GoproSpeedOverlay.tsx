"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { acquireGoproSpeed, goproSpeedAt, type SpeedReading } from "../lib/goproVideoSpeed";
import type { GoproSpeedPoint } from "../lib/gpmfTelemetry";

type Status = SpeedReading["reason"] | "loading" | "unsupported" | "failed";
const LABELS: Record<Status, [string, string]> = {
  available: ["", ""], loading: ["读取 GPS", "Reading GPS"], no_gps: ["无 GoPro GPS", "No GoPro GPS"],
  outside_coverage: ["超出 GPS 范围", "Outside GPS range"], gps_invalid: ["GPS 信号无效", "Invalid GPS fix"],
  gap: ["GPS 数据断档", "GPS data gap"], unsupported: ["不支持此元数据", "Unsupported metadata"], failed: ["GPS 读取失败", "GPS read failed"],
};

/** Presentation is separate from extraction so missing/invalid readings are testable without a real file. */
export function GoproSpeedDisplay({ reading, status, progress = 0, time }: { reading: SpeedReading; status: Status; progress?: number; time: number }) {
  const { locale } = useI18n(), zh = locale === "zh";
  const label = LABELS[status][zh ? 0 : 1];
  return <output className="pointer-events-auto absolute right-2 top-2 w-36 max-w-[calc(100%-1rem)] rounded bg-black/85 px-3 py-2 text-right text-white shadow"
    data-testid="gopro-speed-overlay" data-status={status} data-video-time={time} data-speed-kmh={reading.speed_kmh ?? ""}
    aria-label={zh ? "本视频 GoPro GPS 速度" : "This video's GoPro GPS speed"} aria-live="off" tabIndex={0}
    title={zh ? "本机读取 GPS5 二维速度，按视频帧时刻插值（不跨 0.25 秒缺口）。包内时间为估计值，传感器到画面的延迟未标定；不是 AiM 速度，也不证明走线更优。原生全屏可能不显示叠层。"
      : "Local GPS5 2D speed, interpolated at video frame time (no gaps over 0.25s). Within-payload timing is estimated; sensor-to-frame latency is uncalibrated. Not AiM speed or proof of a better line. Native fullscreen may hide the overlay."}>
    <span className="block text-[10px] font-medium text-cyan-200">GoPro GPS</span>
    {status === "available" && reading.speed_kmh !== null
      ? <span className="block whitespace-nowrap font-mono text-2xl font-semibold tabular-nums">{reading.speed_kmh.toFixed(1)} <span className="text-xs font-normal text-slate-300">km/h</span></span>
      : <><span className="block font-mono text-2xl text-slate-400">— <span className="text-xs">km/h</span></span><span className="block text-[10px] text-amber-200">{label}{status === "loading" ? ` ${Math.round(progress * 100)}%` : ""}</span></>}
  </output>;
}

/** Metadata stays in memory, follows the presented video frame, and never adjusts manual anchors. */
export function GoproSpeedOverlay({ file, time }: { file: File | null; time: number }) {
  const [state, setState] = useState<{ file: File; points: GoproSpeedPoint[]; status: Status; progress: number } | null>(null);
  useEffect(() => {
    if (!file) return;
    let active = true;
    const handle = acquireGoproSpeed(file, progress => queueMicrotask(() => {
      if (active) setState({ file, points: [], status: "loading", progress });
    }));
    void handle.promise.then(points => {
      if (active) setState({ file, points, status: points.length ? "available" : "no_gps", progress: 1 });
    }).catch(error => {
      if (!active) return;
      const code = error instanceof Error ? error.message : "";
      const status = code === "GPMF_TRACK_UNAVAILABLE" ? "no_gps" : /UNSUPPORTED|LIMIT|INVALID_TIMING/.test(code) ? "unsupported" : "failed";
      setState({ file, points: [], status, progress: 1 });
    });
    return () => { active = false; handle.release(); };
  }, [file]);
  const current = state?.file === file ? state : null;
  const reading = goproSpeedAt(current?.points ?? [], time);
  const status = !file ? "no_gps" : !current ? "loading" : current.status === "available" ? reading.reason : current.status;
  return <GoproSpeedDisplay reading={reading} status={status} progress={current?.progress} time={time} />;
}
