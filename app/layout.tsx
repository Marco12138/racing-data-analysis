import type { Metadata } from "next";
import { headers } from "next/headers";
import { I18nProvider } from "@/frontend/lib/i18n";
import { localeFromAcceptLanguage } from "@/frontend/lib/i18nCore";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const title = "AI Racing Telemetry Analysis Platform";
  const description = "Analyze lap times, sector performance and racing telemetry in an interactive public demo.";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: imageUrl, width: 1733, height: 909 }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
