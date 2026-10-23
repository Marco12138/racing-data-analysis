"use client";

import { useState } from "react";
import { Columns2, Scissors, Video } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { SiteNavigation } from "./SiteNavigation";
import { DriverVideoComparison } from "./DriverVideoComparison";
import { VideoCoachExperiment } from "./VideoCoachExperiment";
import Link from "next/link";

export function VideoAnalysisWorkspace() {
  const { locale } = useI18n(), zh = locale === "zh";
  const [tab, setTab] = useState<"comparison" | "single">("comparison");
  return <><SiteNavigation /><main className="mx-auto min-w-0 max-w-[1440px] px-4 py-8 sm:px-8">
    <header className="mb-6 border-b border-slate-800 pb-5">
      <h1 className="flex items-center gap-3 text-2xl font-semibold text-white"><Video className="shrink-0 text-cyan-300" size={24} />{zh ? "视频复盘" : "Video review"}</h1>
      <p className="mt-2 text-sm text-slate-400">{zh ? "视频仅在本浏览器处理，不上传。" : "Video stays in this browser and is never uploaded."}</p>
      <Link href="/compare" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm text-cyan-300"><Columns2 size={16} />{zh ? "双车手遥测复盘 →" : "Two-driver telemetry review →"}</Link>
      <div role="tablist" aria-label={zh ? "视频分析方式" : "Video analysis mode"} className="mt-5 flex flex-wrap gap-2">
        {(["comparison", "single"] as const).map(id => <button key={id} id={`video-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`video-panel-${id}`}
          onClick={() => setTab(id)} className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 py-2 text-sm ${tab === id ? "border-yellow-400 bg-yellow-400 text-black" : "border-slate-600 text-slate-300"}`}>
          {id === "comparison" ? <Columns2 size={18} /> : <Scissors size={18} />}{id === "comparison" ? (zh ? "双车手对照" : "Two-driver comparison") : (zh ? "单圈实验" : "Single-lap experiment")}</button>)}
      </div>
    </header>
    <div id={`video-panel-${tab}`} role="tabpanel" aria-labelledby={`video-tab-${tab}`}>
      {tab === "comparison" ? <DriverVideoComparison /> : <VideoCoachExperiment embedded />}
    </div>
  </main></>;
}
