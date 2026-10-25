"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../lib/i18n";

export function ReviewAudioControl({ value, onChange, labels = ["A", "B"] }: {
  value: number | null; onChange: (value: number | null) => void; labels?: string[];
}) {
  const { locale } = useI18n(), zh = locale === "zh";
  return <fieldset className="flex flex-wrap items-center gap-2 text-sm">
    <legend className="sr-only">{zh ? "回放声音" : "Playback audio"}</legend>
    {[0, 1, null].map(i => <button key={i ?? "off"} type="button" aria-pressed={value === i}
      className={`inline-flex min-h-10 items-center gap-2 rounded border px-3 ${value === i ? "border-cyan-400 text-cyan-200" : "border-slate-600"}`}
      onClick={() => onChange(i)}>{i === null ? <VolumeX size={16} /> : <Volume2 size={16} />}
      {i === null ? (zh ? "静音" : "Mute") : `${labels[i]} ${zh ? "声音" : "audio"}`}</button>)}
  </fieldset>;
}
