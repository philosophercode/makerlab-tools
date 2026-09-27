import { classifyModelError, type ModelErrorKind } from "../ai/gateway-errors.ts";
import {
  loadDocumentForPassages,
  saveManualChunks,
  type DocumentForPassages,
} from "../data/manual-chunks.ts";
import type { Db } from "../db/types.ts";
import { chunkManual, CHUNKER_VERSION } from "./chunk.ts";
import { defaultEmbeddingTarget, EmbeddingDimensionError, embedTexts, type EmbeddingTarget } from "./embed.ts";

/**
 * Building a stored manual's search passages (manual text spec §3.1 steps
 * 4–6, phase 2): chunk its stored pages along its outline (`chunk.ts`), embed
 * every passage (`embed.ts`, job `embed`), and write passages plus the versions
 * that vouch for them in one transaction (`data/manual-chunks.ts`).
 *
 * - **Idempotent** on `CHUNKER_VERSION` and the embedding model key: a document
 *   already built at both is `skipped`; either one different rebuilds it.
 * - **Embedding first, then one write.** The Gateway calls happen outside the
 *   transaction, so a failure leaves the previous passages (or none) in place,
 *   never half a set.
 * - **Outcomes are values.** An embedding failure is `failed` with `transient`
 *   set for what a retry could fix (rate limit, a provider's bad minute, a
 *   timeout, no answer); auth, an unknown model, a bad request or a vector of
 *   the wrong size are not transient. The caller decides what to retry — the
 *   workflow step retries transient ones; the archive is never affected.
 *
 * Logs ids, counts, tokens and cost only. Plain Node: relative imports.
 */

export type PassagesOutcome =
  | {
      status: "built";
      documentId: string;
      chunks: number;
      tokens: number;
      /** Dollars the Gateway reported; null when it reported none. */
      cost: number | null;
      calls: number;
      ms: number;
    }
  | { status: "skipped"; documentId: string; reason: "up_to_date" | "not_ready" }
  | { status: "chunked"; documentId: string; chunks: number; reason: "dry_run" }
  | {
      status: "failed";
      documentId: string;
      reason: "embedding_failed";
      kind: ModelErrorKind | "dimensions" | "unknown";
      transient: boolean;
    };

export interface PassagesOptions {
  /** Rebuild even when both versions match (the backfill's `--force`). */
  force?: boolean;
  /** Chunk and count, embed and write nothing (no Gateway call, no cost). */
  dryRun?: boolean;
  /** Which model embeds; the deployment's `embed` job by default. Tests pass a fake. */
  target?: EmbeddingTarget;
}

/** Build (or rebuild) one document's passages. */
export async function buildDocumentPassages(
  db: Db,
  documentId: string,
  options: PassagesOptions = {}
): Promise<PassagesOutcome> {
  const doc = await loadDocumentForPassages(db, documentId);
  if (!doc) return { status: "skipped", documentId, reason: "not_ready" };

  let target: EmbeddingTarget;
  try {
    target = options.target ?? defaultEmbeddingTarget();
  } catch (error) {
    // A malformed MODEL_EMBED: a configuration error, never retried.
    return failed(documentId, error);
  }

  if (!options.force && doc.chunkerVersion === CHUNKER_VERSION && doc.embeddingModel === target.key) {
    return { status: "skipped", documentId, reason: "up_to_date" };
  }

  const started = Date.now();
  const chunks = chunksFor(doc);
  if (options.dryRun) return { status: "chunked", documentId, chunks: chunks.length, reason: "dry_run" };

  let embedded;
  try {
    embedded = await embedTexts(
      chunks.map((chunk) => chunk.searchText),
      target
    );
  } catch (error) {
    const outcome = failed(documentId, error);
    console.warn(
      `[manuals] passages failed: document=${documentId} kind=${outcome.status === "failed" ? outcome.kind : "unknown"}` +
        ` transient=${outcome.status === "failed" && outcome.transient}`
    );
    return outcome;
  }

  await saveManualChunks(db, documentId, {
    chunkerVersion: CHUNKER_VERSION,
    embeddingModel: target.key,
    toolId: doc.toolId,
    chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: embedded.embeddings[i] })),
  });

  const ms = Date.now() - started;
  console.info(
    `[manuals] passages built: document=${documentId} chunks=${chunks.length} tokens=${embedded.tokens}` +
      ` calls=${embedded.calls} ${describeCost(embedded.cost)} ms=${ms}`
  );
  return {
    status: "built",
    documentId,
    chunks: chunks.length,
    tokens: embedded.tokens,
    cost: embedded.cost,
    calls: embedded.calls,
    ms,
  };
}

/** The passages a document's stored pages and outline produce. */
export function chunksFor(doc: Pick<DocumentForPassages, "toolName" | "title" | "pages" | "outline">) {
  return chunkManual({ toolName: doc.toolName, documentTitle: doc.title, pages: doc.pages, outline: doc.outline });
}

/** `"cost $0.00123"` or `"cost not reported"` — the Gateway's figure, for one log line. */
export function describeCost(cost: number | null): string {
  return cost === null ? "cost not reported" : `cost $${cost.toFixed(5)}`;
}

const TRANSIENT_KINDS: readonly ModelErrorKind[] = ["rate_limited", "provider_unavailable", "timeout"];

function failed(documentId: string, error: unknown): PassagesOutcome {
  if (error instanceof EmbeddingDimensionError || (error as { name?: string })?.name === "EmbeddingDimensionError") {
    return { status: "failed", documentId, reason: "embedding_failed", kind: "dimensions", transient: false };
  }
  const classified = classifyModelError(error);
  if (!classified) {
    // No classification: a network failure before any answer is the common case — worth a retry.
    const transient = isNetworkError(error);
    return { status: "failed", documentId, reason: "embedding_failed", kind: "unknown", transient };
  }
  return {
    status: "failed",
    documentId,
    reason: "embedding_failed",
    kind: classified.kind,
    transient: TRANSIENT_KINDS.includes(classified.kind),
  };
}

function isNetworkError(error: unknown): boolean {
  const text = `${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? ""}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(text);
}
