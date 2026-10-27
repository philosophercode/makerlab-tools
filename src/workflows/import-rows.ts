import { failImportStep } from "../lib/import/import-steps.ts";
import { IMPORT_MAX_ITEMS, IMPORT_SLICE_SIZE } from "../lib/import/limits.ts";
import { writeImportRowsSlice } from "../lib/import/row-steps.ts";

/**
 * `importRows` — an imported table's or list's rows, written a slice at a time
 * (import progress spec 2026-10-27 §3.2), so the import page can show them
 * arrive and the writing outlives the tab that confirmed the columns.
 *
 * Started only by the import service (`src/lib/import/service.ts`), as
 * `start(importRows, [importId])`, for an import already `identifying` — the
 * service writes the first slice itself before starting it. Each slice is one
 * `writeImportRowsSlice` step; a step that fails for good fails the import,
 * keeping the rows already written.
 *
 * Nothing here reads the clock or draws a random number.
 */

/** Never more steps than a full import needs, plus one to see it finished. */
const MAX_SLICES = Math.ceil(IMPORT_MAX_ITEMS / IMPORT_SLICE_SIZE) + 1;

export async function importRows(importId: string): Promise<{ slices: number; done: number }> {
  "use workflow";
  let slices = 0;
  let done = 0;
  try {
    while (slices < MAX_SLICES) {
      const slice = await writeImportRowsSlice(importId);
      slices += 1;
      done = slice.done;
      if (slice.finished) break;
    }
  } catch (error) {
    await failImportStep(importId, failureMessage(error));
  }
  return { slices, done };
}

/** The step's message, read by shape (the workflow's `Error` is not the host's). */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return `Writing the rows stopped: ${message}`.slice(0, 300);
  return "Writing the rows stopped.";
}
