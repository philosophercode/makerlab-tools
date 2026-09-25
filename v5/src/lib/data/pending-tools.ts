import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { getDb } from "../db/client.ts";
import {
  attachments,
  categories,
  locations,
  pendingTools,
  researchRequests,
  resources,
  tools,
  units,
  user,
} from "../db/schema/index.ts";
import {
  DUPLICATE_RESOLUTION,
  isOneOf,
  type DuplicateResolution,
  type PendingStatus,
} from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { RESEARCH_START_STALE_MS } from "../intake/limits.ts";
import type { ResearchFocus, ResearchFocusField } from "../intake/research-focus.ts";
import type { DuplicateOf } from "../intake/types.ts";
import type { ImportItem, ImportLink, LabDoc, NameSuggestion } from "../import/types.ts";
import { IMPORT_MAX_QUANTITY } from "../import/limits.ts";
import { approvalUnits, importApprovalResources } from "../import/resources.ts";
import { mergeResearch } from "../research/focus-merge.ts";
import { parseResearchResult, researchResultSchema, type ResearchResult } from "../research/result.ts";
import { claimAttachments, releaseAttachments, reownAttachments } from "./attachments.ts";
import { findDuplicate, findDuplicates, initialResolution } from "./duplicates.ts";
import { isUniqueViolation } from "./pg-errors.ts";
import { DISPLAY_NAME_MAX } from "../tool-names.ts";
import { findOrCreateCategory } from "./taxonomy.ts";
import { createToolRecord } from "./tool-create.ts";
import { isUuid } from "./uuid.ts";
import type { Refused, WriteRefusal } from "./write-result.ts";

/**
 * `pending_tools` — the two-step add-tool flow's scratch rows (spec §4.10,
 * §5.4).
 *
 * An item is **identified** in the chat, **queued** and **researched** in the
 * background, and then **approved** into a tool or **discarded** by a person.
 * Every transition here is one conditional statement whose WHERE clause carries
 * the state it moves *from*, so two callers racing for the same row cannot both
 * win: the second one's statement matches nothing, and it is told so. That is
 * the whole concurrency model — there is no revision token, because no field
 * here is a form somebody spends ten minutes typing into.
 *
 * **Nothing here creates catalogue rows except the two approve functions**, and
 * they are only ever called behind `tools.approve` (Article 5, §8 "Write
 * safety"). Neither records an audit event nor invalidates a cache: this module
 * is loaded by `scripts/` under plain Node, where `next/cache` does not exist,
 * so the caller composes both — `record()` from `admin/audit-warning.ts` and
 * `invalidateCatalog()` from `revalidate.ts`, after the commit.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

// ── Shapes ──────────────────────────────────────────────────────────

/** One row, with `research` already validated. */
export interface PendingToolRecord {
  id: string;
  batchId: string;
  status: PendingStatus;
  name: string;
  brand: string | null;
  categoryHint: string | null;
  locationHint: string | null;
  serialNumber: string | null;
  duplicateOfToolId: string | null;
  duplicateOfPendingId: string | null;
  duplicateResolution: DuplicateResolution | null;
  /**
   * Parsed with `parseResearchResult` on every read. Stored JSON that no longer
   * matches the schema reads as null, and {@link researchError} says so rather
   * than the page inventing an empty result.
   */
  research: ResearchResult | null;
  researchError: string | null;
  workflowRunId: string | null;
  /** The Research press that last queued the row — see {@link queueForResearch}. */
  researchRequestId: string | null;
  researchRequestedBy: string | null;
  researchRequestedAt: Date | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalNote: string | null;
  createdToolId: string | null;
  createdUnitId: string | null;
  /** The bulk import this item came from, and its row there (bulk intake spec §4.1). */
  importId: string | null;
  sourceRow: number | null;
  /** Units approval creates — never that many tools. 1 for everything the chat identified. */
  quantity: number;
  serials: string[];
  /** The lab's own documents: carried to approval unread, never given to research. */
  labDocs: LabDoc[];
  /** Product or manual links the list gave, offered as resources at approval. */
  links: ImportLink[];
  /** The list's notes — kept here, never sent to a search. */
  notes: string | null;
  /** The Suggest names pass's answer, until it is accepted or ignored. */
  nameSuggestion: NameSuggestion | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A photo on a pending item, cover first. `url` is null for a private blob.
 *
 * Never the research image stage's background-removed copy (`origin`
 * `research_image_cleaned`): that is owned by the item too, but it is a
 * candidate an admin has not chosen, not a photo anybody attached — it reaches
 * the review page through `research.images`, and nowhere else.
 */
export interface PendingPhoto {
  attachmentId: string;
  url: string | null;
  filename: string | null;
  position: number;
}

/** A row as every reader wants it: the match resolved, the photos, the owner's name. */
export interface PendingTool extends PendingToolRecord {
  duplicateOf: DuplicateOf | null;
  photos: PendingPhoto[];
  createdByName: string | null;
}

/** Where a person may still change the name, the hints or the duplicate decision. */
export const EDITABLE_PENDING_STATUSES = ["identified", "researched", "failed"] as const;

export interface PendingToolOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** The research-step writes, which only touch a row their own request queued. */
export interface ResearchWriteOptions extends PendingToolOptions {
  /**
   * The request that queued the row (`research_request_id`). When given, the
   * write happens only while the row is still that request's: a run whose
   * items a later press took over writes nothing.
   */
  requestId?: string;
}

/** The statuses somebody still has to act on — everything but approved and discarded. */
export const OPEN_PENDING_STATUSES = ["identified", "queued", "researching", "researched", "failed"] as const satisfies readonly PendingStatus[];

/** Settled items `/admin/intake` shows, newest first, beneath the open work. */
export const INTAKE_SETTLED_LIMIT = 100;

/** One item as `identify_tools` hands it over. */
export interface NewPendingTool {
  name: string;
  brand?: string | null;
  categoryHint?: string | null;
  locationHint?: string | null;
  serialNumber?: string | null;
  /** `attachments.id`s of the uploads that show this item. */
  attachmentIds?: string[];
  /** Bulk intake's extra fields (bulk intake spec §4.1); absent for the chat's items. */
  imported?: Pick<ImportItem, "quantity" | "serials" | "labDocs" | "links" | "notes" | "sourceRow"> & {
    importId: string;
  };
}

export interface CreatePendingBatchOptions extends PendingToolOptions {
  /** The batch id to use — an import's own. A fresh one when absent. */
  batchId?: string;
  /**
   * Check each item against the items of the same batch created before it
   * (bulk intake spec §2: "and the other rows of the same import"). Off for the
   * chat's batches, whose siblings are the table the person is looking at.
   */
  checkWithinBatch?: boolean;
}

export interface CreatedPendingBatch {
  batchId: string;
  /** In the order the items were given. */
  items: { id: string; photosSubmitted: number; photosAttached: number }[];
}

export interface PendingToolPatch {
  name?: string;
  brand?: string | null;
  categoryHint?: string | null;
  locationHint?: string | null;
  serialNumber?: string | null;
  duplicateResolution?: DuplicateResolution | null;
  /** Units approval creates, 1–50 (bulk intake spec §3.2); never below the serials given. */
  quantity?: number;
  /** Clear the Suggest names answer (Ignore) — accepting one is a name edit plus this. */
  clearNameSuggestion?: true;
}

export type PendingToolWriteResult =
  | { ok: true; item: PendingTool }
  | Refused<"not_found" | "not_editable" | "invalid_field">;

export type DiscardResult =
  | { ok: true; item: PendingTool; released: number }
  | Refused<"not_found" | "not_editable">;

