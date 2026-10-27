import { failBulkImport, getBulkImport, writeImportSlice } from "../data/bulk-imports.ts";
import { readImportRows } from "./rows.ts";

/**
 * The background writer's steps (import progress spec 2026-10-27 §3.2), run
 * by `importRows` (`src/workflows/import-rows.ts`). A step module exports only
 * steps; the helpers live in `rows.ts` and the data layer.
 *
 * Plain Node below here: no `"server-only"`, relative imports only.
 */

/**
 * The next slice of an `identifying` import's rows. The rows are read again
 * from the import's own text and column map — the same items in the same
 * order every time — and `writeImportSlice` writes the ones after
 * `progress.done`, moving it on in the same transaction, so a step that runs
 * twice writes nothing twice. Finished when the import is no longer
 * `identifying` (done, or failed meanwhile).
 */
export async function writeImportRowsSlice(importId: string): Promise<{ finished: boolean; done: number; total: number }> {
  "use step";
  const found = await getBulkImport(importId);
  if (!found || found.status !== "identifying") return { finished: true, done: 0, total: 0 };
  const read = readImportRows(found);
  if (!read) {
    await failBulkImport(importId, "The rows could not be read again from the list.");
    return { finished: true, done: 0, total: 0 };
  }
  const slice = await writeImportSlice(importId, read.items);
  if (!slice.ok) return { finished: true, done: 0, total: 0 };
  return { finished: slice.finished, done: slice.done, total: slice.total };
}
writeImportRowsSlice.maxRetries = 3;
