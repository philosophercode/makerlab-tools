import { asc, eq, sql, type SQL } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { manualChunks, manualDocuments, manualPages, type ManualOutlineEntry } from "../db/schema/index.ts";
import type { ManualDocumentStatus, ManualOutlineSource } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { MANUAL_SOURCE_PREFIX } from "./manual-archives.ts";
import { isUuid } from "./uuid.ts";

/**
 * `manual_documents` / `manual_pages` — a stored manual PDF's text, page by
 * page, and its outline (manual text spec §4, phase 1; migration `0010`).
 *
 * A **current PDF** of a resource is an `application/pdf` attachment the
 * resource owns that is either a file somebody uploaded or the import copied
 * (no archive key), or the manual archive's copy of the link the resource
 * carries *now* — the same rule `listManualsDueForArchive` and the readers in
 * `./resources.ts` use. A stale archive copy (of a link since edited) is never
 * processed and never shown.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`: the index step and the backfill run under plain Node.
 */

/** The SQL test for "attachment `a` is a current PDF of resource `r`". Aliases are trusted literals, never input. */
export function currentPdf(a: string, r: string): SQL {
  return sql.raw(
    `${a}.owner_type = 'resource' and ${a}.owner_id = ${r}.id and ${a}.content_type = 'application/pdf'` +
      ` and (${a}.source_key is null or ${a}.source_key not like '${MANUAL_SOURCE_PREFIX}%'` +
      ` or ${a}.source_key = '${MANUAL_SOURCE_PREFIX}' || ${r}.id::text || ':' || ${r}.url)`
  );
}

// ── Writes ──────────────────────────────────────────────────────────

export interface ManualDocumentHead {
  id: string;
  status: ManualDocumentStatus;
  extractorVersion: string;
}

/** The document already stored for `attachmentId`, if any. */
export async function getManualDocumentHead(db: Db, attachmentId: string): Promise<ManualDocumentHead | null> {
  if (!isUuid(attachmentId)) return null;
  const [row] = await db
    .select({ id: manualDocuments.id, status: manualDocuments.status, extractorVersion: manualDocuments.extractorVersion })
    .from(manualDocuments)
    .where(eq(manualDocuments.attachmentId, attachmentId));
  return row ? { ...row, status: row.status as ManualDocumentStatus } : null;
}

export interface SaveManualDocumentInput {
  attachmentId: string;
  toolId: string | null;
  title: string;
  status: ManualDocumentStatus;
  statusReason: string | null;
  pageCount: number | null;
  outline: ManualOutlineEntry[];
  outlineSource: ManualOutlineSource | null;
  extractorVersion: string;
  pages: { pageNumber: number; label: string | null; text: string }[];
}

/** Pages written per statement, so a 1 000-page manual is not one enormous insert. */
const PAGE_INSERT_BATCH = 50;

/**
 * Write a document and its pages **in one transaction**: the row is upserted
 * on `attachment_id` (a re-process replaces it in place, keeping its id) and
 * its pages are replaced whole. A reader never sees a document with half its
 * pages. Returns the document id.
 */
export async function saveManualDocument(db: Db, input: SaveManualDocumentInput): Promise<string> {
  return db.transaction(async (tx) => {
    const values = {
      attachmentId: input.attachmentId,
      toolId: input.toolId,
      title: input.title,
      status: input.status,
      statusReason: input.statusReason,
      pageCount: input.pageCount,
      outline: input.outline,
      outlineSource: input.outlineSource,
      extractorVersion: input.extractorVersion,
      // New pages make any passages stale: they are rebuilt from these pages
      // (`manuals/passages.ts`), so the versions that vouch for them go too.
      embeddingModel: null,
      chunkerVersion: null,
      processedAt: new Date(),
    };
    const [doc] = await tx
      .insert(manualDocuments)
      .values(values)
      .onConflictDoUpdate({ target: manualDocuments.attachmentId, set: values })
      .returning({ id: manualDocuments.id });

    await tx.delete(manualChunks).where(eq(manualChunks.documentId, doc.id));
    await tx.delete(manualPages).where(eq(manualPages.documentId, doc.id));
    for (let i = 0; i < input.pages.length; i += PAGE_INSERT_BATCH) {
      const batch = input.pages.slice(i, i + PAGE_INSERT_BATCH);
      await tx.insert(manualPages).values(
        batch.map((page) => ({
          documentId: doc.id,
          pageNumber: page.pageNumber,
          pageLabel: page.label,
          // Postgres text cannot hold NUL; pdf.js occasionally emits one.
          text: page.text.replace(/\u0000/g, ""),
        }))
      );
    }
    return doc.id;
  });
}

// ── What needs processing ──────────────────────────────────────────

