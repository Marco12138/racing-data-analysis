import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { I18nProvider } from "../lib/i18n";
import { LANGUAGE_COOKIE_NAME, localeFromRequestPreference } from "../lib/i18nCore";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI 视频教练",
  description: "上传车载视频，浏览器本地听声自动标注弯道并手工打点，数据不上传服务器。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = localeFromRequestPreference(
    cookieStore.get(LANGUAGE_COOKIE_NAME)?.value,
    requestHeaders.get("accept-language")
  );
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