/**
 * The product image an approval makes the tool's cover (gateway spec §4.3):
 * the background-removed copy of rank 1, one of the recorded candidates by its
 * exact URL, or none. Absent means none.
 */
export type ApprovalImageChoice =
  | { choice: "cleaned" }
  | { choice: "original"; candidateUrl: string }
  | { choice: "none" };

/** What approval turns into the tool's fields — the preliminary page's form. */
export interface ApprovalFields {
  /** The display name (tool display names spec §5.3): refused over `DISPLAY_NAME_MAX`. */
  name: string;
  /** The official name; blank or absent is none. */
  officialName?: string | null;
  description: string | null;
  categoryId: string | null;
  /** Used only when `categoryId` is null: found case-insensitively, or created. */
  newCategory?: { name: string; group: string | null } | null;
  locationId: string | null;
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  serialNumber: string | null;
  /** A subset of `research.resources[].url`; all of them when omitted. */
  resourceUrls?: string[];
  /**
   * A subset of the item's own `links` (an import's product or manual links),
   * added as resources after research's; all of them when omitted. Lab
   * documents are not chosen here — they always come along (bulk intake spec §3.4).
   */
  importLinkUrls?: string[];
  /**
   * The product image to use as the cover. Read by `intake/approval-image.ts`,
   * which turns it into {@link ApprovePendingInput.coverAttachmentId} before the
   * transaction; the transaction itself never downloads anything.
   */
  image?: ApprovalImageChoice;
}

export interface ApprovePendingInput {
  id: string;
  actorUserId: string;
  /** Approve (true) or Approve as draft (false). */
  publish: boolean;
  fields: ApprovalFields;
  /** Required, non-blank, when research graded the item low (§5.4 step 12). */
  overrideNote?: string | null;
  /**
   * The prepared cover (gateway spec §5.2 step 3): a public `research_image`
   * nobody owns yet, or this item's own `research_image_cleaned` copy, already
   * made public. Null or absent for no image.
   */
  coverAttachmentId?: string | null;
}

export type ApprovePendingResult =
  | {
      ok: true;
      toolId: string;
      slug: string;
      unitId: string | null;
      resourcesCreated: number;
      /**
       * The resources created, for the manual archive to copy after the
       * commit — lab documents left out, because nothing may fetch them.
       */
      resourceIds: string[];
      photosMoved: number;
      published: boolean;
      /** True when a low-confidence grade was overridden with a note. */
      overridden: boolean;
      /**
       * True when {@link ApprovePendingInput.coverAttachmentId} is now the
       * tool's cover. False when none was given, or when it was no longer
       * there to take — the caller says so rather than claim a photo.
       */
      coverAttached: boolean;
    }
  | Refused<"not_found" | "not_editable" | "low_confidence" | "invalid_field">;

export type ApproveAsUnitResult =
  | {
      ok: true;
      toolId: string;
      slug: string;
      unitId: string;
      photosMoved: number;
      /** The tool the unit joined: published, or a draft only staff can open. */
      published: boolean;
    }
  | Refused<"not_found" | "not_editable" | "invalid_field" | "duplicate_serial">;

/** Text fields a person types are capped like the route caps them. */
const MAX_FIELD_LENGTH = 200;

/** `research_error` is a diagnosis, not a log file. */
const MAX_ERROR_LENGTH = 2000;

/** What a reader sees when stored research no longer parses. */
export const INVALID_STORED_RESEARCH =
  "The stored research result did not match the expected shape and was ignored. Research again.";

// ── Reading ─────────────────────────────────────────────────────────

/** One item, or null — including for anything that is not uuid-shaped. */
export async function getPendingTool(
  id: string,
  options: PendingToolOptions = {}
): Promise<PendingTool | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [item] = await readPendingTools(db, eq(pendingTools.id, id), 1);
  return item ?? null;
}

/**
 * Items, newest batch first and alphabetical within a batch.
 *
 * When `ids` is given the answer comes back **in that order** instead — the
 * intake card lists items the way `identify_tools` named them.
 */
