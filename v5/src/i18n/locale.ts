"use server";

import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALE_COOKIE,
  isSupportedLocale,
} from "./config";

/**
 * Resolve the active locale for the current request.
 *
 * Priority:
 *   1. `NEXT_LOCALE` cookie (explicit user choice)
 *   2. `Accept-Language` header (first-visit detection)
 *   3. Default (`en`)
 */
export async function resolveLocale(): Promise<string> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  const headerStore = await headers();
  const accept = headerStore.get("accept-language");
  const detected = detectFromAcceptLanguage(accept);
  if (detected) return detected;

  return DEFAULT_LOCALE;
}

/**
 * Match an `Accept-Language` header against supported locales.
 * Tries exact matches first (e.g. `zh-CN`), then the base language
 * (e.g. `zh` -> `zh-CN`, `pt` -> `pt-BR`).
 */
function detectFromAcceptLanguage(accept: string | null): string | null {
  if (!accept) return null;

  const requested = accept
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim(), q: q ? parseFloat(q) : 1 };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of requested) {
    // Exact match (case-insensitive).
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;

    // Base-language match: `zh` -> `zh-CN`, `pt` -> `pt-BR`, `en-US` -> `en`.
    const base = tag.split("-")[0].toLowerCase();
    const byBase = LOCALE_CODES.find((c) => c.split("-")[0].toLowerCase() === base);
    if (byBase) return byBase;
  }

  return null;
}

/** Persist the user's locale choice in a cookie (called from a Server Action). */
export async function setLocaleCookie(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
}
