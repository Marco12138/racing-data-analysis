import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { StorySharePage } from "@/frontend/components/StorySharePage";
import {
  fetchStoryboardPayload,
  parseStoryboardResponse,
  type StoryboardResponse,
} from "@/frontend/lib/storyboardApi";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return {
    title: "AI 驾驶复盘短片",
    description: "只读 AI 驾驶复盘短片，基于真实质量门圈速与视频对齐证据。",
  };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const requestHeaders = await headers();
  const injected = requestHeaders.get("x-racing-storyboard");
  let storyboard: StoryboardResponse | null = null;
  if (injected) {
    try {
      storyboard = parseStoryboardResponse(JSON.parse(decodeURIComponent(injected)));
    } catch {
      storyboard = null;
    }
  }
  if (!storyboard) {
    const apiOrigin = productionApiOrigin();
    if (apiOrigin) {
      storyboard = await fetchStoryboardPayload(apiOrigin, "/api/v1", token);
    }
  }
  if (!storyboard) {
    notFound();
  }

  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host =
    requestHeaders.get("x-forwarded-host")
    ?? requestHeaders.get("host")
    ?? "localhost:3000";
  const shareUrl = `${proto}://${host}/story/${token}`;

  return <StorySharePage storyboard={storyboard} shareUrl={shareUrl} />;
}

function productionApiOrigin(): string {
  const configured = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  if (!configured) return "";
  try {
    const parsed = new URL(configured);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (process.env.NODE_ENV === "production" && (parsed.protocol !== "https:" || loopback)) {
      return "";
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}
