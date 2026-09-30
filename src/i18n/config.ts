// Locale configuration shared across server + client.
// Cookie-based locale (no URL-prefix routing), so existing routes stay clean.

export const LOCALE_COOKIE = "NEXT_LOCALE";

export interface LocaleOption {
  /** BCP-47 code used as the cookie value and `<html lang>`. */
  code: string;
  /** Endonym shown in the language selector. */
  label: string;
  /** English name of the language — used to instruct the AI chat. */
  englishName: string;
  /** Text direction for `<html dir>`. */
  dir: "ltr" | "rtl";
}

// 12 languages common at Cornell Tech. Order = selector order.
export const LOCALES: LocaleOption[] = [
  { code: "en", label: "English", englishName: "English", dir: "ltr" },
  { code: "zh-CN", label: "中文（简体）", englishName: "Simplified Chinese", dir: "ltr" },
  { code: "es", label: "Español", englishName: "Spanish", dir: "ltr" },
  { code: "hi", label: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  { code: "ko", label: "한국어", englishName: "Korean", dir: "ltr" },
  { code: "ar", label: "العربية", englishName: "Arabic", dir: "rtl" },
  { code: "fr", label: "Français", englishName: "French", dir: "ltr" },
  { code: "pt-BR", label: "Português (Brasil)", englishName: "Brazilian Portuguese", dir: "ltr" },
  { code: "ru", label: "Русский", englishName: "Russian", dir: "ltr" },
  { code: "tr", label: "Türkçe", englishName: "Turkish", dir: "ltr" },
  { code: "ja", label: "日本語", englishName: "Japanese", dir: "ltr" },
  { code: "he", label: "עברית", englishName: "Hebrew", dir: "rtl" },
];

export const DEFAULT_LOCALE = "en";

export const LOCALE_CODES = LOCALES.map((l) => l.code);

export function isSupportedLocale(value: string | undefined | null): value is string {
  return !!value && LOCALE_CODES.includes(value);
}

export function getLocaleOption(code: string): LocaleOption {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export function getDirection(code: string): "ltr" | "rtl" {
  return getLocaleOption(code).dir;
}

/** Map a locale code to the English language name for AI prompts. */
export function languageNameForLocale(code: string): string {
  return getLocaleOption(code).englishName;
}
