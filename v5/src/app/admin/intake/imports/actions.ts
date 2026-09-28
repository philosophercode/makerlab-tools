"use server";

import { z } from "zod";
import {
  IMPORTS_CONFIRM_COLUMNS,
  IMPORTS_DECIDE_SUGGESTIONS,
  IMPORTS_EDIT_ROW,
  IMPORTS_MERGE_ROW,
  IMPORTS_REMOVE_ROWS,
  IMPORTS_REQUEST_SUGGESTIONS,
  IMPORTS_SET_HINTS,
} from "../../../../lib/actions/imports";
import { performAction } from "../../../../lib/actions/perform";
import { authorizeAdminAction } from "../../../../lib/admin/action-gate";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { getBulkImport } from "../../../../lib/data/bulk-imports";
import { listPendingTools } from "../../../../lib/data/pending-tools";
import { isUuid } from "../../../../lib/data/uuid";
import { canActOnImport, IMPORT_PERMISSION } from "../../../../lib/import/access";
import { toImportItemView, toImportView } from "../../../../lib/import/view";
import type { ImportActionResult, LoadImportResult, RowsResult } from "./action-result";

/**
 * The import review page's endpoints (bulk intake spec §5, §8).
 *
 * Every write is a one-line wrapper over `imports.*`
 * (`src/lib/actions/imports.ts`, assistant–GUI parity spec §9 phase 5): the
 * gate (`tools.add`), the input parsed, then the import must be the caller's
 * (or they hold `tools.approve`), and every row id must belong to the import
 * named — an id from somebody else's import changes nothing. Refusals are
 * values.
 *
 * Nothing here researches or approves: **Research selected** is the existing
 * research route, called in chunks from the page, and approval stays on
 * `/admin/intake` (Article 5).
 */

const SURFACE = "admin/intake/imports";

const loadInput = z.strictObject({ importId: z.string().refine(isUuid) });

/**
 * The import and its rows, fresh — the page's polling while a document or
 * suggestions run. A read, so not an action: it gates itself the way the
 * writes do (`tools.add`, then the import is the caller's to see).
 */
export async function loadImport(input: unknown): Promise<LoadImportResult> {
  const gate = await authorizeAdminAction(IMPORT_PERMISSION);
  if (!gate.ok) return gate;
  const parsed = loadInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  try {
    const found = await getBulkImport(parsed.data.importId);
    if (!found) return { ok: false, error: "not_found" };
    if (!canActOnImport(gate.identity, found)) return { ok: false, error: "not_permitted" };
    const items = await listPendingTools({ importId: found.id, limit: null });
    return {
      ok: true,
      import: toImportView(found),
      items: items.sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0)).map(toImportItemView),
    };
  } catch (err) {
    console.error(`[${SURFACE}] the read failed`, err);
    return { ok: false, error: "failed" };
  }
}

/** The mapping step's **Continue**: the rows are created from the confirmed matches. */
export async function confirmImportColumns(input: unknown): Promise<LoadImportResult> {
  return performAction(IMPORTS_CONFIRM_COLUMNS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * One row's inline edit: name, brand, hints, quantity or the duplicate
 * decision, through `updatePendingTool` — so a new name re-runs the duplicate
 * check, against the rest of the import too.
 */
export async function updateImportRow(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_EDIT_ROW, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Set category** / **Set location** on the chosen rows. */
export async function setImportRowHints(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_SET_HINTS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Remove** — the rows are discarded, like the chat card's Remove. */
export async function removeImportRows(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_REMOVE_ROWS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Merge into row N** — a row listed twice becomes more units of the earlier one. */
export async function mergeImportRow(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_MERGE_ROW, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * **Accept** / **Accept all exact**: each suggestion becomes the row's name
 * (and brand, when it named one), and the suggestion is cleared. The decision
 * is set here, after the body.
 */
export async function acceptImportSuggestions(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_DECIDE_SUGGESTIONS, { ...(input as object), decision: "accept" }, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Ignore** — the suggestion goes, the name stays. */
export async function ignoreImportSuggestions(input: unknown): Promise<RowsResult> {
  return performAction(IMPORTS_DECIDE_SUGGESTIONS, { ...(input as object), decision: "ignore" }, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * **Suggest names** over the chosen rows (§3.3): only rows still `identified`,
 * a quarter of an item each against the research allowance (`daily_limit`
 * with what is left otherwise).
 */
export async function requestImportSuggestions(input: unknown): Promise<ImportActionResult<{ requested: number }>> {
  return performAction(IMPORTS_REQUEST_SUGGESTIONS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
