"use client";

import { memo, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { GnssGeometryCheck } from "../lib/xrkAnalysisApi";

/** GPS display only: common metric frame, no gaps joined and no driving inference. */
export const GoproGpsOverlay = memo(function GoproGpsOverlay({ check }: { check: GnssGeometryCheck }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [registered, setRegistered] = useState(true);
  const [validationOnly, setValidationOnly] = useState(true);
  const rows = (check.overlay ?? []).filter(r => !validationOnly || r.role === "validation");
  const all = (check.overlay ?? []).flatMap(r => [r.aim_xy_m, r.camera_raw_xy_m, r.camera_registered_xy_m]);
  if (!all.length) return null;
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(600 / Math.max(1, maxX-minX), 340 / Math.max(1, maxY-minY));
  const x = (v: number) => 320 + (v-(minX+maxX)/2)*scale;
  const y = (v: number) => 190 - (v-(minY+maxY)/2)*scale;
  return <div className="mt-3 border-t border-slate-700 pt-3">
    <div className="flex flex-wrap gap-3 text-xs">
      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={registered} onChange={e => setRegistered(e.target.checked)} />{zh ? "平移配准" : "Registered translation"}</label>
      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={validationOnly} onChange={e => setValidationOnly(e.target.checked)} />{zh ? "仅留出验证" : "Held-out only"}</label>
    </div>
    <svg viewBox="0 0 640 380" className="aspect-[32/19] w-full bg-slate-950" role="img" aria-label={zh ? "AiM 与 GoPro GPS 核对" : "AiM and GoPro GPS cross-check"}>
      {rows.map((r, i) => {
        const camera = registered ? r.camera_registered_xy_m : r.camera_raw_xy_m;
        return <g key={i}><title>{`${r.session_time_s.toFixed(2)} s · ${r.role} · Δ ${Math.hypot(camera[0]-r.aim_xy_m[0], camera[1]-r.aim_xy_m[1]).toFixed(2)} m`}</title>
          <circle cx={x(r.aim_xy_m[0])} cy={y(r.aim_xy_m[1])} r={2} fill="#35d6d0" />
          <circle cx={x(camera[0])} cy={y(camera[1])} r={2} fill="#fb923c" />
        </g>;
      })}
    </svg>
    <div className="mt-1 flex gap-4 text-xs"><span className="text-[#35d6d0]">AiM GPS</span><span className="text-orange-300">GoPro GPS</span></div>
    <p className="mt-2 text-xs leading-5 text-slate-400">{zh ? "拟合后冻结平移，再检查留出数据。两路 GNSS 的一致性不是独立的画面同步真值。" : "Translation is frozen before held-out checks. GNSS agreement is not independent visual synchronization ground truth."}</p>
  </div>;
});
