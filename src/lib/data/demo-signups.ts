import { count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { demoSignups } from "../db/schema/index.ts";
import type { DemoSignupRole } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * `demo_signups` — visitors' sign-ups and the demo passes they hold (demo pass
 * spec 2026-10-07 §4, §5).
 *
 * **Two projections, on purpose.** {@link DemoPassLedger} is what the chat and
 * the status route read: the id, the expiry and the spend, and nothing a
 * visitor typed. {@link DemoSignupRecord} carries the name, email and answers,
 * and has one reader — the super-admin page under People and its CSV
 * (`users.manage`). Which function a caller picks is the whole of that
 * decision, as with the two maintenance reads, so a prompt can never be handed
 * a sign-up's details by accident.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module in `src/lib/data/`.
 */

/** A validated sign-up, as `POST /api/demo-pass` hands one over. */
export interface NewDemoSignup {
  name: string;
  /** Normalised already: trimmed, lower-case. */
  email: string;
  institution: string;
  role: DemoSignupRole | null;
  runsMakerspace: boolean | null;
  useCase: string | null;
  consentToContact: boolean;
  /** When a new pass ends (the caller adds the pass's days to now). */
  passExpiresAt: Date;
}

/** The pass a sign-up holds: no name, no email, no answers. */
export interface DemoPassLedger {
  id: string;
  passExpiresAt: Date;
  /** Dollars charged so far. */
  spentUsd: number;
  chargedTurns: number;
}

/** One sign-up as the super-admin page and its CSV show it. */
export interface DemoSignupRecord extends DemoPassLedger {
  name: string;
  email: string;
  institution: string;
  role: DemoSignupRole | null;
  runsMakerspace: boolean | null;
  useCase: string | null;
  consentToContact: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** The pass has not ended yet, by the database's clock. */
  passActive: boolean;
}

export interface DemoSignupOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

const LEDGER = {
  id: demoSignups.id,
  passExpiresAt: demoSignups.passExpiresAt,
  spentUsd: demoSignups.spentUsd,
  chargedTurns: demoSignups.chargedTurns,
} as const;

/**
 * The most rows one read returns. A conference is a few hundred visitors; a
 * list longer than this is a different problem than a page can solve
 * (Article 4: every read is bounded).
 */
const LIST_LIMIT = 2_000;

/**
 * Store a sign-up, or find the one this address already made (spec §5.1: one
 * pass per email). An existing row is returned **unchanged** — the first
 * sign-up stands, and the same pass with its ledger is what signing up again
 * gets. `created` says which happened.
 */
export async function findOrCreateDemoSignup(
  input: NewDemoSignup,
  options: DemoSignupOptions = {}
): Promise<{ created: boolean; pass: DemoPassLedger }> {
  const db = options.db ?? (await getDb());
  const [inserted] = await db
    .insert(demoSignups)
    .values({
      name: input.name,
      email: input.email,
      institution: input.institution,
      role: input.role,
      runsMakerspace: input.runsMakerspace,
      useCase: input.useCase,
      consentToContact: input.consentToContact,
      passExpiresAt: input.passExpiresAt,
    })
    .onConflictDoNothing({ target: demoSignups.email })
    .returning(LEDGER);
  if (inserted) return { created: true, pass: toLedger(inserted) };

  const [existing] = await db.select(LEDGER).from(demoSignups).where(eq(demoSignups.email, input.email)).limit(1);
  // The insert lost to a row with this address, so the row exists. A concurrent
  // delete in between is the only way here; report it as the failure it is.
  if (!existing) throw new Error("demo sign-up vanished between insert and read");
  return { created: false, pass: toLedger(existing) };
}

/** The pass `id` names, or null for a missing row or anything that is not a uuid. */
export async function getDemoPassLedger(id: string, options: DemoSignupOptions = {}): Promise<DemoPassLedger | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select(LEDGER).from(demoSignups).where(eq(demoSignups.id, id)).limit(1);
  return row ? toLedger(row) : null;
}

/**
 * Charge one chat turn's cost to a pass: `spent_usd` grows by `usd` in one
 * statement, so two turns finishing together both count. A negative or
 * non-finite amount is charged as zero (the turn still counts). Null when the
 * row is gone.
 */
export async function chargeDemoPass(id: string, usd: number, options: DemoSignupOptions = {}): Promise<DemoPassLedger | null> {
  if (!isUuid(id)) return null;
  const amount = Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1e6) / 1e6 : 0;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .update(demoSignups)
    .set({
      spentUsd: sql`${demoSignups.spentUsd} + ${amount}`,
      chargedTurns: sql`${demoSignups.chargedTurns} + 1`,
      lastUsedAt: sql`now()`,
    })
    .where(eq(demoSignups.id, id))
    .returning(LEDGER);
  return row ? toLedger(row) : null;
}

/** Every sign-up, newest first — the super-admin page and its CSV only. */
export async function listDemoSignups(options: DemoSignupOptions = {}): Promise<DemoSignupRecord[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      ...LEDGER,
      name: demoSignups.name,
      email: demoSignups.email,
      institution: demoSignups.institution,
      role: demoSignups.role,
      runsMakerspace: demoSignups.runsMakerspace,
      useCase: demoSignups.useCase,
      consentToContact: demoSignups.consentToContact,
      lastUsedAt: demoSignups.lastUsedAt,
      createdAt: demoSignups.createdAt,
      passActive: sql<boolean>`${demoSignups.passExpiresAt} > now()`,
    })
    .from(demoSignups)
    .orderBy(desc(demoSignups.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((row) => ({
    ...row,
    ...toLedger(row),
    role: (row.role as DemoSignupRole | null) ?? null,
    passActive: row.passActive === true,
  }));
}

/** How many sign-ups there are — People's link to the list. */
export async function countDemoSignups(options: DemoSignupOptions = {}): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db.select({ total: count() }).from(demoSignups);
  return Number(row?.total ?? 0);
}

/** A numeric arrives as a number in this mode, but a driver may still hand back a string. */
function toLedger(row: { id: string; passExpiresAt: Date; spentUsd: number | string; chargedTurns: number }): DemoPassLedger {
  const spent = Number(row.spentUsd);
  return {
    id: row.id,
    passExpiresAt: row.passExpiresAt,
    spentUsd: Number.isFinite(spent) ? spent : 0,
    chargedTurns: row.chargedTurns,
  };
}
