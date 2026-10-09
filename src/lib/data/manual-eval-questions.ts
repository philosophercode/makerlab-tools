import { asc, eq, sql } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { manualEvalQuestions, manualPages } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { currentPdf } from "./manual-documents.ts";
import { isUuid } from "./uuid.ts";

/**
 * `manual_eval_questions` — questions a student could ask whose answer is on
 * a known page of a manual (manual text spec amendment 2026-10-07, migration
 * `0028`). Written by `manuals/eval-questions.ts`; read by the manual evals.
 *
 * A document's questions are **one set at one text digest** (`source_hash`):
 * {@link replaceDocumentQuestions} swaps the whole set in one transaction, so
 * a reader sees the old set or the new one. Only *current* PDFs count (the
 * same rule as search): a stale archive copy's questions are never listed.
 *
 * Plain Node (relative imports, no `"server-only"`): the workflow step, the
 * backfill and the eval run it.
 */

/** One stored passage of a document, as the question picker reads it. */
export interface DocumentPassageRow {
  ordinal: number;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  content: string;
}

/** A searchable document, with what its questions are written from. */
export interface DocumentForQuestions {
  documentId: string;
  toolId: string | null;
  toolName: string | null;
  title: string;
  pages: { pageNumber: number; text: string }[];
  passages: DocumentPassageRow[];
  /** The digest its stored questions were written at; null when it has none. */
  questionsHash: string | null;
  /** The model that wrote them; null when it has none. */
  questionsModel: string | null;
  questionCount: number;
}

/** A ready document that has passages, or null (not ready, no passages, not there). */
export async function loadDocumentForQuestions(db: Db, documentId: string): Promise<DocumentForQuestions | null> {
  if (!isUuid(documentId)) return null;
  const [doc] = await rawRows<{
    id: string;
    tool_id: string | null;
    tool_name: string | null;
    title: string;
    questions_hash: string | null;
    questions_model: string | null;
    question_count: number | string;
  }>(
    db,
    sql`select d.id, d.tool_id, t.name as tool_name, d.title,
               (select min(q.source_hash) from manual_eval_questions q where q.document_id = d.id) as questions_hash,
               (select min(q.model) from manual_eval_questions q where q.document_id = d.id) as questions_model,
               (select count(*) from manual_eval_questions q where q.document_id = d.id) as question_count
          from manual_documents d
          left join tools t on t.id = d.tool_id
         where d.id = ${documentId} and d.status = 'ready'
           and exists (select 1 from manual_chunks c where c.document_id = d.id)`
  );
  if (!doc) return null;
  const pages = await db
    .select({ pageNumber: manualPages.pageNumber, text: manualPages.text })
    .from(manualPages)
    .where(eq(manualPages.documentId, documentId))
    .orderBy(asc(manualPages.pageNumber));
  const passages = await rawRows<{
    ordinal: number;
    section_path: string[] | string | null;
    page_start: number;
    page_end: number;
    content: string;
  }>(
    db,
    sql`select ordinal, section_path, page_start, page_end, content
          from manual_chunks where document_id = ${documentId} order by ordinal asc`
  );
  return {
    documentId: doc.id,
    toolId: doc.tool_id,
    toolName: doc.tool_name,
    title: doc.title,
    pages,
    passages: passages.map((row) => ({
      ordinal: Number(row.ordinal),
      sectionPath: textArray(row.section_path),
      pageStart: Number(row.page_start),
      pageEnd: Number(row.page_end),
      content: row.content,
    })),
    questionsHash: doc.questions_hash,
    questionsModel: doc.questions_model,
    questionCount: Number(doc.question_count),
  };
}

/** One question to store. */
export interface EvalQuestionToSave {
  question: string;
  expectedPages: number[];
  chunkOrdinal: number;
  sectionPath: string[];
  expectedAnswer: string;
}

/**
 * Replace a document's questions with `questions`, written at `sourceHash` by
 * `model`, **in one transaction**. An empty list still records nothing: a
 * document the model found nothing to ask about keeps no rows (and is asked
 * again only when its text changes or the backfill forces it).
 */
export async function replaceDocumentQuestions(
  db: Db,
  documentId: string,
  input: { toolId: string | null; sourceHash: string; model: string; questions: readonly EvalQuestionToSave[] }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(manualEvalQuestions).where(eq(manualEvalQuestions.documentId, documentId));
    if (input.questions.length === 0) return;
    await tx.insert(manualEvalQuestions).values(
      input.questions.map((q) => ({
        documentId,
        toolId: input.toolId,
        question: q.question,
        expectedPages: q.expectedPages,
        chunkOrdinal: q.chunkOrdinal,
        sectionPath: q.sectionPath,
        expectedAnswer: q.expectedAnswer,
        sourceHash: input.sourceHash,
        model: input.model,
      }))
    );
  });
}

/**
 * The same text stored on another document (one PDF on two machines): copy
 * that document's questions to this one, with this document's machine, and
 * return how many. Zero when no other document has questions at `sourceHash`
 * written by `model` (questions by another model are rewritten, not copied).
 * Never twice for the same text: this costs no model call. With `dryRun`,
 * count what would be copied and write nothing.
 */
