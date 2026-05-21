import "server-only";
import fs from "node:fs";
import path from "node:path";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";

export interface DocChunk {
  id: string;
  resource_id: string;
  resource_title: string;
  tool_ids: string[];
  chunk_idx: number;
  text: string;
  embedding: number[];
}

export interface DocIndex {
  generated_at: string;
  model: string;
  chunks: DocChunk[];
}

export interface SearchHit {
  resource_title: string;
  resource_id: string;
  chunk_idx: number;
  text: string;
  score: number;
}

const EMPTY_INDEX: DocIndex = {
  generated_at: "",
  model: "text-embedding-3-small",
  chunks: [],
};

let cachedIndex: DocIndex | null = null;

export function loadDocIndex(): DocIndex {
  if (cachedIndex) return cachedIndex;

  try {
    const filePath = path.join(process.cwd(), "src", "lib", "docs-index.json");
    if (!fs.existsSync(filePath)) {
      cachedIndex = EMPTY_INDEX;
      return cachedIndex;
    }
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      cachedIndex = EMPTY_INDEX;
      return cachedIndex;
    }
    const parsed = JSON.parse(raw) as Partial<DocIndex>;
    cachedIndex = {
      generated_at: parsed.generated_at || "",
      model: parsed.model || "text-embedding-3-small",
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
    };
    return cachedIndex;
  } catch (err) {
    console.warn(
      "[rag] failed to load docs-index.json, using empty index:",
      err instanceof Error ? err.message : err
    );
    cachedIndex = EMPTY_INDEX;
    return cachedIndex;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchDocs(opts: {
  query: string;
  toolId?: string;
  topK?: number;
}): Promise<SearchHit[]> {
  const { query, toolId, topK = 5 } = opts;
  const index = loadDocIndex();
  if (!index.chunks.length || !query.trim()) return [];

  const candidates = toolId
    ? index.chunks.filter((chunk) => chunk.tool_ids.includes(toolId))
    : index.chunks;
  if (!candidates.length) return [];

  let queryEmbedding: number[];
  try {
    const result = await embed({
      model: openai.textEmbeddingModel(index.model || "text-embedding-3-small"),
      value: query,
    });
    queryEmbedding = result.embedding as number[];
  } catch (err) {
    console.warn(
      "[rag] failed to embed query:",
      err instanceof Error ? err.message : err
    );
    return [];
  }

  const scored = candidates
    .map((chunk) => ({
      resource_title: chunk.resource_title,
      resource_id: chunk.resource_id,
      chunk_idx: chunk.chunk_idx,
      text: chunk.text,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export function getChunksForTool(
  toolId: string,
  max: number
): Array<{ resource_title: string; text: string }> {
  const index = loadDocIndex();
  if (!index.chunks.length) return [];
  const filtered = index.chunks.filter((chunk) =>
    chunk.tool_ids.includes(toolId)
  );
  return filtered.slice(0, max).map((chunk) => ({
    resource_title: chunk.resource_title,
    text: chunk.text,
  }));
}
