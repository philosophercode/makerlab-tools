import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { bulkImports, pendingTools, researchRequests, user } from "../db/schema/index.ts";
import type { ImportFormat, ImportSourceKind, ImportStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import type { ColumnMap } from "../import/columns.ts";
import { IMPORT_MAX_LINKS_PER_ITEM, IMPORT_MAX_QUANTITY } from "../import/limits.ts";
import type { ImportItem, NameSuggestion } from "../import/types.ts";
import { claimAttachments } from "./attachments.ts";
import { countResearchRequestedSince, createPendingBatch, EDITABLE_PENDING_STATUSES } from "./pending-tools.ts";
import { isUuid } from "./uuid.ts";
import type { Refused } from "./write-result.ts";

/**
 * `bulk_imports` (bulk intake spec §3.1, §4.1): one imported list, and the
 * writes that turn it into pending items.
 *
 * An import is created holding its text. A table waits in `mapping` until its
 * column matches are confirmed; a plain list gets its rows at once; a
 * document is `parsing` while the model reads it. {@link addImportItems} is the
 * one way rows are made: in one transaction, the import is locked and must
 * still be waiting, every row becomes an **identified** pending item in the
 * import's batch through `createPendingBatch` — the same duplicate check as the
 * chat's, plus each row against the rows before it — and the import becomes
 * `ready` with its counts. A second confirm finds it `ready` and makes nothing.
 *
 * Nothing here researches, approves or publishes (Article 5).
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

export interface BulkImportRecord {
  id: string;
  batchId: string;
  sourceKind: ImportSourceKind;
  format: ImportFormat;
  sourceAttachmentId: string | null;
  sourceName: string | null;
  sourceText: string;
  columnMap: ColumnMap | null;
  status: ImportStatus;
  parseError: string | null;
  rowCount: number;
  itemCount: number;
  duplicateCount: number;
  workflowRunId: string | null;
  /** Null once the person who imported it has been removed. */
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An import as the list on `/admin/intake` shows it: no text, the owner's name
 * — live, or the snapshot written when their account was removed, in which
 * case `createdByRemoved` says so (auth spec amendment 2026-09-25).
 */
export type BulkImportSummary = Omit<BulkImportRecord, "sourceText"> & {
  createdByName: string | null;
  createdByRemoved: boolean;
};

interface Options {
  db?: Db;
}

/** `parse_error` is a short diagnosis, not the document. */
const MAX_ERROR = 500;

// ── Creating and reading ────────────────────────────────────────────

export interface NewBulkImport {
  createdBy: string;
  sourceKind: ImportSourceKind;
  format: ImportFormat;
  sourceName: string | null;
  sourceText: string;
  /** The uploaded file, claimed by the import when it is still the caller's and unowned. */
  sourceAttachmentId?: string | null;
  status: ImportStatus;
}

export async function createBulkImport(input: NewBulkImport, options: Options = {}): Promise<BulkImportRecord> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bulkImports)
      .values({
        batchId: crypto.randomUUID(),
        sourceKind: input.sourceKind,
        format: input.format,
        sourceName: input.sourceName?.slice(0, 200) ?? null,
        sourceText: input.sourceText,
        status: input.status,
        createdBy: input.createdBy,
      })
      .returning();
    const attachmentId = input.sourceAttachmentId;
    if (attachmentId && isUuid(attachmentId)) {
      const claimed = await claimAttachments(
        tx,
        [attachmentId],
        { ownerType: "bulk_import", ownerId: row.id },
        { uploadedBy: input.createdBy }
      );
      if (claimed > 0) {
        const [updated] = await tx
          .update(bulkImports)
          .set({ sourceAttachmentId: attachmentId })
          .where(eq(bulkImports.id, row.id))
          .returning();
        return toRecord(updated);
      }
    }
    return toRecord(row);
  });
}

export async function getBulkImport(id: string, options: Options = {}): Promise<BulkImportRecord | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(bulkImports).where(eq(bulkImports.id, id));
  return row ? toRecord(row) : null;
}

