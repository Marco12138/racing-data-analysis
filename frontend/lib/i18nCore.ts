export type Locale = "zh" | "en";

export function localeFromAcceptLanguage(value: string | null | undefined): Locale {
  if (!value) return "zh";
  const first = value.split(",", 1)[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "zh";
}
