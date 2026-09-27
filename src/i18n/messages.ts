/**
 * Locale messages with English underneath (constitution Article 6, as amended
 * 2026-09-14): a string is added to `messages/en.json` in the PR that needs
 * it, and the other locale files catch up in a translation pass. Until then a
 * key missing from a locale file renders in English rather than as a raw key
 * or a runtime error.
 */

export type Messages = { [key: string]: string | Messages };

/**
 * `locale` laid over `english`, namespace by namespace: every English key is
 * present in the result, and a key the locale file does define wins.
 */
export function withEnglishFallback(english: Messages, locale: Messages): Messages {
  const merged: Messages = { ...english };
  for (const [key, value] of Object.entries(locale)) {
    const base = english[key];
    merged[key] =
      isNamespace(value) && isNamespace(base) ? withEnglishFallback(base, value) : value;
  }
  return merged;
}

function isNamespace(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
