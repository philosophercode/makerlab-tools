import { rerank } from "ai";
import { gatewayCallReport } from "../ai/gateway-usage.ts";
import { MODEL_JOBS, rerankingModelFor, type RerankingModelV3 } from "../ai/models.ts";

/**
 * Reranking manual search results (manual text spec §9 phase 3): the fused
 * full-text + vector candidates go to a reranking model (job `rerank`,
 * `cohere/rerank-v4-fast` by default, through the Gateway), which reads the
 * question beside each passage and orders them again.
 *
 * Why: the phase 2 eval's remaining misses were short facts inside long
 * passages — a spec-table row, "can I lift it by the cover" — whose embedding
 * is dominated by the rest of the passage. A cross-encoder reads the passage
 * against the question and ranks those up.
 *
 * - **Never in the way.** A rerank that fails, or takes longer than
 *   {@link RERANK_TIMEOUT_MS}, returns null and the search keeps the fused
 *   order; nothing is retried (a student is waiting).
 * - **`MODEL_RERANK=off`** turns it off without a code change
 *   ({@link defaultRerankTarget} answers null).
 *
 * Logs the error's name only. Plain Node: relative imports.
 */

export const RERANK_TIMEOUT_MS = 2500;

/** The characters of each passage the reranker reads. */
const RERANK_DOCUMENT_CHARS = 2000;

export interface RerankTarget {
  model: RerankingModelV3;
}

/** The deployment's reranker, or null when `MODEL_RERANK` is `off`. Throws for a malformed override. */
export function defaultRerankTarget(): RerankTarget | null {
  const override = process.env[MODEL_JOBS.rerank.env]?.trim().toLowerCase();
  if (override === "off" || override === "none") return null;
  return { model: rerankingModelFor("rerank") };
}

export interface Reranked {
  /** Indexes into the documents given, best first, with the reranker's score. */
  order: { index: number; score: number }[];
  /** Dollars the Gateway reported; null when it reported none. */
  cost: number | null;
}

/**
 * Order `documents` by their relevance to `query`. Null when the reranker
 * failed or timed out — the caller keeps its own order.
 */
export async function rerankDocuments(
  query: string,
  documents: readonly string[],
  target: RerankTarget,
  options: { timeoutMs?: number } = {}
): Promise<Reranked | null> {
  if (documents.length === 0) return { order: [], cost: null };
  try {
    const result = await rerank({
      model: target.model,
      query,
      documents: documents.map((doc) => doc.slice(0, RERANK_DOCUMENT_CHARS)),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? RERANK_TIMEOUT_MS),
    });
    return {
      order: result.ranking.map((entry) => ({ index: entry.originalIndex, score: entry.score })),
      cost: gatewayCallReport(result.providerMetadata).cost,
    };
  } catch (error) {
    console.warn(`[manuals] rerank failed; keeping the fused order: ${error instanceof Error ? error.name : "error"}`);
    return null;
  }
}
