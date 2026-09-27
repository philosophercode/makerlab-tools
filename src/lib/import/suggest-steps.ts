import { getSuggestionInput, setNameSuggestion } from "../data/bulk-imports.ts";
import { classifyImportError } from "./step-errors.ts";
import { suggestName } from "./suggest-names.ts";

/**
 * The Suggest names pass's steps (bulk intake spec §3.3), run by
 * `suggestNames` (`src/workflows/suggest-names.ts`). A step module exports
 * only steps. Plain Node below here.
 */

const SUGGEST_STEP_TIMEOUT_MS = 90_000;

/**
 * One item: its name, brand and category hint — never its notes — searched
 * once and settled into a suggestion stored on the row. Skipped when the item
 * has moved past `identified` (researched, discarded) since the press.
 */
export async function suggestNameStep(id: string): Promise<"suggested" | "skipped"> {
  "use step";
  const input = await getSuggestionInput(id);
  if (!input || input.status !== "identified") return "skipped";
  try {
    const run = await suggestName(
      { name: input.name, brand: input.brand, categoryHint: input.categoryHint },
      { signal: AbortSignal.timeout(SUGGEST_STEP_TIMEOUT_MS) }
    );
    const stored = await setNameSuggestion(id, run.suggestion);
    return stored ? "suggested" : "skipped";
  } catch (error) {
    throw classifyImportError(error, "Suggest names");
  }
}
suggestNameStep.maxRetries = 2;

/** One log line with counts and the request id — no item names. */
export async function finishSuggestions(
  requestId: string,
  summary: { suggested: number; skipped: number; failed: number }
): Promise<void> {
  "use step";
  console.info(
    `[import] suggest names ${requestId} finished: suggested=${summary.suggested} skipped=${summary.skipped} failed=${summary.failed}`
  );
}
