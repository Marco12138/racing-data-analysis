import { NextRequest, NextResponse } from "next/server";

/** Resolve the API through the current Vercel origin to avoid client-side cross-origin uploads. */
export function GET(request: NextRequest) {
  const deploymentMode =
    process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "public-demo";
  const configuredApiOrigin = (
    process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ""
  ).replace(/\/+$/, "");
  const apiOrigin =
    deploymentMode === "local" && configuredApiOrigin
      ? configuredApiOrigin
      : request.nextUrl.origin;
  const apiPrefix = process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1";

  return NextResponse.json(
    {
      apiOrigin,
      apiPrefix,
      xrkUploadUrl:
        process.env.XRK_UPLOAD_URL
        ?? (deploymentMode === "local"
          ? `${apiOrigin}${apiPrefix}/xrk/inspect`
          : "https://racing-ai-platform-api-production.up.railway.app/api/v1/xrk/inspect"),
      deploymentMode,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
