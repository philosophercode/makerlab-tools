"use server";

import { setLocaleCookie } from "./locale";

/**
 * Set the locale cookie. Setting a cookie in a server action clears the
 * caller's client router cache, and the caller then refreshes its own router
 * (`router.refresh()`), so its Server Components re-render in the new locale.
 * Nothing shared is invalidated: a per-visitor preference must not purge the
 * site cache for everyone (security audit 2026-10-23; the gated purge is
 * `/api/admin/revalidate`).
 */
export async function changeLocale(locale: string): Promise<void> {
  await setLocaleCookie(locale);
}
