import "server-only";
import { start } from "workflow/api";
import { failPhotoSearch, startPhotoSearch } from "../data/photo-searches";
import { researchLimitFor } from "../data/research-allowances";
import { findPhotoOptions } from "../../workflows/photo-options";

/**
 * **Find photo options**, after the action's gate (photo options spec
 * 2026-10-29 §3): write the `searching` row and charge the allowance in one
 * transaction (`data/photo-searches.ts`), then start `findPhotoOptions`.
 *
 * Importing the workflow here is also what makes `next build` compile it, as
 * `intake/image-retry.ts` does for `findDifferentImage`.
 *
 * **A start that throws says so**: the row is marked failed at once and the
 * answer is `start_failed`. The allowance stays spent, as a Research press
 * whose start failed stays spent: the ledger counts presses.
 */

export type PhotoSearchRequestResult =
  | { ok: true; searchId: string }
  | { ok: false; error: "not_found" | "photo_search_running" | "daily_limit" | "start_failed" };

const DAY_MS = 24 * 60 * 60_000;

export async function requestPhotoOptions(
  by: { userId: string },
  input: { toolId: string; note: string | null }
): Promise<PhotoSearchRequestResult> {
  const started = await startPhotoSearch(input.toolId, {
    requestedBy: by.userId,
    note: input.note,
    limit: await researchLimitFor(by.userId),
    since: new Date(Date.now() - DAY_MS),
  });
  if (!started.ok) return { ok: false, error: started.reason };

  try {
    await start(findPhotoOptions, [started.searchId]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[photo-options] could not start the search ${started.searchId}: ${name}`);
    await failPhotoSearch(started.searchId, "The photo search could not start. Try again.");
    return { ok: false, error: "start_failed" };
  }
  return { ok: true, searchId: started.searchId };
}