export async function listPendingTools(
  query: {
    statuses?: readonly PendingStatus[];
    createdBy?: string;
    ids?: string[];
    /** Only the items of this bulk import. */
    importId?: string;
    /** At most this many rows; 500 when omitted, and no cap at all when null. */
    limit?: number | null;
  } = {},
  options: PendingToolOptions = {}
): Promise<PendingTool[]> {
  const filters: SQL[] = [];
  if (query.statuses) {
    if (query.statuses.length === 0) return [];
    filters.push(inArray(pendingTools.status, [...query.statuses]));
  }
  if (query.createdBy !== undefined) filters.push(eq(pendingTools.createdBy, query.createdBy));
  if (query.importId !== undefined) {
    if (!isUuid(query.importId)) return [];
    filters.push(eq(pendingTools.importId, query.importId));
  }
  let ids: string[] | null = null;
  if (query.ids) {
    ids = [...new Set(query.ids.filter(isUuid))];
    if (ids.length === 0) return [];
    filters.push(inArray(pendingTools.id, ids));
  }

  const db = options.db ?? (await getDb());
  const limit = query.limit === undefined ? 500 : query.limit;
  const items = await readPendingTools(db, filters.length ? and(...filters) : undefined, limit);
  if (!ids) return items;
  const order = new Map(ids.map((id, index) => [id, index]));
  return items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * What `/admin/intake` lists (§5.4 step 10): **every** item somebody still has
 * to act on, uncapped, and the newest {@link INTAKE_SETTLED_LIMIT} approved or
 * discarded beneath them.
 *
 * Two reads rather than one capped one, because settled rows accumulate for
 * as long as approved ones are kept: a single newest-first cap would, in time,
 * push a researched item that is still waiting for a decision off the only
 * page that offers the decision.
 */
export async function listIntakeQueue(
  query: { settledLimit?: number } = {},
  options: PendingToolOptions = {}
): Promise<PendingTool[]> {
  const db = options.db ?? (await getDb());
  const [open, settled] = await Promise.all([
    listPendingTools({ statuses: OPEN_PENDING_STATUSES, limit: null }, { db }),
    listPendingTools(
      { statuses: ["approved", "discarded"], limit: query.settledLimit ?? INTAKE_SETTLED_LIMIT },
      { db }
    ),
  ]);
  return [...open, ...settled];
}

// ── Creating ────────────────────────────────────────────────────────

/**
 * Create one batch of identified items (§5.4 step 4), in one transaction.
 *
 * Each item is checked for duplicates against tools and against *other*
 * batches' pending items — the batch's own siblings are not candidates, since
 * they are the table the person is looking at — and the match is stored on the
 * row. Each item then claims its photos; a claim only takes **unowned**
 * uploads **the owner made** — an id copied out of somebody else's chat names
 * a photo this person never sent, and it is not theirs to publish — so the
 * counts say how many of the ids sent actually stuck, and the caller can say
 * so (Article 4).
 */
export async function createPendingBatch(
  input: { createdBy: string; items: NewPendingTool[] },
  options: CreatePendingBatchOptions = {}
): Promise<CreatedPendingBatch> {
  const names = input.items.map((item) => item.name.trim());
  if (names.some((name) => !name)) throw new Error("createPendingBatch: every item needs a name");

  const db = options.db ?? (await getDb());
  const batchId = options.batchId ?? crypto.randomUUID();
  const withinBatch = options.checkWithinBatch === true;

  return db.transaction(async (tx) => {
    // The chat's batch is checked up front against everything but itself; an
    // import's rows one at a time, each against the rows inserted before it.
    const matches = withinBatch
      ? null
      : await findDuplicates(
          input.items.map((item, index) => ({ name: names[index], brand: item.brand })),
          { db: tx, excludeBatchId: batchId }
        );

    const created: CreatedPendingBatch["items"] = [];
    // One insert per item, so `created` is in the caller's order by
    // construction rather than by Postgres' habit.
    for (const [index, item] of input.items.entries()) {
      const match = matches
        ? matches[index]
        : await findDuplicate({ name: names[index], brand: item.brand }, { db: tx });
      const imported = item.imported;
      const [row] = await tx
        .insert(pendingTools)
        .values({
          batchId,
          status: "identified",
          name: names[index],
          brand: emptyToNull(item.brand),
          categoryHint: emptyToNull(item.categoryHint),
          locationHint: emptyToNull(item.locationHint),
          serialNumber: emptyToNull(item.serialNumber),
          duplicateOfToolId: match?.kind === "tool" ? match.id : null,
          duplicateOfPendingId: match?.kind === "pending" ? match.id : null,
          // A similar name is a hint, stored as "It's a different tool" (research fixes amendment 2026-09-24).
          duplicateResolution: initialResolution(match),
          createdBy: input.createdBy,
          ...(imported
            ? {
                importId: imported.importId,
                sourceRow: imported.sourceRow,
                quantity: clampQuantity(imported.quantity, imported.serials.length),
                serials: imported.serials,
                labDocs: imported.labDocs,
                links: imported.links,
                notes: imported.notes,
              }
            : {}),
        })
        .returning({ id: pendingTools.id });

      const submitted = [...new Set(item.attachmentIds ?? [])];
      const attached = await claimAttachments(
        tx,
        submitted,
        { ownerType: "pending_tool", ownerId: row.id },
        { uploadedBy: input.createdBy }
      );
      created.push({ id: row.id, photosSubmitted: submitted.length, photosAttached: attached });
    }

    return { batchId, items: created };
  });
}

// ── Editing and discarding ──────────────────────────────────────────

/**
 * Edit an item's name, hints or duplicate decision (§5.4 step 5 —
 * `PATCH /api/pending-tools/[id]`, never the model).
 *
 * - Only in {@link EDITABLE_PENDING_STATUSES}. A queued or researching item is
 *   `not_editable`: its name is what the workflow is researching right now.
 * - A resolution of `discard` discards the item, exactly as
 *   {@link discardPendingTool} does.
 * - A name or brand change re-runs the duplicate check. If it now matches
 *   something else (or nothing), the stored match changes and the old
 *   decision is cleared — it answered a question nobody is asking any more.
 * - `add_unit` needs a matched **tool**; without one it is `invalid_field`.
 */
export async function updatePendingTool(
  id: string,
  patch: PendingToolPatch,
  options: PendingToolOptions = {}
): Promise<PendingToolWriteResult> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  if (patch.duplicateResolution === "discard") {
    const discarded = await discardPendingTool(id, options);
    return discarded.ok ? { ok: true, item: discarded.item } : discarded;
  }

  const values = toPatchValues(patch);
  if (!values) return { ok: false, reason: "invalid_field" };

  const db = options.db ?? (await getDb());
  const outcome = await db.transaction(async (tx): Promise<{ ok: true } | Refused<"not_found" | "not_editable" | "invalid_field">> => {
    const [row] = await tx
      .select({
        status: pendingTools.status,
        batchId: pendingTools.batchId,
        importId: pendingTools.importId,
        name: pendingTools.name,
        brand: pendingTools.brand,
        duplicateOfToolId: pendingTools.duplicateOfToolId,
        duplicateOfPendingId: pendingTools.duplicateOfPendingId,
        duplicateResolution: pendingTools.duplicateResolution,
        serials: pendingTools.serials,
      })
      .from(pendingTools)
      .where(eq(pendingTools.id, id))
      .for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (values.quantity !== undefined && values.quantity < row.serials.length) {
      return { ok: false, reason: "invalid_field" };
    }
    if (!isOneOf(EDITABLE_PENDING_STATUSES, row.status)) return { ok: false, reason: "not_editable" };

    let duplicateOfToolId = row.duplicateOfToolId;
    let duplicateOfPendingId = row.duplicateOfPendingId;
    let resolution = (row.duplicateResolution as DuplicateResolution | null) ?? null;
    if (values.duplicateResolution !== undefined) resolution = values.duplicateResolution;

    const nameChanged = values.name !== undefined && values.name !== row.name;
    const brandChanged = values.brand !== undefined && values.brand !== row.brand;
    if (nameChanged || brandChanged) {
      // An imported item is checked against its own import's other rows too
      // (bulk intake spec §3.3: accepting a suggested name re-runs the check).
      const match = await findDuplicate(
        { name: values.name ?? row.name, brand: values.brand !== undefined ? values.brand : row.brand },
        { db: tx, excludePendingIds: [id], ...(row.importId ? {} : { excludeBatchId: row.batchId }) }
      );
      const nextTool = match?.kind === "tool" ? match.id : null;
      const nextPending = match?.kind === "pending" ? match.id : null;
      if (nextTool !== duplicateOfToolId || nextPending !== duplicateOfPendingId) {
        duplicateOfToolId = nextTool;
        duplicateOfPendingId = nextPending;
        resolution = initialResolution(match);
      }
    }

    if (resolution === "add_unit" && !duplicateOfToolId) return { ok: false, reason: "invalid_field" };

    const { clearNameSuggestion, ...columns } = values;
    await tx
      .update(pendingTools)
      .set({
        ...columns,
        ...(clearNameSuggestion ? { nameSuggestion: null } : {}),
        duplicateOfToolId,
        duplicateOfPendingId,
        duplicateResolution: resolution,
      })
      .where(and(eq(pendingTools.id, id), inArray(pendingTools.status, [...EDITABLE_PENDING_STATUSES])));
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  const item = await getPendingTool(id, { db });
  if (!item) return { ok: false, reason: "not_found" };
  return { ok: true, item };
}

/**
 * Discard an item and let go of its photos.
 *
 * Allowed from `identified`, `researched` and `failed`, and from `queued` while
 * no workflow run holds it (the items a failed start left behind). Once a run
 * holds it, the run is the one writing to it; discarding underneath would race
 * the research write, so it is `not_editable` until the run is done.
 *
 * The photos are **released**, not deleted — the daily cron's orphan sweep
 * deletes the bytes, with the retry behaviour that path already has.
 */
export async function discardPendingTool(
  id: string,
  options: PendingToolOptions = {}
): Promise<DiscardResult> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());

  const outcome = await db.transaction(async (tx): Promise<{ ok: true; released: number } | Refused<"not_found" | "not_editable">> => {
    const rows = await tx
      .update(pendingTools)
      .set({ status: "discarded" })
      .where(
        and(
          eq(pendingTools.id, id),
          sql`(${pendingTools.status} in ('identified', 'researched', 'failed')
               or (${pendingTools.status} = 'queued' and ${pendingTools.workflowRunId} is null))`
        )
      )
      .returning({ id: pendingTools.id });
    if (rows.length === 0) {
      return (await exists(tx, id)) ? { ok: false, reason: "not_editable" } : { ok: false, reason: "not_found" };
    }
    const released = await releaseAttachments(tx, { ownerType: "pending_tool", ownerId: id });
    return { ok: true, released };
  });

  if (!outcome.ok) return outcome;
  const item = await getPendingTool(id, { db });
  if (!item) return { ok: false, reason: "not_found" };
  return { ok: true, item, released: outcome.released };
}

// ── Research lifecycle ──────────────────────────────────────────────

