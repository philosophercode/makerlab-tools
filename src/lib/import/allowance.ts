import { SUGGEST_ITEMS_PER_LEDGER_ROW } from "./limits.ts";

/**
 * The research allowance, as arithmetic (bulk intake spec §3.3, §4.2).
 *
 * The daily allowance is the base (`RESEARCH_DAILY_ITEM_LIMIT`, 100) plus every
 * **setup allowance** that has not expired yet — a super admin's grant of, say,
 * +400 items for 7 days. It is counted against the same `research_requests`
 * ledger over the same rolling 24 hours, so a grant raises the ceiling for its
 * whole life rather than handing out a lump that one import could spend twice.
 *
 * Pure and client-safe.
 */

export interface AllowanceGrant {
  extraItems: number;
  expiresAt: Date | string;
}

/** The base plus every grant still running at `now`. A malformed grant adds nothing. */
export function effectiveDailyLimit(base: number, grants: readonly AllowanceGrant[], now: Date = new Date()): number {
  let extra = 0;
  for (const grant of grants) {
    const expires = new Date(grant.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires <= now.getTime()) continue;
    if (!Number.isFinite(grant.extraItems) || grant.extraItems <= 0) continue;
    extra += Math.floor(grant.extraItems);
  }
  return base + extra;
}

/** How many more items fit under `limit` when `used` are already spent. */
export function remainingAllowance(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/**
 * The ledger rows a Suggest names pass over `items` costs — a quarter of an
 * item each, rounded up, so one suggestion still costs something.
 */
export function suggestLedgerRows(items: number): number {
  if (!Number.isFinite(items) || items <= 0) return 0;
  return Math.ceil(items / SUGGEST_ITEMS_PER_LEDGER_ROW);
}

/** `ids` in groups of `size`, order kept. */
export function chunkIds<T>(ids: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunkIds: size must be at least 1");
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
