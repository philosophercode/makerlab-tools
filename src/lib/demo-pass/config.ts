/**
 * The demo pass's settings (demo pass spec 2026-10-07), read from the
 * environment at call time so a test can `vi.stubEnv` and a redeploy with a
 * new value needs nothing else.
 *
 * - `DEMO_PASS` — `off` closes sign-ups, hides the buttons and makes every pass
 *   an ordinary anonymous visitor. Anything else (or unset) leaves it on.
 * - `DEMO_PASS_BUDGET_USD` — what one pass may spend on AI, in dollars.
 *   Default `0.50`. Read on every turn, so a change reaches every pass at once.
 * - `DEMO_PASS_CONTACT_EMAIL` — the address the chat's thank-you offers. Unset,
 *   it points to the About page's lab contacts instead.
 *
 * No `server-only`: pages and routes import it, and nothing here is secret.
 */

/** How long a pass lasts from sign-up. */
export const DEMO_PASS_DAYS = 14;

/** The budget when `DEMO_PASS_BUDGET_USD` is unset or unusable. */
export const DEFAULT_DEMO_PASS_BUDGET_USD = 0.5;

/** The most a budget may be set to — a typo of `50` for `0.50` must not cost fifty dollars a visitor. */
const MAX_DEMO_PASS_BUDGET_USD = 20;

/** False only when `DEMO_PASS` is `off` (or `0` / `false`). */
export function demoPassEnabled(): boolean {
  const raw = (process.env.DEMO_PASS ?? "").trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false");
}

/**
 * Dollars one pass may spend. A value that is not a positive number, or is
 * above {@link MAX_DEMO_PASS_BUDGET_USD}, falls back to the default and says so
 * in the log, rather than giving every visitor an unbounded or zero pass.
 */
export function demoPassBudgetUsd(): number {
  const raw = (process.env.DEMO_PASS_BUDGET_USD ?? "").trim();
  if (!raw) return DEFAULT_DEMO_PASS_BUDGET_USD;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0 && value <= MAX_DEMO_PASS_BUDGET_USD) return value;
  console.warn(`[demo-pass] DEMO_PASS_BUDGET_USD is not a dollar amount between 0 and ${MAX_DEMO_PASS_BUDGET_USD}; using ${DEFAULT_DEMO_PASS_BUDGET_USD}`);
  return DEFAULT_DEMO_PASS_BUDGET_USD;
}

/** The contact address the thank-you shows, or null for "see the About page". */
export function demoPassContactEmail(): string | null {
  const raw = (process.env.DEMO_PASS_CONTACT_EMAIL ?? "").trim();
  // An address, not free text: it is drawn as a mailto link.
  return /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i.test(raw) ? raw : null;
}
