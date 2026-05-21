#!/usr/bin/env tsx
/**
 * Offline ingestion script for tool documentation PDFs attached to Notion
 * Resources. Produces v5/src/lib/docs-index.json — a JSON embedding index
 * consumed by src/lib/rag.ts.
 *
 * Required env (loaded from .env.local if present):
 *   - NOTION_API_KEY, NOTION_DB_RESOURCES (+ other catalog DB envs)
 *   - OPENAI_API_KEY
 *
 * Run with: npm run ingest-docs
 */

import fs from "node:fs";
import path from "node:path";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchAllResources } from "../src/lib/notion";
import type { DocChunk, DocIndex } from "../src/lib/rag";

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_CHARS = 2800; // ~800 tokens
const CHUNK_OVERLAP = 350; // ~100 tokens
const OUTPUT_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "docs-index.json"
);

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function isPdf(filename: string, mime?: string): boolean {
  if (mime && mime.toLowerCase().includes("pdf")) return true;
  return /\.pdf(\?|$)/i.test(filename);
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= CHUNK_CHARS) return [normalized];

  const chunks: string[] = [];
  const step = CHUNK_CHARS - CHUNK_OVERLAP;
  for (let start = 0; start < normalized.length; start += step) {
    const end = Math.min(start + CHUNK_CHARS, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
  }
  return chunks;
}

async function extractPdfText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY is required (set in .env.local).");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required (set in .env.local).");
  }

  console.log("Fetching Notion resources…");
  const resources = await fetchAllResources();
  console.log(`Found ${resources.length} resources.`);

  const chunks: DocChunk[] = [];
  let resourceIdx = 0;
  let failureCount = 0;

  for (const resource of resources) {
    resourceIdx++;
    const title = resource.fields.title || "Untitled resource";
    const toolIds = resource.fields.tool || [];
    const files = (resource.fields.files || []).filter((file) =>
      isPdf(file.filename, file.type)
    );
    if (resource.fields.published === false) {
      console.log(`  [${resourceIdx}/${resources.length}] skip (unpublished): ${title}`);
      continue;
    }
    if (!files.length) continue;

    console.log(
      `  [${resourceIdx}/${resources.length}] ${title} — ${files.length} PDF(s)`
    );

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      try {
        const text = await extractPdfText(file.url);
        const textChunks = chunkText(text);
        if (!textChunks.length) {
          console.log(`      · ${file.filename}: no extractable text`);
          continue;
        }

        const { embeddings } = await embedMany({
          model: openai.textEmbeddingModel(EMBEDDING_MODEL),
          values: textChunks,
        });

        for (let i = 0; i < textChunks.length; i++) {
          chunks.push({
            id: `${resource.id}:${fileIdx}:${i}`,
            resource_id: resource.id,
            resource_title: title,
            tool_ids: toolIds,
            chunk_idx: chunks.length,
            text: textChunks[i],
            embedding: embeddings[i] as number[],
          });
        }
        console.log(
          `      · ${file.filename}: ${textChunks.length} chunk(s) embedded`
        );
      } catch (err) {
        failureCount++;
        console.warn(
          `      ! ${file.filename} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  const index: DocIndex = {
    generated_at: new Date().toISOString(),
    model: EMBEDDING_MODEL,
    chunks,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2));
  console.log(
    `\nWrote ${chunks.length} chunks to ${path.relative(process.cwd(), OUTPUT_PATH)}` +
      (failureCount ? ` (${failureCount} file failure(s))` : "")
  );
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
