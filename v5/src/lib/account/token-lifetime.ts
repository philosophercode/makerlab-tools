/**
 * How long a personal access token lives: **90 days — one semester — for
 * every token** (MCP access spec amendment 2026-09-25, "One lifetime"). There
 * is no choice, no 30 days and no "never", so a forgotten laptop's token dies
 * with the term.
 *
 * Pure and client-safe: the data module stamps `expires_at` with it and the
 * token page says the date as text before anything is created.
 */
export const TOKEN_LIFETIME_DAYS = 90;

/** When a token made at `now` expires: {@link TOKEN_LIFETIME_DAYS} later. */
export function tokenExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60_000);
}
