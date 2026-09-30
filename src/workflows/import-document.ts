import { extractImportChunk, failImportStep, writeImportItems } from "../lib/import/import-steps.ts";
import type { RawImportItem } from "../lib/import/types.ts";

/**
 * `importDocument` — a model reads an imported document into items (bulk
 * intake spec §3.1, §3.2).
 *
 * Started only by the import service (`src/lib/import/service.ts`), as
 * `start(importDocument, [importId, chunkCount])`, for an import whose text is
 * a free-form document or a PDF's text and whose row is `parsing`. Each chunk
 * of about 8,000 characters is one `extractImportChunk` step — three at a
 * time, in fixed groups, for the replay reason `researchBatch` gives — and
 * then `writeImportItems` turns every chunk's items into the import's pending
 * rows, in document order. A chunk that fails for good is left out and the
 * rest are still written; only when every chunk failed does the import fail,
 * with the first reason.
 *
 * Nothing here reads the clock or draws a random number.
 */
export async function importDocument(importId: string, chunkCount: number): Promise<{ items: number; failedChunks: number }> {
  "use workflow";
  const perChunk: RawImportItem[][] = [];
  const failures: string[] = [];

  for (const group of groups(chunkCount, 3)) {
    const settled = await Promise.allSettled(group.map((index) => extractImportChunk(importId, index)));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") perChunk.push(outcome.value);
      else failures.push(failureMessage(outcome.reason));
    }
  }

  try {
    const written = await writeImportItems(importId, perChunk.flat(), failures);
    return { items: written.itemCount, failedChunks: failures.length };
  } catch (error) {
    await failImportStep(importId, failureMessage(error));
    return { items: 0, failedChunks: failures.length };
  }
}

function groups(count: number, size: number): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < count; start += size) {
    out.push(Array.from({ length: Math.min(size, count - start) }, (_, offset) => start + offset));
  }
  return out;
}

/** The step's classified message, read by shape (the workflow's `Error` is not the host's). */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message;
  return "The document could not be read.";
}
