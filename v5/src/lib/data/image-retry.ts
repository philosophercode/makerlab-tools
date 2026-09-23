import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { pendingTools, researchRequests } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { imageRetryInProgress } from "../intake/image-retry-state.ts";
import { parseResearchResult, researchResultSchema, type ResearchImages, type ResearchResult } from "../research/result.ts";
import { countResearchRequestedSince } from "./pending-tools.ts";
import { hasUploadedPhoto } from "./research-images.ts";
import { isUuid } from "./uuid.ts";

/**
 * **Find a different image** — the image stage run again for one researched
 * item (amendment "Product-page first, front-facing images, reviewer notes").
 *
 * The run's state lives **inside `research`**, as `research.imageRetry`, not in
 * a column: it describes that research result and dies with it (a Research
 * again replaces the whole result, and a stale run's write then matches
 * nothing), and no migration was needed. Every write here reads the row `for
 * update` in a transaction and writes the whole result back validated, so two
 * clicks, or a click and a finishing run, are served one after the other.
 *
 * - {@link startImageRetry} — the button: the item must be `researched`, have a
 *   result, have no uploaded photo (that photo is the cover) and no run already
 *   going; and the press **costs one** against the daily research allowance,
 *   counted and recorded under the same per-person lock the Research route
 *   takes, so the two cannot together pass it.
 * - {@link finishImageRetry} — the run's result replaces `research.images`,
 *   only while the row is still `researched` and this run is still the latest.
 *   It answers the cleaned copy the old images held, for the caller to release.
 * - {@link failImageRetry} — the run gave up: the old images stay, and the
 *   reason is recorded for the page.
 *
 * Plain Node: the retry step calls this. Relative imports only.
 */

export type StartImageRetryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_editable" | "image_retry_running" }
  | { ok: false; reason: "daily_limit"; remaining: number };

export interface StartImageRetryInput {
  /** Who pressed it — whose allowance it costs. */
  requestedBy: string;
  /** The run's id, recorded on the result and in the ledger. */
  requestId: string;
  /** The reviewer's note, already cleaned and capped, or null. */
  note: string | null;
  /** The daily allowance and the window it is counted over. */
  limit: number;
  since: Date;
  now?: Date;
}

interface Options {
  db?: Db;
}

export async function startImageRetry(
  id: string,
  input: StartImageRetryInput,
  options: Options = {}
): Promise<StartImageRetryResult> {
  if (!isUuid(id) || !isUuid(input.requestId)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  const now = input.now ?? new Date();

  return db.transaction(async (tx): Promise<StartImageRetryResult> => {
    // The Research route's lock: one person's presses of either button are counted one at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${input.requestedBy}`}))`);
    const row = await lockRow(tx, id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "researched" || !row.research) return { ok: false, reason: "not_editable" };
    if (await hasUploadedPhoto(tx, id)) return { ok: false, reason: "not_editable" };
    if (imageRetryInProgress(row.research.imageRetry, now.getTime())) return { ok: false, reason: "image_retry_running" };

    const used = await countResearchRequestedSince(input.requestedBy, input.since, { db: tx });
    if (used + 1 > input.limit) return { ok: false, reason: "daily_limit", remaining: Math.max(0, input.limit - used) };

    await writeResearch(tx, id, {
      ...row.research,
      imageRetry: { requestId: input.requestId, requestedAt: now.toISOString(), status: "running", note: input.note, error: null },
    });
    await tx.insert(researchRequests).values({ requestId: input.requestId, userId: input.requestedBy, pendingToolId: id });
    return { ok: true };
  });
}

export type FinishImageRetryResult =
  | { ok: true; previousCleanedId: string | null }
  | { ok: false };

/**
 * The run's images replace the old ones — only while the row is `researched`
 * and `research.imageRetry` is still this run, running. `previousCleanedId` is
 * the cleaned copy the replaced images held, which nobody can choose any more.
 */
export async function finishImageRetry(
  id: string,
  requestId: string,
  images: ResearchImages,
  options: Options = {}
): Promise<FinishImageRetryResult> {
  if (!isUuid(id)) return { ok: false };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<FinishImageRetryResult> => {
    const row = await lockRow(tx, id);
    const retry = row?.research?.imageRetry;
    if (!row?.research || row.status !== "researched" || retry?.requestId !== requestId || retry.status !== "running") {
      return { ok: false };
    }
    const previousCleanedId = row.research.images?.cleaned?.attachmentId ?? null;
    await writeResearch(tx, id, {
      ...row.research,
      images,
      imageError: null,
      imageRetry: { ...retry, status: "done", error: null },
    });
    return { ok: true, previousCleanedId };
  });
}

/** The run gave up: the images stay as they were, and `message` (one clipped line) says why. */
export async function failImageRetry(id: string, requestId: string, message: string, options: Options = {}): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<boolean> => {
    const row = await lockRow(tx, id);
    const retry = row?.research?.imageRetry;
    if (!row?.research || row.status !== "researched" || retry?.requestId !== requestId || retry.status !== "running") {
      return false;
    }
    const error = message.replace(/\s+/g, " ").trim().slice(0, 300) || "The image search failed.";
    await writeResearch(tx, id, { ...row.research, imageRetry: { ...retry, status: "failed", error } });
    return true;
  });
}

async function lockRow(tx: Db, id: string): Promise<{ status: string; research: ResearchResult | null } | null> {
  const [row] = await tx
    .select({ status: pendingTools.status, research: pendingTools.research })
    .from(pendingTools)
    .where(eq(pendingTools.id, id))
    .for("update");
  if (!row) return null;
  return { status: row.status, research: parseResearchResult(row.research) };
}

async function writeResearch(tx: Db, id: string, research: ResearchResult): Promise<void> {
  await tx.update(pendingTools).set({ research: researchResultSchema.parse(research) }).where(eq(pendingTools.id, id));
}