/** A current PDF of a resource, with what is stored for it. */
export interface ResourcePdfForIndex {
  attachmentId: string;
  resourceId: string;
  toolId: string | null;
  resourceTitle: string;
  blobPathname: string;
  access: string;
  publicUrl: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
  /** The stored document's id, or null when there is none. */
  documentId: string | null;
  /** The stored document's version, or null when there is none. */
  documentVersion: string | null;
  documentStatus: ManualDocumentStatus | null;
}

interface PdfRow {
  attachment_id: string;
  resource_id: string;
  tool_id: string | null;
  resource_title: string;
  blob_pathname: string;
  access: string;
  public_url: string | null;
  size_bytes: number | null;
  original_filename: string | null;
  document_id: string | null;
  document_version: string | null;
  document_status: ManualDocumentStatus | null;
}

const PDF_COLUMNS = sql.raw(`
  a.id as attachment_id, r.id as resource_id, r.tool_id, r.title as resource_title,
  a.blob_pathname, a.access, a.public_url, a.size_bytes, a.original_filename,
  d.id as document_id, d.extractor_version as document_version, d.status as document_status`);

function toPdf(row: PdfRow): ResourcePdfForIndex {
  return {
    attachmentId: row.attachment_id,
    resourceId: row.resource_id,
    toolId: row.tool_id,
    resourceTitle: row.resource_title,
    blobPathname: row.blob_pathname,
    access: row.access,
    publicUrl: row.public_url,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    originalFilename: row.original_filename,
    documentId: row.document_id,
    documentVersion: row.document_version,
    documentStatus: row.document_status,
  };
}

/** Every current PDF of one resource, oldest first. */
export async function listCurrentPdfsForResource(db: Db, resourceId: string): Promise<ResourcePdfForIndex[]> {
  if (!isUuid(resourceId)) return [];
  const rows = await rawRows<PdfRow>(
    db,
    sql`select ${PDF_COLUMNS}
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id
         where r.id = ${resourceId}
         order by a.created_at asc, a.id asc`
  );
  return rows.map(toPdf);
}

export interface IndexableQuery {
  /** Only these resources (the backfill's `--ids`). */
  resourceIds?: readonly string[];
  /** Only PDFs with no document at `version` (default: every current PDF). */
  missingVersion?: string;
  limit?: number;
}