/** The newest imports, for the "Imports" section of `/admin/intake`. */
export async function listBulkImports(query: { limit?: number } = {}, options: Options = {}): Promise<BulkImportSummary[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: bulkImports.id,
      batchId: bulkImports.batchId,
      sourceKind: bulkImports.sourceKind,
      format: bulkImports.format,
      sourceAttachmentId: bulkImports.sourceAttachmentId,
      sourceName: bulkImports.sourceName,
      columnMap: bulkImports.columnMap,
      status: bulkImports.status,
      parseError: bulkImports.parseError,
      rowCount: bulkImports.rowCount,
      itemCount: bulkImports.itemCount,
      duplicateCount: bulkImports.duplicateCount,
      workflowRunId: bulkImports.workflowRunId,
      createdBy: bulkImports.createdBy,
      createdAt: bulkImports.createdAt,
      updatedAt: bulkImports.updatedAt,
      liveCreatorName: user.name,
      snapshotCreatorName: bulkImports.createdByName,
    })
    .from(bulkImports)
    .leftJoin(user, eq(user.id, bulkImports.createdBy))
    .orderBy(desc(bulkImports.createdAt))
    .limit(query.limit ?? 20);
  return rows.map(({ liveCreatorName, snapshotCreatorName, ...row }) => ({
    ...row,
    sourceKind: row.sourceKind as ImportSourceKind,
    format: row.format as ImportFormat,
    status: row.status as ImportStatus,
    columnMap: row.columnMap ?? null,
    createdByName: liveCreatorName ?? snapshotCreatorName ?? null,
    createdByRemoved: row.createdBy === null && snapshotCreatorName !== null,
  }));
}

// ── Rows ────────────────────────────────────────────────────────────

export type AddImportItemsResult =
  | { ok: true; itemCount: number; duplicateCount: number; itemIds: string[] }
  | Refused<"not_found" | "not_editable">;

/**
 * Turn validated items into the import's pending rows and mark it `ready`
 * (or `failed` with `no_items` when there are none). Only from `mapping` or
 * `parsing`: the import row is locked first, so two confirms cannot both make
 * rows.
 */
export async function addImportItems(
  importId: string,
  input: { items: ImportItem[]; rowCount: number; columnMap?: ColumnMap | null },
  options: Options = {}
): Promise<AddImportItemsResult> {
  if (!isUuid(importId)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<AddImportItemsResult> => {
    const [row] = await tx.select().from(bulkImports).where(eq(bulkImports.id, importId)).for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "mapping" && row.status !== "parsing") return { ok: false, reason: "not_editable" };

    if (input.items.length === 0) {
      await tx
        .update(bulkImports)
        .set({ status: "failed", parseError: "no_items", rowCount: input.rowCount, columnMap: input.columnMap ?? row.columnMap })
        .where(eq(bulkImports.id, importId));
      return { ok: true, itemCount: 0, duplicateCount: 0, itemIds: [] };
    }

    const batch = await createPendingBatch(
      {
        createdBy: row.createdBy,
        items: input.items.map((item) => ({
          name: item.name,
          brand: item.brand,
          categoryHint: item.categoryHint,
          locationHint: item.locationHint,
          serialNumber: item.serials[0] ?? null,
          imported: {
            importId,
            sourceRow: item.sourceRow,
            quantity: item.quantity,
            serials: item.serials,
            labDocs: item.labDocs,
            links: item.links,
            notes: item.notes,
          },
        })),
      },
      { db: tx, batchId: row.batchId, checkWithinBatch: true }
    );
    const itemIds = batch.items.map((item) => item.id);
    const [{ duplicates }] = await tx
      .select({ duplicates: sql<number>`count(*)::int` })
      .from(pendingTools)
      .where(
        and(
          inArray(pendingTools.id, itemIds),
          sql`(${pendingTools.duplicateOfToolId} is not null or ${pendingTools.duplicateOfPendingId} is not null)`
        )
      );
    await tx
      .update(bulkImports)
      .set({
        status: "ready",
        parseError: null,
        rowCount: input.rowCount,
        itemCount: itemIds.length,
        duplicateCount: Number(duplicates),
        columnMap: input.columnMap ?? row.columnMap,
      })
      .where(eq(bulkImports.id, importId));
    return { ok: true, itemCount: itemIds.length, duplicateCount: Number(duplicates), itemIds };
  });
}

