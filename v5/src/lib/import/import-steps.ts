import { addImportItems, failBulkImport, getBulkImport } from "../data/bulk-imports.ts";
import { chunkDocument } from "./extract-output.ts";
import { extractInventoryItems } from "./extract.ts";
import { normalizeImportItems } from "./items.ts";
import { IMPORT_MAX_ITEMS } from "./limits.ts";
import { classifyImportError } from "./step-errors.ts";
import type { RawImportItem } from "./types.ts";

/**
 * The document import's steps (bulk intake spec §3.2: "it runs as a workflow
 * step because a long PDF can take a while"), run by `importDocument`
 * (`src/workflows/import-document.ts`).
 *
 * **A step module exports only steps** (research's 2026-09-23 amendment: a
 * workflow bundle keeps every export of a step module). The helpers they use
 * live in `extract.ts`, `extract-output.ts` and `items.ts`.
 *
 * Plain Node below here: no `"server-only"`, relative imports only.
 */

/** Each extractor call's own deadline — well inside a function's lifetime. */
const EXTRACT_STEP_TIMEOUT_MS = 120_000;

/**
 * One chunk of the document, read by the model. Nothing when the import is no
 * longer `parsing` (it was finished or failed meanwhile) or the chunk is gone.
 * Throws a classified error: a provider's bad minute is retried, a refusal or
 * an answer that is not the JSON asked for fails this chunk.
 */
export async function extractImportChunk(importId: string, index: number): Promise<RawImportItem[]> {
  "use step";
  const found = await getBulkImport(importId);
  if (!found || found.status !== "parsing") return [];
  const { chunks } = chunkDocument(found.sourceText);
  const chunk = chunks[index];
  if (!chunk) return [];
  try {
    const run = await extractInventoryItems(chunk, {
      part: index + 1,
      parts: chunks.length,
      sourceName: found.sourceName,
      signal: AbortSignal.timeout(EXTRACT_STEP_TIMEOUT_MS),
      logLabel: `import ${importId}`,
    });
    return run.items;
  } catch (error) {
    throw classifyImportError(error, `Reading part ${index + 1} of the document`);
  }
}
extractImportChunk.maxRetries = 2;

/**
 * Every chunk's items become the import's pending rows (`addImportItems`),
 * validated, in document order, at most {@link IMPORT_MAX_ITEMS}. When no
 * chunk could be read at all the import fails with the first chunk's reason;
 * when the chunks were read and named nothing, it fails as `no_items`, which
 * the page words as "No equipment found in this document".
 */
export async function writeImportItems(
  importId: string,
  raws: RawImportItem[],
  failures: string[]
): Promise<{ status: "ready" | "failed"; itemCount: number }> {
  "use step";
  if (raws.length === 0 && failures.length > 0) {
    await failBulkImport(importId, failures[0]);
    return { status: "failed", itemCount: 0 };
  }
  const numbered = raws.map((raw, index) => ({ ...raw, sourceRow: index + 1 }));
  const { items } = normalizeImportItems(numbered);
  const kept = items.slice(0, IMPORT_MAX_ITEMS);
  const written = await addImportItems(importId, { items: kept, rowCount: raws.length });
  if (!written.ok) return { status: "failed", itemCount: 0 };
  return { status: written.itemCount > 0 ? "ready" : "failed", itemCount: written.itemCount };
}
writeImportItems.maxRetries = 2;

/** The workflow itself gave up: say so on the import. */
export async function failImportStep(importId: string, message: string): Promise<void> {
  "use step";
  await failBulkImport(importId, message);
}
