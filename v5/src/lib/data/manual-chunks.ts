import { asc, eq, sql } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { manualChunks, manualDocuments, manualPages, type ManualOutlineEntry } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { currentPdf } from "./manual-documents.ts";
import { isUuid } from "./uuid.ts";

/**
 * `manual_chunks` — a stored manual's search passages (manual text spec §3.3,
 * §4; phase 2, migration `0011`), and the reads that decide which documents
 * need them and which manuals the chat can search.
 *
 * A document's passages are **vouched for by two versions on the document**:
 * `chunker_version` (how the pages were cut) and `embedding_model` (which model
 * embedded them, at which dimension). Both are written in the same transaction
 * as the passages, so a document either has a complete, current set or is
 * listed by {@link listDocumentsNeedingPassages} to be rebuilt.
 *
 * Plain Node (relative imports, no `"server-only"`): the index step and the
 * backfill run it.
 */

/** The versions a set of passages is built at. */
export interface PassageVersions {
  chunkerVersion: string;
  embeddingModel: string;
}

/** A ready document, with what its passages are built from. */
export interface DocumentForPassages {
  documentId: string;
  toolId: string | null;
  toolName: string | null;
  title: string;
  chunkerVersion: string | null;
  embeddingModel: string | null;
  outline: ManualOutlineEntry[];
  pages: { pageNumber: number; text: string }[];
}

/** A ready document's pages and outline, or null when it does not exist or is not `ready`. */
export async function loadDocumentForPassages(db: Db, documentId: string): Promise<DocumentForPassages | null> {
  if (!isUuid(documentId)) return null;
  const [doc] = await rawRows<{
    id: string;
    tool_id: string | null;
    tool_name: string | null;
    title: string;
    chunker_version: string | null;
    embedding_model: string | null;
    outline: ManualOutlineEntry[] | string;
  }>(
    db,
    sql`select d.id, d.tool_id, t.name as tool_name, d.title, d.chunker_version, d.embedding_model, d.outline
          from manual_documents d
          left join tools t on t.id = d.tool_id
         where d.id = ${documentId} and d.status = 'ready'`
  );
  if (!doc) return null;
  const pages = await db
    .select({ pageNumber: manualPages.pageNumber, text: manualPages.text })
    .from(manualPages)
    .where(eq(manualPages.documentId, documentId))
    .orderBy(asc(manualPages.pageNumber));
  return {
    documentId: doc.id,
    toolId: doc.tool_id,
    toolName: doc.tool_name,
    title: doc.title,
    chunkerVersion: doc.chunker_version,
    embeddingModel: doc.embedding_model,
    outline: parseOutline(doc.outline),
    pages,
  };
}

/** A document that needs its passages (re)built. */
export interface DocumentNeedingPassages {
  documentId: string;
  resourceId: string;
  attachmentId: string;
  chunkerVersion: string | null;
  embeddingModel: string | null;
}

export interface PassagesQuery {
  resourceIds?: readonly string[];
  limit?: number;
  /** Every ready current document, whatever its versions (the backfill's `--force`). */
  force?: boolean;
}

/**
 * Ready documents of current PDFs whose passages are missing or were built at
 * other versions — the backfill's list, oldest first. A stale archive copy is
 * never listed, exactly as it is never processed.
 */
