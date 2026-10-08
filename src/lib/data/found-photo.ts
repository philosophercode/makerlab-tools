import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { pendingTools, researchRequests } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { FOUND_PHOTO_ERROR_MAX_CHARS, foundPhotoSchema, parseFoundPhoto, type FoundPhoto } from "../intake/found-photo.ts";
import { IDENTIFY_PHOTO_ITEMS_PER_LEDGER_ROW } from "../intake/limits.ts";
import { countResearchRequestedSince } from "./pending-tools.ts";
import { isUuid } from "./uuid.ts";

/**
 * `pending_tools.found_photo` — a photo for an item named without one (data
 * platform spec amendment "A photo for a name"). Three writes, each reading
 * the row `for update` in a transaction:
 *
 * - {@link startFoundPhotoSearch} — after `identify_tools` saved its rows:
 *   marks up to the affordable number of the named items `searching` under one
 *   request id and charges the daily research allowance **a quarter item
 *   each** (`IDENTIFY_PHOTO_ITEMS_PER_LEDGER_ROW`), counted and recorded under
 *   the per-person lock the Research route takes, so the two cannot together
 *   pass it. Items the allowance cannot cover are left without a lookup.
 * - {@link finishFoundPhoto} — the run's answer, only while the row's lookup
 *   is still this request's and still searching.
 * - {@link failFoundPhoto} — the run gave up; the reason, one line.
 *
 * Plain Node: the lookup's step code calls this. Relative imports only.
 */

interface Options {
  db?: Db;
}

export interface StartFoundPhotoInput {
  /** Who identified the items — whose allowance the lookups cost. */
  requestedBy: string;
  /** The run's id, recorded on each row and in the ledger. */
  requestId: string;
  /** The daily allowance and the window it is counted over. */
  limit: number;
  since: Date;
  now?: Date;
}

export interface StartFoundPhotoResult {
  /** The items now `searching`, in the order given. */
  started: string[];
  /** Items left out because the allowance could not cover them. */
  unaffordable: number;
  /** Ledger rows charged. */
  charged: number;
}

/** How many ledger rows `items` lookups cost: a quarter item each, rounded up. */
export function foundPhotoLedgerRows(items: number): number {
  if (!Number.isFinite(items) || items <= 0) return 0;
  return Math.ceil(items / IDENTIFY_PHOTO_ITEMS_PER_LEDGER_ROW);
}

export async function startFoundPhotoSearch(
  ids: readonly string[],
  input: StartFoundPhotoInput,
  options: Options = {}
): Promise<StartFoundPhotoResult> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0 || !isUuid(input.requestId)) return { started: [], unaffordable: 0, charged: 0 };
  const db = options.db ?? (await getDb());
  const now = input.now ?? new Date();

  return db.transaction(async (tx): Promise<StartFoundPhotoResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${input.requestedBy}`}))`);
    // Only items still identified that have no lookup yet.
    const rows = await tx
      .select({ id: pendingTools.id })
      .from(pendingTools)
      .where(and(inArray(pendingTools.id, wanted), eq(pendingTools.status, "identified"), isNull(pendingTools.foundPhoto)))
      .for("update");
    const eligible = new Set(rows.map((row) => row.id));
    const candidates = wanted.filter((id) => eligible.has(id));
    if (candidates.length === 0) return { started: [], unaffordable: 0, charged: 0 };

    const used = await countResearchRequestedSince(input.requestedBy, input.since, { db: tx });
    const affordable = Math.max(0, (input.limit - used) * IDENTIFY_PHOTO_ITEMS_PER_LEDGER_ROW);
    const started = candidates.slice(0, affordable);
    if (started.length === 0) return { started: [], unaffordable: candidates.length, charged: 0 };

    const searching: FoundPhoto = {
      requestId: input.requestId,
      requestedAt: now.toISOString(),
      status: "searching",
      candidate: null,
      cleaned: null,
      error: null,
    };
    await tx.update(pendingTools).set({ foundPhoto: searching }).where(inArray(pendingTools.id, started));
    const charged = foundPhotoLedgerRows(started.length);
    await tx
      .insert(researchRequests)
      .values(Array.from({ length: charged }, () => ({ requestId: input.requestId, userId: input.requestedBy })));
    return { started, unaffordable: candidates.length - started.length, charged };
  });
}

/** The lookup's answer: `found` with its picture, or `none`. */
export type FoundPhotoAnswer = Pick<FoundPhoto, "candidate" | "cleaned" | "cleanNote"> & { status: "found" | "none" };

/**
 * Write the run's answer — only while the row's lookup is this request's and
 * still searching. False when it was not written (the row was discarded,
 * approved or looked up again meanwhile): the caller lets go of what it made.
 */
export async function finishFoundPhoto(id: string, requestId: string, answer: FoundPhotoAnswer, options: Options = {}): Promise<boolean> {
  return writeIfSearching(id, requestId, (current) => ({ ...current, ...answer, error: null }), options);
}

/** The run gave up: record why, in one line. */
export async function failFoundPhoto(id: string, requestId: string, reason: string, options: Options = {}): Promise<boolean> {
  const error = reason.replace(/\s+/g, " ").trim().slice(0, FOUND_PHOTO_ERROR_MAX_CHARS) || "The photo search failed.";
  return writeIfSearching(id, requestId, (current) => ({ ...current, status: "failed", candidate: null, cleaned: null, error }), options);
}

async function writeIfSearching(
  id: string,
  requestId: string,
  next: (current: FoundPhoto) => FoundPhoto,
  options: Options
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: pendingTools.status, foundPhoto: pendingTools.foundPhoto })
      .from(pendingTools)
      .where(eq(pendingTools.id, id))
      .for("update");
    const current = parseFoundPhoto(row?.foundPhoto);
    if (!row || !current || current.requestId !== requestId || current.status !== "searching") return false;
    if (row.status === "approved" || row.status === "discarded") return false;
    const value = foundPhotoSchema.parse(next(current));
    await tx.update(pendingTools).set({ foundPhoto: value }).where(eq(pendingTools.id, id));
    return true;
  });
}
