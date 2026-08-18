import { NextRequest, NextResponse } from "next/server";

/** Resolve the API through the current Vercel origin to avoid client-side cross-origin uploads. */
export function GET(request: NextRequest) {
  return NextResponse.json(
    {
      apiOrigin: request.nextUrl.origin,
      apiPrefix: process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1",
      deploymentMode: process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "public-demo",
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
