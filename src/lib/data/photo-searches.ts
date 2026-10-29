import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { researchRequests, toolPhotoSearches, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import {
  parsePhotoOptions,
  PHOTO_SEARCH_STALE_MS,
  photoSearchRunning,
  type PhotoOption,
  type PhotoSearchView,
} from "../photo-options/types.ts";
import type { PhotoSearchStatus } from "../db/schema/vocabulary.ts";
import { countResearchRequestedSince } from "./pending-tools.ts";
import { isUuid } from "./uuid.ts";

/**
 * `tool_photo_searches` — **Find photo options** for a catalogue tool (photo
 * options spec 2026-10-29; migration `0036`).
 *
 * - {@link startPhotoSearch} — the press: the tool must exist, no search may be
 *   running for it already (a `searching` row older than
 *   `PHOTO_SEARCH_STALE_MS` is closed as failed first, so a lost run never
 *   blocks the button), and it **costs one** against the person's daily research
 *   allowance, counted and recorded under the same per-person lock the
 *   Research route and **Find a different image** take.
 * - {@link finishPhotoSearch} / {@link failPhotoSearch} — the run's result,
 *   only while the row is still `searching`.
 * - {@link latestPhotoSearch} — what the editor and the assistant show.
 * - {@link shownPhotoUrls} — every picture the tool's earlier searches
 *   offered, which a new search leaves out ("more options", not the same ones).
 * - {@link recordPhotoChoice} — which option became the cover.
 *
 * Plain Node: the workflow's step calls this. Relative imports only.
 */

interface Options {
  db?: Db;
}

export type StartPhotoSearchResult =
  | { ok: true; searchId: string }
  | { ok: false; reason: "not_found" | "photo_search_running" }
  | { ok: false; reason: "daily_limit"; remaining: number };

export interface StartPhotoSearchInput {
  /** Who pressed it — whose allowance it costs. */
  requestedBy: string;
  /** The note, already cleaned and capped, or null. */
  note: string | null;
  /** The daily allowance and the window it is counted over. */
  limit: number;
  since: Date;
  now?: Date;
}

export async function startPhotoSearch(
  toolId: string,
  input: StartPhotoSearchInput,
  options: Options = {}
): Promise<StartPhotoSearchResult> {
  if (!isUuid(toolId)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  const now = input.now ?? new Date();

  return db.transaction(async (tx): Promise<StartPhotoSearchResult> => {
    // The Research route's lock: one person's presses of any research button are counted one at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${input.requestedBy}`}))`);
    const [tool] = await tx.select({ id: tools.id }).from(tools).where(eq(tools.id, toolId)).for("update");
    if (!tool) return { ok: false, reason: "not_found" };

    // A run that never answered is closed, so the button works again.
    await tx
      .update(toolPhotoSearches)
      .set({ status: "failed", error: "The search took too long and was stopped.", updatedAt: now })
      .where(
        and(
          eq(toolPhotoSearches.toolId, toolId),
          eq(toolPhotoSearches.status, "searching"),
          lt(toolPhotoSearches.createdAt, new Date(now.getTime() - PHOTO_SEARCH_STALE_MS))
        )
      );
    const [running] = await tx
      .select({ id: toolPhotoSearches.id })
      .from(toolPhotoSearches)
      .where(and(eq(toolPhotoSearches.toolId, toolId), eq(toolPhotoSearches.status, "searching")));
    if (running) return { ok: false, reason: "photo_search_running" };

    const used = await countResearchRequestedSince(input.requestedBy, input.since, { db: tx });
    if (used + 1 > input.limit) return { ok: false, reason: "daily_limit", remaining: Math.max(0, input.limit - used) };

    const [row] = await tx
      .insert(toolPhotoSearches)
      .values({ toolId, note: input.note, requestedBy: input.requestedBy, createdAt: now, updatedAt: now })
      .returning({ id: toolPhotoSearches.id });
    await tx.insert(researchRequests).values({ requestId: row.id, userId: input.requestedBy, requestedAt: now });
    return { ok: true, searchId: row.id };
  });
}

/** The search's pictures land — only while it is still `searching`. False when it is not any more. */
export async function finishPhotoSearch(id: string, found: readonly PhotoOption[], options: Options = {}): Promise<boolean> {
  return settle(id, { status: "ready", options: [...found], error: null }, options);
}

/** The search gave up, with the reason the editor shows. */
export async function failPhotoSearch(id: string, error: string, options: Options = {}): Promise<boolean> {
  return settle(id, { status: "failed", error }, options);
}

async function settle(
  id: string,
  patch: { status: PhotoSearchStatus; options?: PhotoOption[]; error: string | null },
  options: Options
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(toolPhotoSearches)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(toolPhotoSearches.id, id), eq(toolPhotoSearches.status, "searching")))
    .returning({ id: toolPhotoSearches.id });
  return rows.length > 0;
}

/** One search, with its tool — what the step and a pick read. */
export interface PhotoSearchRow {
  id: string;
  toolId: string;
  status: PhotoSearchStatus;
  note: string | null;
  options: PhotoOption[];
  error: string | null;
  chosenUrl: string | null;
  createdAt: Date;
}

export async function getPhotoSearch(id: string, options: Options = {}): Promise<PhotoSearchRow | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(toolPhotoSearches).where(eq(toolPhotoSearches.id, id));
  return row ? toRow(row) : null;
}

/** The tool's latest search as the editor shows it, or null when it has none. */
export async function latestPhotoSearch(toolId: string, options: Options & { now?: number } = {}): Promise<PhotoSearchView | null> {
  if (!isUuid(toolId)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select()
    .from(toolPhotoSearches)
    .where(eq(toolPhotoSearches.toolId, toolId))
    .orderBy(desc(toolPhotoSearches.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = toRow(row);
  return {
    id: parsed.id,
    status: parsed.status,
    running: photoSearchRunning(parsed, options.now),
    note: parsed.note,
    options: parsed.options,
    error: parsed.error,
    chosenUrl: parsed.chosenUrl,
    requestedAt: parsed.createdAt.toISOString(),
  };
}

/** Every picture the tool's last few searches offered, so the next one finds others. */
export async function shownPhotoUrls(toolId: string, options: Options & { except?: string; searches?: number } = {}): Promise<string[]> {
  if (!isUuid(toolId)) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ id: toolPhotoSearches.id, options: toolPhotoSearches.options })
    .from(toolPhotoSearches)
    .where(eq(toolPhotoSearches.toolId, toolId))
    .orderBy(desc(toolPhotoSearches.createdAt))
    .limit((options.searches ?? 3) + 1);
  return rows.filter((row) => row.id !== options.except).flatMap((row) => parsePhotoOptions(row.options).map((option) => option.url));
}

/** Record which option became the cover. Never refuses: the photo is already attached. */
export async function recordPhotoChoice(id: string, url: string, by: string | null, options: Options = {}): Promise<void> {
  if (!isUuid(id)) return;
  const db = options.db ?? (await getDb());
  const now = new Date();
  await db.update(toolPhotoSearches).set({ chosenUrl: url, chosenBy: by, chosenAt: now, updatedAt: now }).where(eq(toolPhotoSearches.id, id));
}

function toRow(row: typeof toolPhotoSearches.$inferSelect): PhotoSearchRow {
  return {
    id: row.id,
    toolId: row.toolId,
    status: row.status as PhotoSearchStatus,
    note: row.note,
    options: parsePhotoOptions(row.options),
    error: row.error,
    chosenUrl: row.chosenUrl,
    createdAt: row.createdAt,
  };
}