export async function copyQuestionsForSameText(
  db: Db,
  documentId: string,
  input: { toolId: string | null; sourceHash: string; model: string; dryRun?: boolean }
): Promise<number> {
  const [source] = await rawRows<{ document_id: string }>(
    db,
    sql`select document_id from manual_eval_questions
         where source_hash = ${input.sourceHash} and model = ${input.model} and document_id <> ${documentId}
         order by created_at asc limit 1`
  );
  if (!source) return 0;
  const rows = await db
    .select()
    .from(manualEvalQuestions)
    .where(eq(manualEvalQuestions.documentId, source.document_id))
    .orderBy(asc(manualEvalQuestions.chunkOrdinal));
  const first = rows[0];
  if (!first) return 0;
  if (input.dryRun) return rows.length;
  await replaceDocumentQuestions(db, documentId, {
    toolId: input.toolId,
    sourceHash: input.sourceHash,
    model: first.model,
    questions: rows.map((row) => ({
      question: row.question,
      expectedPages: row.expectedPages,
      chunkOrdinal: row.chunkOrdinal,
      sectionPath: row.sectionPath,
      expectedAnswer: row.expectedAnswer,
    })),
  });
  return rows.length;
}

/** A searchable current document, for the backfill. */
export interface DocumentQuestionTarget {
  documentId: string;
  toolId: string | null;
  toolSlug: string | null;
  toolName: string | null;
  title: string;
  pageCount: number | null;
  questionCount: number;
}

/**
 * Every ready current document with passages, oldest first, narrowed to one
 * machine (`toolSlug`, a slug or an id) when given. Whether each needs
 * questions is the caller's call: it depends on the text's digest.
 */
export async function listDocumentsForQuestions(
  db: Db,
  query: { toolSlug?: string | null; limit?: number | null } = {}
): Promise<DocumentQuestionTarget[]> {
  const tool = query.toolSlug?.trim();
  const byTool = tool
    ? isUuid(tool)
      ? sql` and (t.slug = ${tool} or t.id = ${tool}::uuid)`
      : sql` and t.slug = ${tool}`
    : sql``;
  const limit = query.limit && query.limit > 0 ? sql` limit ${Math.floor(query.limit)}` : sql``;
  const rows = await rawRows<{
    document_id: string;
    tool_id: string | null;
    tool_slug: string | null;
    tool_name: string | null;
    title: string;
    page_count: number | string | null;
    question_count: number | string;
  }>(
    db,
    sql`select d.id as document_id, r.tool_id, t.slug as tool_slug, t.name as tool_name, d.title, d.page_count,
               (select count(*) from manual_eval_questions q where q.document_id = d.id) as question_count
          from resources r
          join attachments a on ${currentPdf("a", "r")}
          join manual_documents d on d.attachment_id = a.id
          left join tools t on t.id = r.tool_id
         where d.status = 'ready'
           and exists (select 1 from manual_chunks c where c.document_id = d.id)
           and (t.id is null or t.archived_at is null)${byTool}
         order by a.created_at asc, a.id asc${limit}`
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    toolId: row.tool_id,
    toolSlug: row.tool_slug,
    toolName: row.tool_name,
    title: row.title,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    questionCount: Number(row.question_count),
  }));
}

/** One eval question, with what the evals need to judge an answer to it. */
export interface StoredEvalQuestion {
  id: string;
  documentId: string;
  documentTitle: string;
  toolId: string;
  toolSlug: string;
  toolName: string;
  question: string;
  expectedPages: number[];
  chunkOrdinal: number;
  sectionPath: string[];
  expectedAnswer: string;
  model: string;
  /** A visitor who is not signed in can search it: a public file on a published resource of a published tool. */
  public: boolean;
}

/**
 * The questions of every current document on a non-archived machine (one
 * machine with `toolSlug`), ordered by machine, document and passage.
 */
export async function listEvalQuestions(
  db: Db,
  query: { toolSlug?: string | null; limit?: number | null } = {}
): Promise<StoredEvalQuestion[]> {
  const tool = query.toolSlug?.trim();
  const byTool = tool ? sql` and t.slug = ${tool}` : sql``;
  const limit = query.limit && query.limit > 0 ? sql` limit ${Math.floor(query.limit)}` : sql``;
  const rows = await rawRows<{
    id: string;
    document_id: string;
    document_title: string;
    tool_id: string;
    tool_slug: string;
    tool_name: string;
    question: string;
    expected_pages: number[] | string;
    chunk_ordinal: number;
    section_path: string[] | string | null;
    expected_answer: string;
    model: string;
    is_public: boolean;
  }>(
    db,
    sql`select q.id, q.document_id, d.title as document_title, t.id as tool_id, t.slug as tool_slug, t.name as tool_name,
               q.question, q.expected_pages, q.chunk_ordinal, q.section_path, q.expected_answer, q.model,
               (a.access = 'public' and r.published = true and t.published = true) as is_public
          from manual_eval_questions q
          join manual_documents d on d.id = q.document_id
          join attachments a on a.id = d.attachment_id
          join resources r on ${currentPdf("a", "r")}
          join tools t on t.id = r.tool_id
         where t.archived_at is null${byTool}
         order by t.name asc, d.title asc, q.chunk_ordinal asc, q.id asc${limit}`
  );
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    toolId: row.tool_id,
    toolSlug: row.tool_slug,
    toolName: row.tool_name,
    question: row.question,
    expectedPages: intArray(row.expected_pages),
    chunkOrdinal: Number(row.chunk_ordinal),
    sectionPath: textArray(row.section_path),
    expectedAnswer: row.expected_answer,
    model: row.model,
    public: row.is_public === true,
  }));
}

/** Postgres arrays arrive parsed from both drivers, but a text literal is handled too. */
function textArray(value: string[] | string | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .filter(Boolean)
    .map((part) => part.replace(/^"|"$/g, ""));
}

function intArray(value: number[] | string): number[] {
  if (Array.isArray(value)) return value.map(Number);
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .filter(Boolean)
    .map(Number);
}