/**
 * Move the researchable ones among `ids` to `queued`, and return the ids that
 * actually moved, in the order given.
 *
 * Researchable is `isResearchable` from `intake/access.ts`, restated in SQL so
 * the check and the move are one statement, with two refinements:
 *
 * - **`add_unit` items never queue** — they skip research ({@link markReadyAsUnit}).
 * - **A `queued` item with no run is taken over only if it is stale**: its
 *   start failed and said so (`research_error`), or it has sat for
 *   `RESEARCH_START_STALE_MS`. Otherwise it belongs to a request that is
 *   between this statement and `start()` right now, and taking it would start
 *   a second run for the same item. A second call with the same ids therefore
 *   moves nothing.
 *
 * Every moved row is stamped with `requestId` — the research steps write only
 * while the row is still their request's — and gets one `research_requests`
 * row, in the same transaction, which is what the daily allowance counts.
 * `requestId` defaults to a fresh one for callers that start no run.
 */
export async function queueForResearch(
  ids: string[],
  by: { requestedBy: string; requestId?: string },
  options: PendingToolOptions = {}
): Promise<string[]> {
  const candidates = uuids(ids);
  if (candidates.length === 0) return [];
  const db = options.db ?? (await getDb());
  const requestId = by.requestId ?? crypto.randomUUID();
  return db.transaction((tx) => queueRows(tx, candidates, { requestedBy: by.requestedBy, requestId }));
}

export type QueueWithinAllowanceResult =
  | { ok: true; queued: string[] }
  | { ok: false; reason: "daily_limit"; remaining: number };

/**
 * {@link queueForResearch} behind the daily allowance (§5.4 step 6, §8), as one
 * decision: the count and the move happen in one transaction that first takes
 * a **per-person advisory lock**, so two presses at once are served one after
 * the other and the second counts what the first queued. Checking first and
 * queueing after, outside a lock, let four simultaneous presses each see the
 * same count and together pass the limit.
 *
 * `daily_limit` when `ids.length` more would pass `limit` — counted against
 * what was asked for, before anything moves, so a refusal moves nothing.
 */
export async function queueForResearchWithinAllowance(
  ids: string[],
  by: { requestedBy: string; requestId: string; limit: number; since: Date },
  options: PendingToolOptions = {}
): Promise<QueueWithinAllowanceResult> {
  const candidates = uuids(ids);
  // Nothing to research costs nothing, whatever today's count.
  if (candidates.length === 0) return { ok: true, queued: [] };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<QueueWithinAllowanceResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${by.requestedBy}`}))`);
    const used = await countResearchRequestedSince(by.requestedBy, by.since, { db: tx });
    if (used + candidates.length > by.limit) {
      return { ok: false, reason: "daily_limit", remaining: Math.max(0, by.limit - used) };
    }
    return { ok: true, queued: await queueRows(tx, candidates, by) };
  });
}

/** The move and its ledger rows; the caller holds the transaction. */
async function queueRows(
  tx: Db,
  candidates: string[],
  by: { requestedBy: string; requestId: string }
): Promise<string[]> {
  const rows = await tx
    .update(pendingTools)
    .set({
      status: "queued",
      researchRequestId: by.requestId,
      researchRequestedBy: by.requestedBy,
      researchRequestedAt: sql`now()`,
      researchError: null,
      workflowRunId: null,
    })
    .where(
      and(
        inArray(pendingTools.id, candidates),
        researchablePredicate(),
        sql`${pendingTools.duplicateResolution} is distinct from 'add_unit'`
      )
    )
    .returning({ id: pendingTools.id });

  const queued = inGivenOrder(candidates, rows);
  if (queued.length > 0) {
    await tx.insert(researchRequests).values(
      queued.map((pendingToolId) => ({
        requestId: by.requestId,
        userId: by.requestedBy,
        pendingToolId,
      }))
    );
  }
  return queued;
}

/**
 * Settle the `add_unit` items among `ids` without research (§5.4 step 8): they
 * become `researched` with no result, because the tool they join already has
 * one. Only items that actually matched a tool move.
 */
export async function markReadyAsUnit(
  ids: string[],
  by: { requestedBy: string },
  options: PendingToolOptions = {}
): Promise<string[]> {
  const candidates = uuids(ids);
  if (candidates.length === 0) return [];
  const db = options.db ?? (await getDb());

  const rows = await db
    .update(pendingTools)
    .set({
      status: "researched",
      research: null,
      researchError: null,
      workflowRunId: null,
      researchRequestedBy: by.requestedBy,
      researchRequestedAt: sql`now()`,
    })
    .where(
      and(
        inArray(pendingTools.id, candidates),
        eq(pendingTools.duplicateResolution, "add_unit"),
        isNotNull(pendingTools.duplicateOfToolId),
        researchablePredicate()
      )
    )
    .returning({ id: pendingTools.id });

  return inGivenOrder(candidates, rows);
}

/**
 * Record which workflow run holds these items. Only fills an empty slot, so a
 * late write cannot overwrite a newer run's id.
 */
export async function setWorkflowRun(
  ids: string[],
  runId: string,
  options: PendingToolOptions = {}
): Promise<void> {
  const candidates = uuids(ids);
  if (candidates.length === 0) return;
  const db = options.db ?? (await getDb());
  await db
    .update(pendingTools)
    .set({ workflowRunId: runId })
    .where(and(inArray(pendingTools.id, candidates), sql`${pendingTools.workflowRunId} is null`));
}

/**
 * `start()` threw (§5.4 unhappy paths). The items stay `queued` with no run and
 * the reason in `research_error`, which is also what makes them retryable by
 * the next Research press (see {@link queueForResearch}).
 */
export async function recordStartFailure(
  ids: string[],
  message: string,
  options: PendingToolOptions = {}
): Promise<void> {
  const candidates = uuids(ids);
  if (candidates.length === 0) return;
  const db = options.db ?? (await getDb());
  await db
    .update(pendingTools)
    .set({ researchError: capError(message) })
    .where(
      and(
        inArray(pendingTools.id, candidates),
        eq(pendingTools.status, "queued"),
        sql`${pendingTools.workflowRunId} is null`
      )
    );
}

/**
 * How many items `userId` has sent to research since `since` — the daily
 * allowance (§8). Counted from the `research_requests` ledger, so every press
 * counts: an item researched five times costs five. Add-unit items cost
 * nothing and are never in the ledger.
 */
export async function countResearchRequestedSince(
  userId: string,
  since: Date,
  options: PendingToolOptions = {}
): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ n: count() })
    .from(researchRequests)
    .where(and(eq(researchRequests.userId, userId), gte(researchRequests.requestedAt, since)));
  return Number(row?.n ?? 0);
}

/**
 * The research step's first write: `queued` → `researching`. Null when the
 * row is not queued any more — discarded while it waited, most likely — or,
 * with `requestId`, when a later press has taken the row over; either tells
 * the step to stop without writing anything.
 */
export async function markResearching(
  id: string,
  options: ResearchWriteOptions = {}
): Promise<PendingTool | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(pendingTools)
    .set({ status: "researching", researchError: null })
    .where(and(eq(pendingTools.id, id), eq(pendingTools.status, "queued"), ownRequest(options.requestId)))
    .returning({ id: pendingTools.id });
  if (rows.length === 0) return null;
  return getPendingTool(id, { db });
}

/**
 * `researching` → `researched`, with the result. The result is validated here
 * as well as by its producer — **throws** on an invalid one, because a step
 * holding output that does not parse has a bug, not a finding. False when the
 * row is not `researching` (discarded meanwhile): research writes only to the
 * row it was given, and only while that row is waiting for it (§8).
 *
 * **A redo lands on the result it replaces** (amendment "Guided redo"): the row
 * is read `for update` and `mergeResearch` (`research/focus-merge.ts`) decides
 * what is written — with a `focus`, only the focused fields of `result` over
 * the stored ones; without, `result` whole. Either way the saved name and brand
 * are recorded (`researchedAs`), and the sections that changed (`updated`).
 */