/** Every current PDF of every resource — the backfill's list — oldest first. */
export async function listIndexablePdfs(db: Db, query: IndexableQuery = {}): Promise<ResourcePdfForIndex[]> {
  const ids = (query.resourceIds ?? []).filter(isUuid);
  if (query.resourceIds && ids.length === 0) return [];
  const byIds = query.resourceIds ? sql` and r.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const missing = query.missingVersion
    ? sql` and (d.id is null or d.extractor_version <> ${query.missingVersion})`
    : sql``;
  const limit = query.limit && query.limit > 0 ? sql` limit ${Math.floor(query.limit)}` : sql``;
  const rows = await rawRows<PdfRow>(
    db,
    sql`select ${PDF_COLUMNS}
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id
         where true${byIds}${missing}
         order by a.created_at asc, a.id asc${limit}`
  );
  return rows.map(toPdf);
}

// ── Readers ─────────────────────────────────────────────────────────

/**
 * What the tool editor shows on a resource row (spec §5): its current PDF's
 * processing state. `processing` is a current PDF with no document yet — the
 * index step has not run, or is running.
 */
export interface ManualState {
  state: ManualDocumentStatus | "processing";
  pageCount: number | null;
  reason: string | null;
  /** Ready and holding search passages (phase 2): what the editor calls "Searchable". */
  searchable?: boolean;
}

/** SQL: document `d` holds passages built and embedded (both versions recorded, at least one row). */
const HAS_PASSAGES = sql.raw(
  `(d.chunker_version is not null and d.embedding_model is not null` +
    ` and exists (select 1 from manual_chunks c where c.document_id = d.id))`
);

/** The processing state of each resource's first current PDF, keyed by resource id. Resources with no PDF are absent. */
export async function listManualStates(db: Db, resourceIds: readonly string[]): Promise<Map<string, ManualState>> {
  const ids = resourceIds.filter(isUuid);
  const out = new Map<string, ManualState>();
  if (ids.length === 0) return out;
  const rows = await rawRows<{
    resource_id: string;
    status: ManualDocumentStatus | null;
    page_count: number | null;
    status_reason: string | null;
    searchable: boolean | null;
  }>(
    db,
    sql`select r.id as resource_id, d.status, d.page_count, d.status_reason,
               case when d.id is null then false else ${HAS_PASSAGES} end as searchable
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id
         where r.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
         order by a.created_at asc, a.id asc`
  );
  for (const row of rows) {
    if (out.has(row.resource_id)) continue;
    out.set(row.resource_id, {
      state: row.status ?? "processing",
      pageCount: row.page_count === null ? null : Number(row.page_count),
      reason: row.status_reason,
      searchable: row.searchable === true,
    });
  }
  return out;
}

/** A manual's outline, keyed by the public URL of the PDF it belongs to (the link the tool page shows). */
export interface ManualContents {
  href: string;
  outline: ManualOutlineEntry[];
}

/**
 * The tool page's **Contents** lists (spec §6): the outline of each ready,
 * **public** current PDF on the tool's **published** resources. Private files
 * are never listed — a visitor could not open them.
 */
export async function listManualContentsForTool(db: Db, toolId: string): Promise<ManualContents[]> {
  if (!isUuid(toolId)) return [];
  const rows = await rawRows<{ public_url: string; outline: ManualOutlineEntry[] | string }>(
    db,
    sql`select a.public_url, d.outline
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          join manual_documents d on d.attachment_id = a.id
         where r.tool_id = ${toolId}
           and r.published = true
           and a.access = 'public'
           and a.public_url is not null
           and d.status = 'ready'
           and jsonb_array_length(d.outline) > 0
         order by r.title asc, a.created_at asc`
  );
  return rows.map((row) => ({
    href: row.public_url,
    outline: typeof row.outline === "string" ? (JSON.parse(row.outline) as ManualOutlineEntry[]) : row.outline,
  }));
}

/** A stored manual's text, for research's read step. */
export interface StoredManualText {
  documentId: string;
  title: string;
  outline: ManualOutlineEntry[];
  pages: { pageNumber: number; label: string | null; text: string }[];
  /** Every address the stored file goes by — its public copy, its source link. Set by {@link findStoredManualForTool}. */
  urls?: string[];
}

/**
 * The stored text of the ready manual whose source link (`attachments.source_url`,
 * the manufacturer's URL) or stored copy (`public_url`) is `url` — so research
 * reading a manual some tool already has uses our extraction instead of
 * downloading and extracting it again. Null when there is none.
 */
export async function findStoredManualByUrl(db: Db, url: string): Promise<StoredManualText | null> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const [row] = await rawRows<{ id: string }>(
    db,
    sql`select d.id
          from manual_documents d
          join attachments a on a.id = d.attachment_id
         where d.status = 'ready'
           and (a.source_url = ${trimmed} or a.public_url = ${trimmed})
         order by d.processed_at desc
         limit 1`
  );
  return row ? loadStoredManual(db, row.id) : null;
}

/**
 * The stored text of a tool's ready manual — the refresh-research entry point
 * (spec §3.7): the tool's first ready document by resource title, or null.
 */
export async function findStoredManualForTool(db: Db, toolId: string): Promise<StoredManualText | null> {
  if (!isUuid(toolId)) return null;
  const [row] = await rawRows<{ id: string; public_url: string | null; source_url: string | null; resource_url: string | null }>(
    db,
    sql`select d.id, a.public_url, a.source_url, r.url as resource_url
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          join manual_documents d on d.attachment_id = a.id
         where r.tool_id = ${toolId} and d.status = 'ready'
         order by (lower(coalesce(r.type, '')) = 'manual') desc, r.title asc
         limit 1`
  );
  if (!row) return null;
  const stored = await loadStoredManual(db, row.id);
  if (!stored) return null;
  const urls = [...new Set([row.public_url, row.source_url, row.resource_url].filter((url): url is string => Boolean(url)))];
  return { ...stored, urls };
}

async function loadStoredManual(db: Db, documentId: string): Promise<StoredManualText | null> {
  const [doc] = await db
    .select({ id: manualDocuments.id, title: manualDocuments.title, outline: manualDocuments.outline })
    .from(manualDocuments)
    .where(eq(manualDocuments.id, documentId));
  if (!doc) return null;
  const pages = await db
    .select({ pageNumber: manualPages.pageNumber, label: manualPages.pageLabel, text: manualPages.text })
    .from(manualPages)
    .where(eq(manualPages.documentId, documentId))
    .orderBy(asc(manualPages.pageNumber));
  return { documentId: doc.id, title: doc.title, outline: doc.outline ?? [], pages };
}

/** Status counts over every stored document — the backfill's summary. */
export async function countManualDocuments(db: Db): Promise<Record<ManualDocumentStatus, number> & { pages: number }> {
  const rows = await db
    .select({ status: manualDocuments.status, count: sql<number>`count(*)::int`, pages: sql<number>`coalesce(sum(${manualDocuments.pageCount}), 0)::int` })
    .from(manualDocuments)
    .groupBy(manualDocuments.status);
  const out = { ready: 0, no_text: 0, failed: 0, pages: 0 };
  for (const row of rows) {
    if (row.status === "ready" || row.status === "no_text" || row.status === "failed") out[row.status] = Number(row.count);
    out.pages += Number(row.pages);
  }
  return out;
}
