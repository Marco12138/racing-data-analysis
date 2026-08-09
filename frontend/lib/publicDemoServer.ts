import "server-only";

import { headers } from "next/headers";

import { parsePublicDemoSummary, type PublicDemoSummary } from "./publicDemo";

const DEMO_HEADER = "x-racing-demo-summary";

/** Load the compact public demo during server rendering without trusting browser API input. */
export async function loadServerPublicDemo(): Promise<PublicDemoSummary | null> {
  const requestHeaders = await headers();
  const injected = requestHeaders.get(DEMO_HEADER);
  if (injected) {
    try {
      return parsePublicDemoSummary(JSON.parse(decodeURIComponent(injected)));
    } catch {
      return null;
    }
  }

  const origin = productionApiOrigin();
  if (!origin) return null;
  try {
    const response = await fetch(`${origin}/api/v1/xrk/demo-session`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    return parsePublicDemoSummary(await response.json());
  } catch {
    return null;
  }
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