export async function completeResearch(
  id: string,
  result: ResearchResult,
  options: ResearchWriteOptions & { focus?: ResearchFocus; now?: Date } = {}
): Promise<boolean> {
  researchResultSchema.parse(result);
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  const at = (options.now ?? new Date()).toISOString();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ name: pendingTools.name, brand: pendingTools.brand, research: pendingTools.research })
      .from(pendingTools)
      .where(and(eq(pendingTools.id, id), eq(pendingTools.status, "researching"), ownRequest(options.requestId)))
      .for("update");
    if (!row) return false;
    const merged = mergeResearch({
      previous: row.research == null ? null : parseResearchResult(row.research),
      next: result,
      focus: options.focus ?? null,
      saved: { name: row.name, brand: row.brand },
      at,
    });
    const rows = await tx
      .update(pendingTools)
      .set({ status: "researched", research: researchResultSchema.parse(merged), researchError: null })
      .where(and(eq(pendingTools.id, id), eq(pendingTools.status, "researching"), ownRequest(options.requestId)))
      .returning({ id: pendingTools.id });
    return rows.length > 0;
  });
}

/**
 * Mark the stored result with the **Research again** just queued for it
 * (`research.redoRequest`), so the page can say what is being redone while it
 * runs. Only while the row is `queued` under `requestId` and holds a result;
 * false otherwise. The redo's own write drops the marker.
 */
export async function markRedoRequest(
  id: string,
  redo: { requestId: string; focus: ResearchFocus; now?: Date },
  options: PendingToolOptions = {}
): Promise<boolean> {
  if (!isUuid(id) || !isUuid(redo.requestId)) return false;
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ research: pendingTools.research })
      .from(pendingTools)
      .where(
        and(eq(pendingTools.id, id), eq(pendingTools.status, "queued"), eq(pendingTools.researchRequestId, redo.requestId))
      )
      .for("update");
    const research = row?.research == null ? null : parseResearchResult(row.research);
    if (!research) return false;
    const focus: ResearchFocusField[] = redo.focus ? [...redo.focus] : [];
    const next: ResearchResult = {
      ...research,
      redoRequest: { requestId: redo.requestId, requestedAt: (redo.now ?? new Date()).toISOString(), focus },
    };
    await tx
      .update(pendingTools)
      .set({ research: researchResultSchema.parse(next) })
      .where(eq(pendingTools.id, id));
    return true;
  });
}

/**
 * `queued` or `researching` → `failed`, with why. `research_error` is the
 * diagnosis record (2026-09-22 amendment); capped so a stack trace cannot
 * become a column nobody can read.
 */
export async function failResearch(
  id: string,
  message: string,
  options: ResearchWriteOptions = {}
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(pendingTools)
    .set({ status: "failed", researchError: capError(message) })
    .where(
      and(
        eq(pendingTools.id, id),
        inArray(pendingTools.status, ["queued", "researching"]),
        ownRequest(options.requestId)
      )
    )
    .returning({ id: pendingTools.id });
  return rows.length > 0;
}

/**
 * The daily cron's cleanup (§4.10): items left `identified` since before
 * `olderThan` are discarded and their photos released for the orphan sweep.
 * Only `identified` — anything researched is somebody's pending decision, and
 * a cron does not make it for them.
 */
export async function expireIdentifiedPendingTools(
  olderThan: Date,
  options: PendingToolOptions = {}
): Promise<{ discarded: string[]; releasedAttachments: number }> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(pendingTools)
      .set({ status: "discarded" })
      .where(and(eq(pendingTools.status, "identified"), lt(pendingTools.createdAt, olderThan)))
      .returning({ id: pendingTools.id });
    const discarded = rows.map((row) => row.id);
    if (discarded.length === 0) return { discarded, releasedAttachments: 0 };

    const released = await tx
      .update(attachments)
      .set({ ownerType: null, ownerId: null, position: 0 })
      .where(and(eq(attachments.ownerType, "pending_tool"), inArray(attachments.ownerId, discarded)))
      .returning({ id: attachments.id });
    return { discarded, releasedAttachments: released.length };
  });
}

/** The `research_error` an abandoned run leaves (see {@link failAbandonedResearch}). */
export const ABANDONED_RESEARCH_MESSAGE =
  "Research did not finish within a day, so it was stopped. Research it again.";

/** The `research_error` a start that never happened leaves, when none was recorded. */
export const ABANDONED_START_MESSAGE =
  "Research was queued but never started, so it was stopped. Research it again.";

/**
 * The daily cron's other cleanup: items research took and never let go.
 *
 * A row is `researching`, or `queued` with a run id, only while a run owns it,
 * and neither status is researchable, editable or discardable — so a run that
 * is abandoned for good (the SDK normally resumes or fails runs; this is the
 * case where it did neither) would strand the item forever. Research requested
 * before `olderThan` and still in one of those two states moves to `failed`
 * with {@link ABANDONED_RESEARCH_MESSAGE}, which a person can research again or
 * discard. A step that does wake up later finds the row `failed`, and every
 * write it could make is conditional on `researching`, so it writes nothing.
 *
 * A `queued` row with **no** run id that old is a start that never happened —
 * the request died between queueing and `start()`, or `start()` threw and the
 * failure could not even be recorded. The intake page already offers Retry for
 * it after `RESEARCH_START_STALE_MS`; this makes it `failed` too, keeping the
 * start failure's own reason when there is one, so nothing sits `queued` for
 * good.
 */
export async function failAbandonedResearch(
  olderThan: Date,
  options: PendingToolOptions = {}
): Promise<string[]> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const held = await tx
      .update(pendingTools)
      .set({ status: "failed", researchError: ABANDONED_RESEARCH_MESSAGE })
      .where(
        and(
          lt(pendingTools.researchRequestedAt, olderThan),
          sql`(${pendingTools.status} = 'researching' or (${pendingTools.status} = 'queued' and ${pendingTools.workflowRunId} is not null))`
        )
      )
      .returning({ id: pendingTools.id });
    const neverStarted = await tx
      .update(pendingTools)
      .set({
        status: "failed",
        researchError: sql`coalesce(${pendingTools.researchError}, ${ABANDONED_START_MESSAGE})`,
      })
      .where(
        and(
          lt(pendingTools.researchRequestedAt, olderThan),
          eq(pendingTools.status, "queued"),
          sql`${pendingTools.workflowRunId} is null`
        )
      )
      .returning({ id: pendingTools.id });
    return [...held, ...neverStarted].map((row) => row.id);
  });
}

/**
 * The daily cron's deletion of discarded items (§8 PII: "discarded pending
 * items ... are deleted on schedule"). Items discarded — by a person, or by
 * {@link expireIdentifiedPendingTools} — before `olderThan` are deleted, so the
 * name and the owner they carry do not outlive the decision to throw them away.
 *
 * Discarding already released the photos; any a row still somehow owns are
 * released here first, in the same transaction, so the orphan sweep collects
 * them rather than their pointing at a row that is gone. `updated_at` is when
 * the row was discarded: nothing edits a discarded row.
 */
export async function deleteDiscardedPendingTools(
  olderThan: Date,
  options: PendingToolOptions = {}
): Promise<{ deleted: number; releasedAttachments: number }> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const doomed = await tx
      .select({ id: pendingTools.id })
      .from(pendingTools)
      .where(and(eq(pendingTools.status, "discarded"), lt(pendingTools.updatedAt, olderThan)))
      .for("update");
    const ids = doomed.map((row) => row.id);
    if (ids.length === 0) return { deleted: 0, releasedAttachments: 0 };

    const released = await tx
      .update(attachments)
      .set({ ownerType: null, ownerId: null, position: 0 })
      .where(and(eq(attachments.ownerType, "pending_tool"), inArray(attachments.ownerId, ids)))
      .returning({ id: attachments.id });
    const deleted = await tx
      .delete(pendingTools)
      .where(and(inArray(pendingTools.id, ids), eq(pendingTools.status, "discarded")))
      .returning({ id: pendingTools.id });
    return { deleted: deleted.length, releasedAttachments: released.length };
  });
}