export async function listDocumentsNeedingPassages(
  db: Db,
  versions: PassageVersions,
  query: PassagesQuery = {}
): Promise<DocumentNeedingPassages[]> {
  const ids = (query.resourceIds ?? []).filter(isUuid);
  if (query.resourceIds && ids.length === 0) return [];
  const byIds = query.resourceIds ? sql` and r.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const stale = query.force
    ? sql``
    : sql` and (d.chunker_version is distinct from ${versions.chunkerVersion}
                or d.embedding_model is distinct from ${versions.embeddingModel})`;
  const limit = query.limit && query.limit > 0 ? sql` limit ${Math.floor(query.limit)}` : sql``;
  const rows = await rawRows<{
    document_id: string;
    resource_id: string;
    attachment_id: string;
    chunker_version: string | null;
    embedding_model: string | null;
  }>(
    db,
    sql`select d.id as document_id, r.id as resource_id, a.id as attachment_id, d.chunker_version, d.embedding_model
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          join manual_documents d on d.attachment_id = a.id
         where d.status = 'ready'${byIds}${stale}
         order by a.created_at asc, a.id asc${limit}`
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    resourceId: row.resource_id,
    attachmentId: row.attachment_id,
    chunkerVersion: row.chunker_version,
    embeddingModel: row.embedding_model,
  }));
}

/** One passage to write. */
export interface ChunkToSave {
  ordinal: number;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  content: string;
  searchText: string;
  embedding: number[];
}

/** Rows per insert statement: ~300 passages of 512 floats is too much for one. */
const CHUNK_INSERT_BATCH = 50;

/**
 * Replace a document's passages **in one transaction** and record the versions
 * they were built at. A reader sees the old set or the new one, never half.
 */
export async function saveManualChunks(
  db: Db,
  documentId: string,
  input: PassageVersions & { toolId: string | null; chunks: readonly ChunkToSave[] }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(manualChunks).where(eq(manualChunks.documentId, documentId));
    for (let i = 0; i < input.chunks.length; i += CHUNK_INSERT_BATCH) {
      await tx.insert(manualChunks).values(
        input.chunks.slice(i, i + CHUNK_INSERT_BATCH).map((chunk) => ({
          documentId,
          toolId: input.toolId,
          ordinal: chunk.ordinal,
          sectionPath: chunk.sectionPath,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          content: stripNul(chunk.content),
          searchText: stripNul(chunk.searchText),
          embedding: chunk.embedding,
        }))
      );
    }
    await tx
      .update(manualDocuments)
      .set({ chunkerVersion: input.chunkerVersion, embeddingModel: input.embeddingModel })
      .where(eq(manualDocuments.id, documentId));
  });
}

/**
 * Re-process: mark every document of `resourceId`'s current PDFs as built by
 * no version, so the next index run extracts, chunks and embeds them again.
 * Nothing is deleted — the stored text and passages keep serving until the
 * new ones replace them. Returns how many documents were marked.
 */
export async function markResourceManualsStale(db: Db, resourceId: string): Promise<number> {
  if (!isUuid(resourceId)) return 0;
  const rows = await rawRows<{ id: string }>(
    db,
    sql`update manual_documents d
           set extractor_version = 'reprocess', chunker_version = null, embedding_model = null
          from resources r
          join attachments a on ${currentPdf("a", "r")}
         where r.id = ${resourceId} and d.attachment_id = a.id
        returning d.id`
  );
  return rows.length;
}

// ── Counts (the /admin/research panel) ──────────────────────────────

export interface ManualStateCounts {
  /** Ready, with passages: the chat can search it. */
  searchable: number;
  /** Ready, text stored, no current passages yet. */
  textOnly: number;
  noText: number;
  failed: number;
  /** A current PDF with no document yet. */
  processing: number;
  /** Pages across every stored document. */
  pages: number;
  /** Passages across every document. */
  passages: number;
}

/** How many current manual PDFs are in each state (manual text spec §5 "Admin"). */
export async function countManualsByState(db: Db): Promise<ManualStateCounts> {
  const [row] = await rawRows<Record<keyof ManualStateCounts, number | string | null>>(
    db,
    sql`select
          count(*) filter (where d.status = 'ready' and d.chunker_version is not null and d.embedding_model is not null
                                 and exists (select 1 from manual_chunks c where c.document_id = d.id)) as searchable,
          count(*) filter (where d.status = 'ready' and not (d.chunker_version is not null and d.embedding_model is not null
                                 and exists (select 1 from manual_chunks c where c.document_id = d.id))) as "textOnly",
          count(*) filter (where d.status = 'no_text') as "noText",
          count(*) filter (where d.status = 'failed') as failed,
          count(*) filter (where d.id is null) as processing,
          coalesce(sum(d.page_count), 0) as pages,
          coalesce(sum((select count(*) from manual_chunks c where c.document_id = d.id)), 0) as passages
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id`
  );
  const n = (value: number | string | null | undefined) => Number(value ?? 0);
  return {
    searchable: n(row?.searchable),
    textOnly: n(row?.textOnly),
    noText: n(row?.noText),
    failed: n(row?.failed),
    processing: n(row?.processing),
    pages: n(row?.pages),
    passages: n(row?.passages),
  };
}

// ── The library (the /admin/research list) ─────────────────────────

import type { ManualLibraryRow, ManualLibraryState } from "./manual-library.ts";
export { MANUAL_LIBRARY_STATES, type ManualLibraryRow, type ManualLibraryState } from "./manual-library.ts";

/**
 * Every current manual PDF with its state (public polish: the Manuals page's
 * table). The same buckets and the same current-PDF rule as
 * {@link countManualsByState}, so the strip above the table and its facet
 * counts agree. One statement; ordered by tool, then title.
 */
export async function listManualLibrary(db: Db): Promise<ManualLibraryRow[]> {
  const rows = await rawRows<{
    id: string;
    resource_id: string;
    title: string;
    tool_id: string | null;
    tool_name: string | null;
    tool_slug: string | null;
    status: string | null;
    searchable: boolean | null;
    page_count: number | string | null;
    passages: number | string | null;
    status_reason: string | null;
    processed_at: Date | string | null;
  }>(
    db,
    sql`select a.id, r.id as resource_id, r.title, t.id as tool_id, t.name as tool_name, t.slug as tool_slug,
               d.status, d.page_count, d.status_reason, d.processed_at,
               (select count(*) from manual_chunks c where c.document_id = d.id) as passages,
               (d.chunker_version is not null and d.embedding_model is not null
                  and exists (select 1 from manual_chunks c where c.document_id = d.id)) as searchable
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id
          left join tools t on t.id = r.tool_id
         order by t.name asc nulls last, r.title asc, a.created_at asc`
  );
  return rows.map((row) => {
    const state: ManualLibraryState =
      row.status === null
        ? "processing"
        : row.status === "no_text"
          ? "noText"
          : row.status === "failed"
            ? "failed"
            : row.searchable
              ? "searchable"
              : "textOnly";
    return {
      id: row.id,
      resourceId: row.resource_id,
      title: row.title,
      toolId: row.tool_id,
      toolName: row.tool_name,
      toolSlug: row.tool_slug,
      state,
      pageCount: row.page_count === null ? null : Number(row.page_count),
      passages: Number(row.passages ?? 0),
      reason: row.status_reason,
      processedAt: row.processed_at === null ? null : new Date(row.processed_at),
    };
  });
}

// ── The chat's view of a tool's manuals ────────────────────────────

/** One of a tool's current PDFs as the chat sees it. */
export interface ToolManualForChat {
  resourceId: string;
  documentId: string | null;
  title: string;
  /** Ready with passages: answered through `search_manual`, never attached. */
  searchable: boolean;
  status: string | null;
  pageCount: number | null;
  outline: ManualOutlineEntry[];
  /** The stored copy's public URL; null for a private file. */
  pdfUrl: string | null;
}

/**
 * Every current PDF on `toolId`'s resources the viewer may see — public files
 * on published resources, plus private or hidden ones when `includePrivate` —
 * with whether it is searchable. The chat uses it twice: the searchable ones'
 * outlines go in the prompt, and only the others may be attached whole
 * (spec §3.6).
 */
export async function listToolManualsForChat(
  db: Db,
  toolId: string,
  access: { includePrivate: boolean }
): Promise<ToolManualForChat[]> {
  if (!isUuid(toolId)) return [];
  const visible = access.includePrivate ? sql`` : sql` and a.access = 'public' and r.published = true`;
  const rows = await rawRows<{
    resource_id: string;
    document_id: string | null;
    title: string;
    status: string | null;
    page_count: number | null;
    outline: ManualOutlineEntry[] | string | null;
    public_url: string | null;
    searchable: boolean | null;
  }>(
    db,
    sql`select r.id as resource_id, d.id as document_id, coalesce(d.title, r.title) as title, d.status, d.page_count,
               d.outline, a.public_url,
               case when d.id is null or d.status <> 'ready' then false
                    else (d.chunker_version is not null and d.embedding_model is not null
                          and exists (select 1 from manual_chunks c where c.document_id = d.id)) end as searchable
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          left join manual_documents d on d.attachment_id = a.id
         where r.tool_id = ${toolId}${visible}
         order by (lower(coalesce(r.type, '')) = 'manual') desc, r.title asc, a.created_at asc`
  );
  return rows.map((row) => ({
    resourceId: row.resource_id,
    documentId: row.document_id,
    title: row.title,
    searchable: row.searchable === true,
    status: row.status,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    outline: parseOutline(row.outline),
    pdfUrl: row.public_url,
  }));
}

function parseOutline(value: ManualOutlineEntry[] | string | null): ManualOutlineEntry[] {
  if (!value) return [];
  return typeof value === "string" ? (JSON.parse(value) as ManualOutlineEntry[]) : value;
}

function stripNul(text: string): string {
  // Postgres text cannot hold NUL; pdf.js occasionally emits one.
  return text.replace(/\u0000/g, "");
}
