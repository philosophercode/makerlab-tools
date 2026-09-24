import { MockEmbeddingModelV3 } from "ai/test";
import { EMBEDDING_DIMENSIONS } from "../../src/lib/ai/models";
import type { EmbeddingTarget } from "../../src/lib/manuals/embed";

/**
 * A fake embedding model for manual search tests (manual text spec §10:
 * "a fake embedding model with fixed vectors"). No network, no randomness.
 *
 * By default a text's vector is a **bag of words hashed into
 * {@link EMBEDDING_DIMENSIONS} buckets**, normalised — so texts that share
 * words are close, deterministically, which is enough to test that the vector
 * list participates in fusion. A test that needs exact control passes
 * `vectorFor` (e.g. a one-hot vector per topic).
 *
 * `calls` records every batch the model was asked to embed, so a test can
 * assert batching (≤ 96 per call) and that nothing was embedded at all.
 */

export interface FakeEmbeddingTarget extends EmbeddingTarget {
  calls: string[][];
}

export function fakeEmbeddingTarget(
  options: { vectorFor?: (text: string) => number[]; key?: string; fail?: () => Error | null; costPerCall?: number } = {}
): FakeEmbeddingTarget {
  const calls: string[][] = [];
  const vectorFor = options.vectorFor ?? hashedBagOfWords;
  const model = new MockEmbeddingModelV3({
    provider: "fake",
    modelId: "fake-embed",
    maxEmbeddingsPerCall: 2048,
    doEmbed: async ({ values }) => {
      const error = options.fail?.();
      if (error) throw error;
      calls.push([...values]);
      return {
        embeddings: values.map((value) => vectorFor(value)),
        usage: { tokens: values.reduce((sum, value) => sum + Math.ceil(value.length / 4), 0) },
        providerMetadata: { gateway: { cost: String(options.costPerCall ?? 0.00001) } },
        warnings: [],
      };
    },
  });
  return { model, key: options.key ?? `fake/fake-embed@${EMBEDDING_DIMENSIONS}`, calls };
}

/** Words hashed into buckets, L2-normalised. */
export function hashedBagOfWords(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 3) continue;
    vector[hash(word) % EMBEDDING_DIMENSIONS] += 1;
  }
  return normalise(vector);
}

/** A unit vector along `axis` — for tests that pin exactly which passage is nearest. */
export function oneHot(axis: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis % EMBEDDING_DIMENSIONS] = 1;
  return vector;
}

function normalise(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  if (length === 0) {
    const out = [...vector];
    out[0] = 1;
    return out;
  }
  return vector.map((n) => n / length);
}

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i += 1) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