/**
 * Photos still owned by a pending item that no longer exists, released for the
 * orphan sweep. `pending_tools.created_by` cascades (§4.10: a pending item
 * always has an owner), so removing a person removes their pending items — and
 * `attachments.owner_id` is polymorphic, with no foreign key to cascade or
 * null. Without this, those photos (public, once identified) would be owned by
 * nothing and swept by nothing, for ever.
 */
export async function releasePhotosOfMissingPendingTools(options: PendingToolOptions = {}): Promise<number> {
  const db = options.db ?? (await getDb());
  const rows = await rawRows<{ id: string }>(
    db,
    sql`
      update attachments a
         set owner_type = null, owner_id = null, position = 0
       where a.owner_type = 'pending_tool'
         and not exists (select 1 from pending_tools p where p.id = a.owner_id)
      returning a.id
    `
  );
  return rows.length;
}

// ── Approving ───────────────────────────────────────────────────────

/**
 * A refusal on its way out of a transaction that must not commit. The field is
 * declared rather than a parameter property: `scripts/` load this module under
 * Node's strip-only TypeScript, which has no parameter properties.
 */
class Refusal<R extends WriteRefusal> extends Error {
  readonly reason: R;

  constructor(reason: R) {
    super(`pending tool write refused: ${reason}`);
    this.name = "Refusal";
    this.reason = reason;
  }
}

/**
 * **Approve** / **Approve as draft** (§5.4 step 11) — the one human decision
 * Article 5 requires before research becomes a tool.
 *
 * One transaction, the pending row locked `FOR UPDATE` first so a second
 * approval waits and then finds the row already `approved` (`not_editable`):
 *
 * 1. The row must be `researched`, not an add-unit item, with research that
 *    parses. A `low` grade needs a non-blank `overrideNote` — the "I've checked
 *    this" gate — or it is `low_confidence`.
 * 2. The category (existing, or found-or-created from `newCategory`) and the
 *    location must exist; the chosen resource URLs must be ones research
 *    verified.
 * 3. The tool, its one unit ("<name> #1") and those resources, through
 *    {@link createToolRecord}.
 * 4. The product image (gateway spec §5.2 step 3): every background-removed
 *    copy the item holds **except the chosen cover** is released for the orphan
 *    sweep; the cover, when there is one, becomes the tool's at position 0.
 * 5. The photos re-owned from the pending item to the tool, order kept, after
 *    the cover — so a chosen image is the cover and an uploaded photo is next.
 * 6. The row marked `approved`, with who, when, the note and what it created.
 *
 * Anything thrown along the way rolls every step back, photos included. No
 * audit event and no cache invalidation here — the caller does both, after
 * this commits.
 */
export async function approvePendingTool(
  input: ApprovePendingInput,
  options: PendingToolOptions = {}
): Promise<ApprovePendingResult> {
  if (!isUuid(input.id)) return { ok: false, reason: "not_found" };
  const fields = input.fields;
  const name = fields.name.trim();
  if (!name) return { ok: false, reason: "invalid_field" };
  // The display name's hard cap (tool display names spec §5.1); the page's box holds to it.
  if (name.length > DISPLAY_NAME_MAX) return { ok: false, reason: "invalid_field" };
  if (fields.categoryId !== null && !isUuid(fields.categoryId)) return { ok: false, reason: "invalid_field" };
  if (fields.locationId !== null && !isUuid(fields.locationId)) return { ok: false, reason: "invalid_field" };
  if (fields.categoryId === null && fields.newCategory && !fields.newCategory.name.trim()) {
    return { ok: false, reason: "invalid_field" };
  }

  const db = options.db ?? (await getDb());
  try {
    return await db.transaction(async (tx) => {
      const row = await lockPending(tx, input.id);
      if (!row) throw new Refusal("not_found");
      if (row.status !== "researched" || row.duplicateResolution === "add_unit") {
        throw new Refusal("not_editable");
      }
      const research = parseResearchResult(row.research);
      if (!research) throw new Refusal("not_editable");

      const note = input.overrideNote?.trim() || null;
      const overridden = research.confidence.level === "low";
      if (overridden && !note) throw new Refusal("low_confidence");

      const chosen = chooseResources(research, fields.resourceUrls);
      if (!chosen) throw new Refusal("invalid_field");
      // An import's own links, as the approver kept them, and its lab documents,
      // which always come along (bulk intake spec §3.4). A kept URL the item
      // never had is a shape error, like an unverified research link.
      const itemLinks = row.links ?? [];
      if (fields.importLinkUrls?.some((url) => !itemLinks.some((link) => link.url === url))) {
        throw new Refusal("invalid_field");
      }
      const extra = importApprovalResources(
        { links: itemLinks, labDocs: row.labDocs ?? [], keepLinkUrls: fields.importLinkUrls },
        chosen.map((resource) => resource.url)
      );

      let categoryId = fields.categoryId;
      if (categoryId) {
        const [found] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId));
        if (!found) throw new Refusal("invalid_field");
      } else if (fields.newCategory) {
        categoryId = (await findOrCreateCategory(tx, fields.newCategory)).id;
      }
      if (fields.locationId) {
        const [found] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, fields.locationId));
        if (!found) throw new Refusal("invalid_field");
      }

      const created = await createToolRecord(
        tx,
        {
          name,
          // Blank, or the display name spelled again, is stored as none (`createToolRecord`).
          officialName: fields.officialName ?? null,
          description: fields.description,
          categoryId,
          locationId: fields.locationId,
          materials: fields.materials,
          ppeRequired: fields.ppeRequired,
          tags: fields.tags,
          trainingRequired: fields.trainingRequired,
          useRestrictions: fields.useRestrictions,
          // Research's proposal, as it stands; staff edit it in the tool editor afterwards.
          starterQuestions: research.starterQuestions ?? [],
          published: input.publish,
          // One unit, or as many as an import's quantity and serials say —
          // "Quantity 5" is five units of one tool, never five tools (§10).
          units: approvalUnits(name, row.quantity, row.serials ?? [], fields.serialNumber),
          resources: [...chosen, ...extra],
        },
        input.actorUserId
      );
      // The lab's documents are never fetched: not archived, not read (§3.4).
      // `resourceIds` is in the order given, research's first.
      const fetchable = created.resourceIds.filter(
        (_, index) => index < chosen.length || extra[index - chosen.length]?.origin !== "lab_document"
      );

      const coverId = input.coverAttachmentId ?? null;
      await releaseUnchosenCleaned(tx, input.id, coverId);
      const coverAttached = coverId ? await takeCover(tx, input.id, created.toolId, coverId) : false;

      const photosMoved = await reownAttachments(
        tx,
        { ownerType: "pending_tool", ownerId: input.id },
        { ownerType: "tool", ownerId: created.toolId }
      );

      const unitId = created.unitIds[0] ?? null;
      await markApproved(tx, input.id, {
        actorUserId: input.actorUserId,
        note,
        toolId: created.toolId,
        unitId,
      });

      return {
        ok: true as const,
        toolId: created.toolId,
        slug: created.slug,
        unitId,
        resourcesCreated: created.resourceIds.length,
        resourceIds: fetchable,
        photosMoved,
        published: input.publish,
        overridden,
        coverAttached,
      };
    });
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, reason: err.reason as "not_found" | "not_editable" | "low_confidence" | "invalid_field" };
    }
    throw err;
  }
}

