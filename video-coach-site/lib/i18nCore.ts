export type Locale = "zh" | "en";
export const LANGUAGE_COOKIE_NAME = "racing-ui-language";

export function localeFromAcceptLanguage(value: string | null | undefined): Locale {
  if (!value) return "zh";
  const first = value.split(",", 1)[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "zh";
}

export function localeFromRequestPreference(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined
): Locale {
  if (cookieValue === "zh" || cookieValue === "en") return cookieValue;
  return localeFromAcceptLanguage(acceptLanguage);
}
