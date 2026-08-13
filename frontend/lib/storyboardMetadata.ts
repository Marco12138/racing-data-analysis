import type { Metadata } from "next";

import type { Locale } from "./i18nCore";
import type { StoryboardResponse } from "./storyboardApi";

export function buildStoryboardMetadata(
  storyboard: StoryboardResponse | null,
  locale: Locale,
  imageUrl: string,
  pageUrl: string,
): Metadata {
  const fastest = storyboard?.analysis.fastest_lap?.lap_time;
  const time = typeof fastest === "number" ? `${fastest.toFixed(3)}s` : null;
  const title = locale === "zh"
    ? `AI 驾驶复盘${time ? ` · 最快圈 ${time}` : ""}`
    : `AI Race Review${time ? ` · Fastest Lap ${time}` : ""}`;
  const description = locale === "zh"
    ? "基于真实有效圈的赛车遥测、教学重点与可执行练习。AI 生成，请与教练核实。"
    : "Real-lap telemetry evidence, coaching priorities and testable drills. AI-generated; validate with a coach.";
  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      type: "article",
      url: pageUrl,
      images: [{ url: imageUrl, width: 1731, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