/**
 * **Add unit** (§5.4 step 11) — an add-unit item becomes another unit of the
 * tool it matched, labelled "<tool name> #<n+1>", with the item's photos
 * appended to that tool's.
 *
 * `serialNumber` overrides the one stored on the item when given. A serial the
 * tool already has is `duplicate_serial` — `units_tool_serial_key` is the
 * arbiter, and its violation rolls the whole approval back. The row records
 * the tool it joined as `created_tool_id`, so the review page can link to it.
 */
export async function approvePendingAsUnit(
  input: { id: string; actorUserId: string; serialNumber?: string | null },
  options: PendingToolOptions = {}
): Promise<ApproveAsUnitResult> {
  if (!isUuid(input.id)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());

  try {
    return await db.transaction(async (tx) => {
      const row = await lockPending(tx, input.id);
      if (!row) throw new Refusal("not_found");
      if (row.status !== "researched" || row.duplicateResolution !== "add_unit") {
        throw new Refusal("not_editable");
      }
      if (!row.duplicateOfToolId) throw new Refusal("invalid_field");

      const [tool] = await tx
        .select({ id: tools.id, slug: tools.slug, name: tools.name, published: tools.published })
        .from(tools)
        .where(eq(tools.id, row.duplicateOfToolId))
        .for("update");
      if (!tool) throw new Refusal("invalid_field");

      const [{ n }] = await tx.select({ n: count() }).from(units).where(eq(units.toolId, tool.id));
      const serialNumber =
        input.serialNumber !== undefined ? emptyToNull(input.serialNumber) : row.serialNumber;

      // As many units as the item's quantity says (bulk intake spec §3.2) —
      // one for anything the chat identified.
      const inserted = await tx
        .insert(units)
        .values(
          approvalUnits(tool.name, row.quantity, row.serials ?? [], serialNumber, Number(n) + 1).map((unit) => ({
            toolId: tool.id,
            unitLabel: unit.unitLabel,
            serialNumber: unit.serialNumber,
            status: "available" as const,
            createdBy: input.actorUserId,
            updatedBy: input.actorUserId,
          }))
        )
        .returning({ id: units.id });
      const unit = inserted[0];

      // The lab's documents for this machine join the tool it is a unit of,
      // unless it already links them (§3.4); never fetched.
      const docs = row.labDocs ?? [];
      if (docs.length > 0) {
        const existing = await tx.select({ url: resources.url }).from(resources).where(eq(resources.toolId, tool.id));
        const fresh = importApprovalResources({ links: [], labDocs: docs }, existing.flatMap((r) => (r.url ? [r.url] : [])));
        if (fresh.length > 0) {
          await tx.insert(resources).values(
            fresh.map((doc) => ({
              toolId: tool.id,
              title: doc.title,
              url: doc.url,
              type: doc.type,
              origin: doc.origin ?? null,
              createdBy: input.actorUserId,
              updatedBy: input.actorUserId,
            }))
          );
        }
      }

      // A unit has no cover to choose, so a background-removed copy research
      // made for this item is never kept: it is an AI redraw nobody picked, and
      // re-owning it would publish it as a photo of an existing tool. Released
      // for the orphan sweep, as approval does with every unchosen copy.
      await releaseUnchosenCleaned(tx, input.id, null);

      const photosMoved = await reownAttachments(
        tx,
        { ownerType: "pending_tool", ownerId: input.id },
        { ownerType: "tool", ownerId: tool.id }
      );

      await markApproved(tx, input.id, {
        actorUserId: input.actorUserId,
        note: null,
        toolId: tool.id,
        unitId: unit.id,
      });

      // Read under the lock, inside the transaction: the caller needs it after
      // the commit, when a failed read could no longer be told apart from a
      // failed approval (Article 4).
      return {
        ok: true as const,
        toolId: tool.id,
        slug: tool.slug,
        unitId: unit.id,
        photosMoved,
        published: tool.published,
      };
    });
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, reason: err.reason as "not_found" | "not_editable" | "invalid_field" };
    }
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate_serial" };
    throw err;
  }
}

// ── Internals ───────────────────────────────────────────────────────

/** The row, locked for the rest of the transaction. */
async function lockPending(tx: Db, id: string) {
  const [row] = await tx
    .select({
      status: pendingTools.status,
      duplicateResolution: pendingTools.duplicateResolution,
      duplicateOfToolId: pendingTools.duplicateOfToolId,
      serialNumber: pendingTools.serialNumber,
      research: pendingTools.research,
      quantity: pendingTools.quantity,
      serials: pendingTools.serials,
      labDocs: pendingTools.labDocs,
      links: pendingTools.links,
    })
    .from(pendingTools)
    .where(eq(pendingTools.id, id))
    .for("update");
  return row ?? null;
}

async function markApproved(
  tx: Db,
  id: string,
  done: { actorUserId: string; note: string | null; toolId: string; unitId: string | null }
): Promise<void> {
  const rows = await tx
    .update(pendingTools)
    .set({
      status: "approved",
      approvedBy: done.actorUserId,
      approvedAt: sql`now()`,
      approvalNote: done.note,
      createdToolId: done.toolId,
      createdUnitId: done.unitId,
    })
    .where(and(eq(pendingTools.id, id), eq(pendingTools.status, "researched")))
    .returning({ id: pendingTools.id });
  // The row is locked, so this cannot miss; if it somehow did, the tool must
  // not commit without the row that explains it.
  if (rows.length === 0) throw new Refusal("not_editable");
}

/**
 * Let go of the item's background-removed copies, all but `keep` (gateway
 * spec §5.2 step 3). Released, not deleted: the orphan sweep collects the
 * bytes, as it does for every other photo nobody kept.
 */
async function releaseUnchosenCleaned(tx: Db, pendingId: string, keep: string | null): Promise<void> {
  await tx
    .update(attachments)
    .set({ ownerType: null, ownerId: null, position: 0 })
    .where(
      and(
        eq(attachments.ownerType, "pending_tool"),
        eq(attachments.ownerId, pendingId),
        eq(attachments.origin, "research_image_cleaned"),
        keep && isUuid(keep) ? sql`${attachments.id} <> ${keep}` : undefined
      )
    );
}

/**
 * Make `coverId` the new tool's cover, at position 0, and say whether it
 * worked. Only two kinds of row qualify, which is what keeps this from being a
 * way to annex somebody else's file:
 *
 * - a `research_image` **nobody owns** — the original an admin chose, which
 *   `intake/approval-image.ts` stored moments ago;
 * - this item's own `research_image_cleaned` copy.
 *
 * Runs before the item's photos are re-owned, so they land after it. The tool
 * is new, so position 0 is before everything it has.
 */
async function takeCover(tx: Db, pendingId: string, toolId: string, coverId: string): Promise<boolean> {
  if (!isUuid(coverId)) return false;
  const rows = await tx
    .update(attachments)
    .set({ ownerType: "tool", ownerId: toolId, position: 0 })
    .where(
      and(
        eq(attachments.id, coverId),
        sql`((${attachments.ownerId} is null and ${attachments.origin} = 'research_image')
             or (${attachments.ownerType} = 'pending_tool' and ${attachments.ownerId} = ${pendingId}
                 and ${attachments.origin} = 'research_image_cleaned'))`
      )
    )
    .returning({ id: attachments.id });
  return rows.length > 0;
}

