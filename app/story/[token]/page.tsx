import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { StorySharePage } from "@/frontend/components/StorySharePage";
import {
  fetchStoryboardPayload,
  parseStoryboardResponse,
  type StoryboardResponse,
} from "@/frontend/lib/storyboardApi";
import { buildStoryboardMetadata } from "@/frontend/lib/storyboardMetadata";
import { localeFromRequestPreference } from "@/frontend/lib/i18nCore";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const requestHeaders = await headers();
  const storyboard = await loadStoryboard(token, requestHeaders.get("x-racing-storyboard"));
  const origin = requestOrigin(requestHeaders);
  const locale = localeFromRequestPreference(null, requestHeaders.get("accept-language"));
  return buildStoryboardMetadata(
    storyboard,
    locale,
    `${origin}/og.png`,
    `${origin}/story/${token}`,
  );
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const requestHeaders = await headers();
  const storyboard = await loadStoryboard(
    token,
    requestHeaders.get("x-racing-storyboard"),
  );
  if (!storyboard) notFound();

  const shareUrl = `${requestOrigin(requestHeaders)}/story/${token}`;

  return <StorySharePage storyboard={storyboard} shareUrl={shareUrl} />;
}

async function loadStoryboard(
  token: string,
  injected: string | null,
): Promise<StoryboardResponse | null> {
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
  return storyboard;
}

function requestOrigin(requestHeaders: Awaited<ReturnType<typeof headers>>): string {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
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
