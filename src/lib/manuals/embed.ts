import { embed, embedMany } from "ai";
import {
  EMBEDDING_DIMENSIONS,
  embeddingModelFor,
  embeddingModelKey,
  embeddingProviderOptions,
  modelIdFor,
  type EmbeddingModelV3,
} from "../ai/models.ts";
import { gatewayCallReport } from "../ai/gateway-usage.ts";

/**
 * Embeddings for manual passages and search queries (manual text spec §3.4):
 * job `embed` (`openai/text-embedding-3-small` by default, `MODEL_EMBED`
 * overrides it), through the Gateway, asked for {@link EMBEDDING_DIMENSIONS}
 * dimensions.
 *
 * - **At most {@link EMBED_BATCH_SIZE} inputs per Gateway call**, one call at a
 *   time, so a 300-passage manual is four requests and a rate limit bites one
 *   of them, not a burst.
 * - **The cost is the Gateway's own figure** (`providerMetadata.gateway.cost`,
 *   `ai/gateway-usage.ts`), summed over the calls; null when it reported none.
 * - A vector of the wrong length is an error here, before it reaches the
 *   `vector(512)` column: a model that ignored the dimension request must not
 *   write something the index cannot compare.
 *
 * Tests and live checks pass their own `model` (a fake with fixed vectors, or
 * a candidate like `voyage/voyage-4-lite`) with its `key`. Plain Node: step
 * code and scripts import this.
 */

/** Inputs per Gateway embedding call (spec §3.4: "one Gateway call per ≤ 96 passages"). */
export const EMBED_BATCH_SIZE = 96;

/** Which model embeds, and how its vectors are recorded. */
export interface EmbeddingTarget {
  model: EmbeddingModelV3;
  /** What `manual_documents.embedding_model` records, e.g. `openai/text-embedding-3-small@512`. */
  key: string;
  /** Provider options sent with every call (the dimension request). */
  providerOptions?: Record<string, Record<string, number>>;
}

/** The deployment's embedding model (job `embed`). */
export function defaultEmbeddingTarget(): EmbeddingTarget {
  return {
    model: embeddingModelFor("embed"),
    key: embeddingModelKey("embed"),
    providerOptions: embeddingProviderOptions(modelIdFor("embed")),
  };
}

export interface EmbedBatchResult {
  embeddings: number[][];
  /** Tokens the Gateway reported, summed over the calls. */
  tokens: number;
  /** Dollars the Gateway reported, summed; null when no call reported a cost. */
  cost: number | null;
  calls: number;
}

/** Embed `texts` in order, {@link EMBED_BATCH_SIZE} per call. Throws the Gateway's error (the caller classifies it). */
export async function embedTexts(
  texts: readonly string[],
  target: EmbeddingTarget = defaultEmbeddingTarget(),
  options: { abortSignal?: AbortSignal } = {}
): Promise<EmbedBatchResult> {
  const out: EmbedBatchResult = { embeddings: [], tokens: 0, cost: null, calls: 0 };
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const values = texts.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedMany({
      model: target.model,
      values,
      providerOptions: target.providerOptions,
      // One request per batch; the SDK must not split or parallelise further.
      maxParallelCalls: 1,
      maxRetries: 2,
      abortSignal: options.abortSignal,
    });
    for (const vector of result.embeddings) out.embeddings.push(checkDimensions(vector));
    out.tokens += result.usage?.tokens ?? 0;
    const cost = gatewayCallReport(result.providerMetadata).cost;
    if (cost !== null) out.cost = (out.cost ?? 0) + cost;
    out.calls += 1;
  }
  return out;
}

/** Embed one search query. */
export async function embedQuery(
  query: string,
  target: EmbeddingTarget = defaultEmbeddingTarget(),
  options: { abortSignal?: AbortSignal } = {}
): Promise<{ embedding: number[]; tokens: number; cost: number | null }> {
  const result = await embed({
    model: target.model,
    value: query,
    providerOptions: target.providerOptions,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  });
  return {
    embedding: checkDimensions(result.embedding),
    tokens: result.usage?.tokens ?? 0,
    cost: gatewayCallReport(result.providerMetadata).cost,
  };
}

/** Thrown when a model answers vectors of a size the column cannot hold. Not transient. */
export class EmbeddingDimensionError extends Error {
  override name = "EmbeddingDimensionError";
}

function checkDimensions(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingDimensionError(
      `The embedding model answered ${vector.length} dimensions; the index holds ${EMBEDDING_DIMENSIONS}.`
    );
  }
  return vector;
}

/** A vector as pgvector's text input, `[0.1,0.2,…]`. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}