/** The verified resources the reviewer kept, or null when they named one research never verified. */
function chooseResources(
  research: ResearchResult,
  urls: string[] | undefined
): ResearchResult["resources"] | null {
  if (urls === undefined) return research.resources;
  const wanted = new Set(urls);
  const known = new Set(research.resources.map((resource) => resource.url));
  for (const url of wanted) if (!known.has(url)) return null;
  return research.resources.filter((resource) => wanted.has(resource.url));
}

/** The row is still `requestId`'s, or no request was named. */
function ownRequest(requestId: string | undefined): SQL | undefined {
  if (requestId === undefined) return undefined;
  return isUuid(requestId) ? eq(pendingTools.researchRequestId, requestId) : sql`false`;
}

/**
 * `isResearchable` (intake/access.ts) as a WHERE clause, with the stale-start
 * refinement {@link queueForResearch} explains.
 */
function researchablePredicate(): SQL {
  const stale = `${RESEARCH_START_STALE_MS} milliseconds`;
  return sql`(
    (${pendingTools.status} in ('identified', 'researched', 'failed')
      or (${pendingTools.status} = 'queued' and ${pendingTools.workflowRunId} is null
          and (${pendingTools.researchError} is not null
               or ${pendingTools.researchRequestedAt} is null
               or ${pendingTools.researchRequestedAt} < now() - ${stale}::interval)))
    and ${pendingTools.duplicateResolution} is distinct from 'discard'
  )`;
}

async function exists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ id: pendingTools.id }).from(pendingTools).where(eq(pendingTools.id, id));
  return Boolean(row);
}

async function readPendingTools(db: Db, where: SQL | undefined, limit: number | null): Promise<PendingTool[]> {
  const query = db
    .select({ row: pendingTools, createdByName: user.name })
    .from(pendingTools)
    .leftJoin(user, eq(user.id, pendingTools.createdBy))
    .where(where)
    .orderBy(desc(pendingTools.createdAt), asc(pendingTools.batchId), asc(pendingTools.name), asc(pendingTools.id));
  const rows = limit === null ? await query : await query.limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map(({ row }) => row.id);
  const toolIds = unique(rows.map(({ row }) => row.duplicateOfToolId));
  const pendingIds = unique(rows.map(({ row }) => row.duplicateOfPendingId));

  const [matchedTools, matchedPending, photos] = await Promise.all([
    toolIds.length
      ? db
          .select({ id: tools.id, name: tools.name, slug: tools.slug, published: tools.published })
          .from(tools)
          .where(inArray(tools.id, toolIds))
      : Promise.resolve([]),
    pendingIds.length
      ? db
          .select({ id: pendingTools.id, name: pendingTools.name, status: pendingTools.status })
          .from(pendingTools)
          .where(inArray(pendingTools.id, pendingIds))
      : Promise.resolve([]),
    db
      .select({
        ownerId: attachments.ownerId,
        attachmentId: attachments.id,
        url: attachments.publicUrl,
        filename: attachments.originalFilename,
        position: attachments.position,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, "pending_tool"),
          inArray(attachments.ownerId, ids),
          // The cleaned copy is a research candidate, not a photo (see PendingPhoto).
          sql`${attachments.origin} is distinct from 'research_image_cleaned'`
        )
      )
      .orderBy(asc(attachments.position), asc(attachments.id)),
  ]);

  const toolById = new Map(matchedTools.map((tool) => [tool.id, tool]));
  const pendingById = new Map(matchedPending.map((item) => [item.id, item]));
  const photosByOwner = new Map<string, PendingPhoto[]>();
  for (const photo of photos) {
    if (!photo.ownerId) continue;
    const list = photosByOwner.get(photo.ownerId) ?? [];
    list.push({
      attachmentId: photo.attachmentId,
      url: photo.url,
      filename: photo.filename,
      position: photo.position,
    });
    photosByOwner.set(photo.ownerId, list);
  }

  return rows.map(({ row, createdByName }) => {
    let duplicateOf: DuplicateOf | null = null;
    const tool = row.duplicateOfToolId ? toolById.get(row.duplicateOfToolId) : undefined;
    const pending = row.duplicateOfPendingId ? pendingById.get(row.duplicateOfPendingId) : undefined;
    if (tool) {
      duplicateOf = { kind: "tool", id: tool.id, name: tool.name, slug: tool.slug, published: tool.published };
    } else if (pending) {
      duplicateOf = {
        kind: "pending",
        id: pending.id,
        name: pending.name,
        status: pending.status as PendingStatus,
      };
    }

    const research = row.research == null ? null : parseResearchResult(row.research);
    const researchError =
      row.researchError ?? (row.research != null && research === null ? INVALID_STORED_RESEARCH : null);

    return {
      id: row.id,
      batchId: row.batchId,
      status: row.status as PendingStatus,
      name: row.name,
      brand: row.brand,
      categoryHint: row.categoryHint,
      locationHint: row.locationHint,
      serialNumber: row.serialNumber,
      duplicateOfToolId: row.duplicateOfToolId,
      duplicateOfPendingId: row.duplicateOfPendingId,
      duplicateResolution: (row.duplicateResolution as DuplicateResolution | null) ?? null,
      research,
      researchError,
      workflowRunId: row.workflowRunId,
      researchRequestId: row.researchRequestId,
      researchRequestedBy: row.researchRequestedBy,
      researchRequestedAt: row.researchRequestedAt,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      approvalNote: row.approvalNote,
      createdToolId: row.createdToolId,
      createdUnitId: row.createdUnitId,
      importId: row.importId,
      sourceRow: row.sourceRow,
      quantity: row.quantity,
      serials: row.serials ?? [],
      labDocs: Array.isArray(row.labDocs) ? row.labDocs : [],
      links: Array.isArray(row.links) ? row.links : [],
      notes: row.notes,
      nameSuggestion: row.nameSuggestion ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      duplicateOf,
      photos: photosByOwner.get(row.id) ?? [],
      createdByName: createdByName ?? null,
    };
  });
}

type PatchValues = {
  name?: string;
  brand?: string | null;
  categoryHint?: string | null;
  locationHint?: string | null;
  serialNumber?: string | null;
  duplicateResolution?: DuplicateResolution | null;
  quantity?: number;
  clearNameSuggestion?: true;
};

/** The patch as column values, or null when a value is not one a field accepts. */
function toPatchValues(patch: PendingToolPatch): PatchValues | null {
  const values: PatchValues = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > MAX_FIELD_LENGTH) return null;
    values.name = name;
  }
  for (const key of ["brand", "categoryHint", "locationHint", "serialNumber"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    const cleaned = emptyToNull(value);
    if (cleaned !== null && cleaned.length > MAX_FIELD_LENGTH) return null;
    values[key] = cleaned;
  }
  if (patch.duplicateResolution !== undefined) {
    if (patch.duplicateResolution !== null && !isOneOf(DUPLICATE_RESOLUTION, patch.duplicateResolution)) {
      return null;
    }
    values.duplicateResolution = patch.duplicateResolution;
  }
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(patch.quantity) || patch.quantity < 1 || patch.quantity > IMPORT_MAX_QUANTITY) return null;
    values.quantity = patch.quantity;
  }
  if (patch.clearNameSuggestion === true) values.clearNameSuggestion = true;
  return values;
}

/** Quantity 1–50 and never fewer than the serials (bulk intake spec §3.2). */
function clampQuantity(quantity: number, serials: number): number {
  const wanted = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  return Math.min(IMPORT_MAX_QUANTITY, Math.max(1, wanted, serials));
}

function uuids(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(isUuid))];
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function inGivenOrder(given: string[], rows: { id: string }[]): string[] {
  const moved = new Set(rows.map((row) => row.id));
  return given.filter((id) => moved.has(id));
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function capError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}
