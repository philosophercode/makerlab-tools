import type { StoredEvalQuestion } from "../data/manual-eval-questions.ts";
import type { Db } from "../db/types.ts";
import type { EmbeddingTarget } from "./embed.ts";
import type { RerankTarget } from "./rerank.ts";
import { DEFAULT_LIMIT, rerankMinScore, searchManuals, type ManualPassage, type ManualSearchViewer } from "./search.ts";

/**
 * The retrieval half of the manual question eval (manual text spec amendment
 * 2026-10-07): for each stored eval question, search its machine's manuals
 * the way `search_manual` does on that machine's page (scoped to the one
 * tool, hybrid, reranked with the relevance floor, adjacent passages merged)
 * and record where the first passage of the **expected document on an
 * expected page** ranks. No chat model; each question costs one query
 * embedding and one rerank.
 *
 * recall@k is the share of questions whose page is in the top k. It is
 * reported per machine and overall, at 1, 3 and `k`.
 *
 * Plain Node: the eval task runs it, and so does its offline test.
 */

/** Lab staff: every manual of the machine is searched, private files too. */
export const RETRIEVAL_VIEWER: ManualSearchViewer = { role: "admin" };

export interface RetrievalOptions {
  /** How many passages the search returns (`search_manual` keeps 8). */
  k?: number;
  /** Rerank as `search_manual` does (default true), or a model (tests), or off. */
  rerank?: boolean | RerankTarget;
  /** The query embedding model; the deployment's `embed` job by default. */
  target?: EmbeddingTarget;
  viewer?: ManualSearchViewer;
}

export interface RetrievalResult {
  questionId: string;
  toolSlug: string;
  documentId: string;
  question: string;
  expectedPages: number[];
  /** 1-based rank of the first passage of the document on an expected page; null when none in the top k. */
  rank: number | null;
  /** 1-based rank of the first passage of the document at all (any page); null when none. */
  documentRank: number | null;
  /** What came back, in order: document id, pages, score. */
  returned: { documentId: string; pages: string; score: number }[];
  vectorFailed: boolean;
  rerankFailed: boolean;
  cost: number | null;
}

/** Whether a passage is the expected document on an expected page. */
export function passageHits(passage: Pick<ManualPassage, "documentId" | "pageStart" | "pageEnd">, question: Pick<StoredEvalQuestion, "documentId" | "expectedPages">): boolean {
  if (passage.documentId !== question.documentId) return false;
  return question.expectedPages.some((page) => page >= passage.pageStart && page <= passage.pageEnd);
}

/** Search each question in turn (one at a time: a metered API). */
export async function runRetrievalCheck(
  db: Db,
  questions: readonly StoredEvalQuestion[],
  options: RetrievalOptions = {}
): Promise<RetrievalResult[]> {
  const k = options.k ?? DEFAULT_LIMIT;
  const rerank = options.rerank ?? true;
  const results: RetrievalResult[] = [];
  for (const question of questions) {
    const found = await searchManuals(db, {
      query: question.question,
      toolIds: [question.toolId],
      limit: k,
      viewer: options.viewer ?? RETRIEVAL_VIEWER,
      rerank,
      ...(rerank ? { minRerankScore: rerankMinScore() } : {}),
      ...(options.target ? { target: options.target } : {}),
    });
    const hit = found.passages.findIndex((passage) => passageHits(passage, question));
    const sameDocument = found.passages.findIndex((passage) => passage.documentId === question.documentId);
    results.push({
      questionId: question.id,
      toolSlug: question.toolSlug,
      documentId: question.documentId,
      question: question.question,
      expectedPages: question.expectedPages,
      rank: hit >= 0 ? hit + 1 : null,
      documentRank: sameDocument >= 0 ? sameDocument + 1 : null,
      returned: found.passages.map((passage) => ({
        documentId: passage.documentId,
        pages: passage.pageStart === passage.pageEnd ? `${passage.pageStart}` : `${passage.pageStart}-${passage.pageEnd}`,
        score: Number(passage.score.toFixed(4)),
      })),
      vectorFailed: found.vectorFailed,
      rerankFailed: found.rerankFailed,
      cost: found.cost,
    });
  }
  return results;
}

/** recall at each k, for one group of results. */
export interface RecallRow {
  /** A machine's slug, or `all`. */
  group: string;
  questions: number;
  /** k → share of questions found within the top k (0 to 1). */
  recall: Record<number, number>;
  /** Questions whose document came back but not on the expected page. */
  wrongPage: number;
  /** Questions whose document did not come back at all. */
  missed: number;
}

/** recall@k per machine (alphabetical) and overall (last). */
export function recallByTool(results: readonly RetrievalResult[], ks: readonly number[]): RecallRow[] {
  const groups = new Map<string, RetrievalResult[]>();
  for (const result of results) {
    const list = groups.get(result.toolSlug) ?? [];
    list.push(result);
    groups.set(result.toolSlug, list);
  }
  const row = (group: string, list: readonly RetrievalResult[]): RecallRow => ({
    group,
    questions: list.length,
    recall: Object.fromEntries(
      ks.map((k) => [k, list.length === 0 ? 0 : list.filter((r) => r.rank !== null && r.rank <= k).length / list.length])
    ),
    wrongPage: list.filter((r) => r.rank === null && r.documentRank !== null).length,
    missed: list.filter((r) => r.rank === null && r.documentRank === null).length,
  });
  return [...[...groups.keys()].sort().map((slug) => row(slug, groups.get(slug)!)), row("all", results)];
}

/** The recall table as text, for the console and the report. */
export function formatRecallTable(rows: readonly RecallRow[], ks: readonly number[]): string {
  const header = ["machine", "questions", ...ks.map((k) => `recall@${k}`), "wrong page", "missed"];
  const lines = rows.map((r) => [
    r.group,
    String(r.questions),
    ...ks.map((k) => (r.recall[k] ?? 0).toFixed(2)),
    String(r.wrongPage),
    String(r.missed),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...lines.map(fmt)].join("\n");
}
