import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { actionProposals } from "../db/schema/index.ts";
import type { ActionProposalStatus, ActionProposalSurface } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * `action_proposals` — what the assistant put in front of a person, and what
 * became of it (assistant–GUI parity spec §3.5; migration `0020`).
 *
 * The rules this module holds, so no caller can skip one:
 *
 * - **Only the creator decides** (§11 answer 11): every claim and cancel is
 *   conditional on `created_by`.
 * - **One decision per row.** A claim is `UPDATE … WHERE status = 'open' AND
 *   expires_at > now() RETURNING`; a second tab's click finds nothing to claim
 *   and is told the row was already decided.
 * - **The stored input is the input.** Nothing here takes a changed input at
 *   confirm time; the caller runs what the row holds.
 *
 * Relative imports with `.ts` extensions, like every module under `data/`.
 */

export interface ActionProposalOptions {
  db?: Db;
}

/** How long a proposal stays open (§11 answer 7). */
export const PROPOSAL_TTL_MINUTES: Record<ActionProposalSurface, number> = {
  assistant: 60,
  mcp: 7 * 24 * 60,
};

/** At most this many open proposals per person (§8.3). */
export const MAX_OPEN_PROPOSALS = 50;

export interface NewActionProposal {
  groupId: string;
  actionId: string;
  input: unknown;
  subjectType: string;
  subjectId: string;
  preview: Record<string, unknown>;
  surface: ActionProposalSurface;
  chatId: string | null;
  createdBy: string;
  tainted?: boolean;
}

export interface ActionProposalRecord {
  id: string;
  groupId: string;
  actionId: string;
  input: unknown;
  subjectType: string;
  subjectId: string;
  preview: Record<string, unknown>;
  surface: ActionProposalSurface;
  chatId: string | null;
  status: ActionProposalStatus;
  result: Record<string, unknown> | null;
  tainted: boolean;
  createdBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  /** Open and past `expires_at`, by the database's clock. */
  expired: boolean;
}

type Row = typeof actionProposals.$inferSelect;

function toRecord(row: Row, expired: boolean): ActionProposalRecord {
  return {
    id: row.id,
    groupId: row.groupId,
    actionId: row.actionId,
    input: row.input,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    preview: row.preview,
    surface: row.surface as ActionProposalSurface,
    chatId: row.chatId,
    status: row.status as ActionProposalStatus,
    result: row.result ?? null,
    tainted: row.tainted,
    createdBy: row.createdBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    expired: row.status === "open" && expired,
  };
}

const EXPIRED = sql<boolean>`${actionProposals.expiresAt} <= now()`;

/**
 * Store one proposal per subject, all in one statement. `expires_at` is the
 * database's `now()` plus the surface's lifetime, never the caller's clock.
 */
export async function createActionProposals(
  rows: readonly NewActionProposal[],
  options: ActionProposalOptions = {}
): Promise<ActionProposalRecord[]> {
  if (rows.length === 0) return [];
  const db = options.db ?? (await getDb());
  const inserted = await db
    .insert(actionProposals)
    .values(
      rows.map((row) => ({
        groupId: row.groupId,
        actionId: row.actionId,
        input: row.input,
        subjectType: row.subjectType,
        subjectId: row.subjectId.slice(0, 300),
        preview: row.preview,
        surface: row.surface,
        chatId: row.chatId?.slice(0, 200) ?? null,
        createdBy: row.createdBy,
        tainted: row.tainted ?? false,
        expiresAt: sql`now() + ${`${PROPOSAL_TTL_MINUTES[row.surface]} minutes`}::interval`,
      }))
    )
    .returning();
  return inserted.map((row) => toRecord(row, false));
}

/** How many proposals `userId` has open and unexpired. */
export async function countOpenProposals(userId: string, options: ActionProposalOptions = {}): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(actionProposals)
    .where(and(eq(actionProposals.createdBy, userId), eq(actionProposals.status, "open"), gt(actionProposals.expiresAt, sql`now()`)));
  return Number(row?.total ?? 0);
}

/** The rows by id, any creator, any state — the caller decides what it may see. */
export async function getActionProposals(ids: readonly string[], options: ActionProposalOptions = {}): Promise<ActionProposalRecord[]> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db.select({ row: actionProposals, expired: EXPIRED }).from(actionProposals).where(inArray(actionProposals.id, valid));
  return rows.map(({ row, expired }) => toRecord(row, Boolean(expired)));
}

/**
 * Take the rows `userId` may confirm now: theirs, open, unexpired. They move
 * to `confirming` in the same statement, so a second click (another tab, a
 * double tap) claims nothing. Rows not returned were not claimable.
 */
export async function claimActionProposals(
  ids: readonly string[],
  userId: string,
  options: ActionProposalOptions = {}
): Promise<ActionProposalRecord[]> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(actionProposals)
    .set({ status: "confirming" })
    .where(
      and(
        inArray(actionProposals.id, valid),
        eq(actionProposals.createdBy, userId),
        eq(actionProposals.status, "open"),
        gt(actionProposals.expiresAt, sql`now()`)
      )
    )
    .returning();
  return rows.map((row) => toRecord(row, false));
}

/** Record how a claimed row ended. Only a `confirming` row is settled. */
export async function settleActionProposal(
  id: string,
  outcome: { status: Extract<ActionProposalStatus, "confirmed" | "failed" | "conflict">; result: Record<string, unknown>; decidedBy: string },
  options: ActionProposalOptions = {}
): Promise<void> {
  const db = options.db ?? (await getDb());
  await db
    .update(actionProposals)
    .set({ status: outcome.status, result: outcome.result, decidedBy: outcome.decidedBy, decidedAt: sql`now()` })
    .where(and(eq(actionProposals.id, id), eq(actionProposals.status, "confirming")));
}

/** Cancel `userId`'s own open rows. Answers the ids that were cancelled. */
export async function cancelActionProposals(
  ids: readonly string[],
  userId: string,
  options: ActionProposalOptions = {}
): Promise<string[]> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(actionProposals)
    .set({ status: "cancelled", decidedBy: userId, decidedAt: sql`now()` })
    .where(and(inArray(actionProposals.id, valid), eq(actionProposals.createdBy, userId), eq(actionProposals.status, "open")))
    .returning({ id: actionProposals.id });
  return rows.map((row) => row.id);
}

/**
 * `userId`'s proposals in one chat, newest first — what the next turn is told
 * happened (§5.3) and what a reloaded card re-reads (§5.5). Bounded: a chat
 * proposal lives an hour, so a day covers every one still worth a line.
 */
export async function listChatActionProposals(
  chatId: string,
  userId: string,
  options: ActionProposalOptions & { limit?: number } = {}
): Promise<ActionProposalRecord[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ row: actionProposals, expired: EXPIRED })
    .from(actionProposals)
    .where(
      and(
        eq(actionProposals.chatId, chatId.slice(0, 200)),
        eq(actionProposals.createdBy, userId),
        gt(actionProposals.createdAt, sql`now() - interval '1 day'`)
      )
    )
    .orderBy(desc(actionProposals.createdAt))
    .limit(options.limit ?? 30);
  return rows.map(({ row, expired }) => toRecord(row, Boolean(expired)));
}