/** The import could not be read. Only while it is still waiting; the text stays for the page to show. */
export async function failBulkImport(importId: string, error: string, options: Options = {}): Promise<boolean> {
  if (!isUuid(importId)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(bulkImports)
    .set({ status: "failed", parseError: error.slice(0, MAX_ERROR) })
    .where(and(eq(bulkImports.id, importId), inArray(bulkImports.status, ["mapping", "parsing"])))
    .returning({ id: bulkImports.id });
  return rows.length > 0;
}

/** Record the document workflow's run id, for diagnosis. */
export async function setImportWorkflowRun(importId: string, runId: string, options: Options = {}): Promise<void> {
  if (!isUuid(importId)) return;
  const db = options.db ?? (await getDb());
  await db.update(bulkImports).set({ workflowRunId: runId }).where(eq(bulkImports.id, importId));
}

// ── The review table's bulk writes ──────────────────────────────────

export interface ImportHints {
  categoryHint?: string | null;
  locationHint?: string | null;
}

/**
 * **Set category** / **Set location** on many rows at once (§5 step 3). Only
 * rows of this import that are still editable; the ids that changed come
 * back. Hints feed no duplicate check, so nothing is re-checked.
 */
export async function setImportHints(
  importId: string,
  ids: readonly string[],
  hints: ImportHints,
  options: Options = {}
): Promise<string[]> {
  const candidates = [...new Set(ids)].filter(isUuid);
  if (!isUuid(importId) || candidates.length === 0) return [];
  const values: ImportHints = {};
  if (hints.categoryHint !== undefined) values.categoryHint = clean(hints.categoryHint);
  if (hints.locationHint !== undefined) values.locationHint = clean(hints.locationHint);
  if (Object.keys(values).length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(pendingTools)
    .set(values)
    .where(
      and(
        eq(pendingTools.importId, importId),
        inArray(pendingTools.id, candidates),
        inArray(pendingTools.status, [...EDITABLE_PENDING_STATUSES])
      )
    )
    .returning({ id: pendingTools.id });
  return rows.map((row) => row.id);
}

export type MergeResult = { ok: true; quantity: number } | Refused<"not_found" | "not_editable" | "invalid_field">;

/**
 * **Merge into row N** — a row that duplicates an earlier row of the same
 * import is the same machine listed twice: its quantity, serials and links move
 * onto that row, and it is discarded (§2 "Quantities and serials make units").
 * Both rows must belong to the import and be `identified`; the merged quantity
 * is capped at 50 and never below the serials.
 */
export async function mergeImportRows(
  importId: string,
  input: { sourceId: string; targetId: string },
  options: Options = {}
): Promise<MergeResult> {
  if (![importId, input.sourceId, input.targetId].every(isUuid) || input.sourceId === input.targetId) {
    return { ok: false, reason: "invalid_field" };
  }
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<MergeResult> => {
    const rows = await tx
      .select({
        id: pendingTools.id,
        status: pendingTools.status,
        importId: pendingTools.importId,
        quantity: pendingTools.quantity,
        serials: pendingTools.serials,
        labDocs: pendingTools.labDocs,
        links: pendingTools.links,
      })
      .from(pendingTools)
      .where(inArray(pendingTools.id, [input.sourceId, input.targetId]))
      .for("update");
    const source = rows.find((row) => row.id === input.sourceId);
    const target = rows.find((row) => row.id === input.targetId);
    if (!source || !target || source.importId !== importId || target.importId !== importId) {
      return { ok: false, reason: "not_found" };
    }
    if (source.status !== "identified" || target.status !== "identified") return { ok: false, reason: "not_editable" };

    const serials = [...new Set([...target.serials, ...source.serials])].slice(0, IMPORT_MAX_QUANTITY);
    const quantity = Math.min(IMPORT_MAX_QUANTITY, Math.max(target.quantity + source.quantity, serials.length));
    const labDocs = uniqueByUrl([...(target.labDocs ?? []), ...(source.labDocs ?? [])]).slice(0, IMPORT_MAX_LINKS_PER_ITEM);
    const links = uniqueByUrl([...(target.links ?? []), ...(source.links ?? [])]).slice(0, IMPORT_MAX_LINKS_PER_ITEM);

    await tx.update(pendingTools).set({ quantity, serials, labDocs, links }).where(eq(pendingTools.id, target.id));
    await tx
      .update(pendingTools)
      .set({ status: "discarded", duplicateResolution: "discard" })
      .where(and(eq(pendingTools.id, source.id), eq(pendingTools.status, "identified")));
    return { ok: true, quantity };
  });
}

/**
 * Store a Suggest names answer on an item (§3.3). Only while the item is still
 * `identified`: a suggestion for something already researched would be
 * accepted onto a name research has moved past.
 */
export async function setNameSuggestion(
  id: string,
  suggestion: NameSuggestion | null,
  options: Options = {}
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(pendingTools)
    .set({ nameSuggestion: suggestion })
    .where(and(eq(pendingTools.id, id), eq(pendingTools.status, "identified")))
    .returning({ id: pendingTools.id });
  return rows.length > 0;
}

/** The fields the Suggest names step reads — name, brand and the category hint, never the notes (§8 PII). */
export async function getSuggestionInput(
  id: string,
  options: Options = {}
): Promise<{ name: string; brand: string | null; categoryHint: string | null; status: string } | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ name: pendingTools.name, brand: pendingTools.brand, categoryHint: pendingTools.categoryHint, status: pendingTools.status })
    .from(pendingTools)
    .where(eq(pendingTools.id, id));
  return row ?? null;
}

