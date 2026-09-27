import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { researchAllowances } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { effectiveDailyLimit } from "../import/allowance.ts";
import { RESEARCH_DAILY_ITEM_LIMIT } from "../intake/limits.ts";

/**
 * Setup allowances (bulk intake spec §4.2): extra research items a super admin
 * grants somebody for a while — "+400 items for 7 days to whoever is loading
 * the inventory". Insert and select only; the audit event is the caller's
 * (`allowance.granted`), after the commit.
 *
 * {@link researchLimitFor} is what every research press checks against — the
 * research route, **Refresh research** and **Find a different image** — so the
 * one ledger (`research_requests`) is measured against one ceiling.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

export interface AllowanceRecord {
  id: string;
  userId: string;
  extraItems: number;
  grantedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
}

interface Options {
  db?: Db;
  now?: Date;
}

/** Record a grant. The caller checked `users.manage` and the bounds. */
export async function grantResearchAllowance(
  input: { userId: string; extraItems: number; days: number; grantedBy: string },
  options: Options = {}
): Promise<AllowanceRecord> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.days * 24 * 60 * 60_000);
  const [row] = await db
    .insert(researchAllowances)
    .values({ userId: input.userId, extraItems: input.extraItems, grantedBy: input.grantedBy, expiresAt })
    .returning();
  return row;
}

/** Every grant still running for these people, newest first. */
export async function listActiveAllowances(userIds: readonly string[], options: Options = {}): Promise<AllowanceRecord[]> {
  const ids = [...new Set(userIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  return db
    .select()
    .from(researchAllowances)
    .where(and(inArray(researchAllowances.userId, ids), gt(researchAllowances.expiresAt, now)))
    .orderBy(desc(researchAllowances.createdAt));
}

/**
 * The research items `userId` may send in a rolling 24 hours: the daily
 * {@link RESEARCH_DAILY_ITEM_LIMIT} plus every setup allowance still running.
 */
export async function researchLimitFor(userId: string, options: Options = {}): Promise<number> {
  const now = options.now ?? new Date();
  const db = options.db ?? (await getDb());
  const grants = await db
    .select({ extraItems: researchAllowances.extraItems, expiresAt: researchAllowances.expiresAt })
    .from(researchAllowances)
    .where(and(eq(researchAllowances.userId, userId), gt(researchAllowances.expiresAt, now)));
  return effectiveDailyLimit(RESEARCH_DAILY_ITEM_LIMIT, grants, now);
}
