"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Clapperboard, Gauge, Info, Languages, Play } from "lucide-react";
import { useI18n } from "../lib/i18n";

const destinations = [
  { href: "/workspace", zh: "遥测分析", en: "Telemetry", icon: Activity },
  { href: "/video-coach", zh: "视频分析", en: "Video", icon: Clapperboard },
  { href: "/methods", zh: "模型介绍", en: "Methods", icon: BookOpen },
  { href: "/about", zh: "项目介绍", en: "About", icon: Info },
];

export function SiteNavigation({ onLocaleChange }: { onLocaleChange?: (locale: "zh" | "en") => void }) {
  const { locale, setLocale } = useI18n();
  const pathname = usePathname();
  return <header className="site-header">
    <div className="site-header__inner">
      <Link href="/" className="site-brand" aria-label="Racing Data Lab · 首页 Home"><Gauge size={21} /><span>RACING DATA LAB</span></Link>
      <nav className="site-navigation" aria-label="功能导航 / Main navigation">
        {destinations.map(({ href, zh, en, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
          <Icon size={17} aria-hidden="true" /><span>{zh}<small>{en}</small></span>
        </Link>)}
      </nav>
      <div className="site-header__actions">
        <Link href="/demo" className="site-demo-link"><Play size={15} />{locale === "zh" ? "样例" : "Demo"}</Link>
        <div className="language-switch" aria-label="语言 / Language"><Languages size={15} aria-hidden="true" />
          <button type="button" aria-pressed={locale === "zh"} className={locale === "zh" ? "is-active" : ""} onClick={() => (onLocaleChange ?? setLocale)("zh")}>中</button>
          <button type="button" aria-pressed={locale === "en"} className={locale === "en" ? "is-active" : ""} onClick={() => (onLocaleChange ?? setLocale)("en")}>EN</button>
        </div>
      </div>
    </div>
  </header>;
}