// ── The Suggest names charge ────────────────────────────────────────

export type SuggestChargeResult = { ok: true; charged: number } | { ok: false; reason: "daily_limit"; remaining: number };

/**
 * Charge a Suggest names pass against the research allowance (§3.3: "a quarter
 * of an item each") — `ledgerRows` rows in `research_requests` with no item,
 * counted and inserted under the same per-person lock the research route
 * takes, so a pass and a Research press cannot both squeeze past the ceiling.
 */
export async function chargeSuggestionAllowance(
  input: { userId: string; ledgerRows: number; limit: number; since: Date },
  options: Options = {}
): Promise<SuggestChargeResult> {
  if (input.ledgerRows <= 0) return { ok: true, charged: 0 };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<SuggestChargeResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${input.userId}`}))`);
    const used = await countResearchRequestedSince(input.userId, input.since, { db: tx });
    if (used + input.ledgerRows > input.limit) {
      return { ok: false, reason: "daily_limit", remaining: Math.max(0, input.limit - used) };
    }
    const requestId = crypto.randomUUID();
    await tx
      .insert(researchRequests)
      .values(Array.from({ length: input.ledgerRows }, () => ({ requestId, userId: input.userId })));
    return { ok: true, charged: input.ledgerRows };
  });
}

// ── Internals ───────────────────────────────────────────────────────

function toRecord(row: typeof bulkImports.$inferSelect): BulkImportRecord {
  // The removal snapshot is the list's concern (`listBulkImports`), not the record's.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdByName: _snapshot, ...rest } = row;
  return {
    ...rest,
    sourceKind: row.sourceKind as ImportSourceKind,
    format: row.format as ImportFormat,
    status: row.status as ImportStatus,
    columnMap: row.columnMap ?? null,
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function uniqueByUrl<T extends { url: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.url)) return false;
    seen.add(value.url);
    return true;
  });
}
