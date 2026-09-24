"use server";

import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { z } from "zod";
import { authorizeAdminAction } from "../../../../lib/admin/action-gate";
import type { Identity } from "../../../../lib/auth/identity";
import {
  chargeSuggestionAllowance,
  getBulkImport,
  mergeImportRows,
  setImportHints,
  type BulkImportRecord,
} from "../../../../lib/data/bulk-imports";
import {
  discardPendingTool,
  listPendingTools,
  updatePendingTool,
  type PendingTool,
} from "../../../../lib/data/pending-tools";
import { researchLimitFor } from "../../../../lib/data/research-allowances";
import { isUuid } from "../../../../lib/data/uuid";
import { canActOnImport, IMPORT_PERMISSION } from "../../../../lib/import/access";
import { suggestLedgerRows } from "../../../../lib/import/allowance";
import { IMPORT_FIELDS } from "../../../../lib/import/columns";
import { IMPORT_MAX_ITEMS, IMPORT_MAX_QUANTITY, SUGGEST_MAX_ITEMS } from "../../../../lib/import/limits";
import { confirmImportMapping } from "../../../../lib/import/service";
import { toImportItemView, toImportView } from "../../../../lib/import/view";
import { suggestNames as suggestNamesWorkflow } from "../../../../workflows/suggest-names";
import type { ImportActionError, ImportActionResult, LoadImportResult, RowsResult } from "./action-result";

/**
 * The import review page's endpoints (bulk intake spec §5, §8).
 *
 * Every action resolves the caller, rate-limits and checks `tools.add` through
 * `authorizeAdminAction`, then checks the import is theirs (or they hold
 * `tools.approve`) — a server action is a POST endpoint reachable without the
 * page. Every row id must belong to the import named: an id from somebody
 * else's import changes nothing. Inputs are parsed here; refusals are values.
 *
 * Nothing here researches or approves: **Research selected** is the existing
 * research route, called in chunks from the page, and approval stays on
 * `/admin/intake` (Article 5).
 */

const SURFACE = "admin/intake/imports";

const id = z.string().refine(isUuid);
const ids = z.array(id).min(1).max(IMPORT_MAX_ITEMS);
const line = z.string().trim().max(200);
const optionalLine = line.nullable().transform((value) => (value ? value : null));

const loadInput = z.strictObject({ importId: id });
const confirmInput = z.strictObject({
  importId: id,
  columnMap: z.array(z.enum(IMPORT_FIELDS).nullable()).max(200),
});
const rowInput = z.strictObject({
  importId: id,
  id,
  patch: z.strictObject({
    name: line.min(1).optional(),
    brand: optionalLine.optional(),
    categoryHint: optionalLine.optional(),
    locationHint: optionalLine.optional(),
    quantity: z.number().int().min(1).max(IMPORT_MAX_QUANTITY).optional(),
    duplicateResolution: z.enum(["new_tool", "add_unit", "discard"]).nullable().optional(),
  }),
});
const hintsInput = z.strictObject({
  importId: id,
  ids,
  categoryHint: optionalLine.optional(),
  locationHint: optionalLine.optional(),
});
const rowsInput = z.strictObject({ importId: id, ids });
const mergeInput = z.strictObject({ importId: id, sourceId: id, targetId: id });
const suggestInput = z.strictObject({ importId: id, ids: z.array(id).min(1).max(SUGGEST_MAX_ITEMS) });

const DAY_MS = 24 * 60 * 60_000;

// ── Actions ─────────────────────────────────────────────────────────

/** The import and its rows, fresh — the page's polling while a document or suggestions run. */
export async function loadImport(input: unknown): Promise<LoadImportResult> {
  return withImport(loadInput, input, async (_identity, found) => ({ ok: true, ...(await snapshot(found)) }));
}

/** The mapping step's **Continue**: the rows are created from the confirmed matches. */
export async function confirmImportColumns(input: unknown): Promise<LoadImportResult> {
  return withImport(confirmInput, input, async (_identity, found, parsed) => {
    const confirmed = await confirmImportMapping(found.id, parsed.columnMap);
    if (!confirmed.ok) return { ok: false, error: confirmed.error };
    const fresh = await getBulkImport(found.id);
    return { ok: true, ...(await snapshot(fresh ?? found)) };
  });
}

/**
 * One row's inline edit: name, brand, hints, quantity or the duplicate
 * decision, through `updatePendingTool` — so a new name re-runs the duplicate
 * check, against the rest of the import too.
 */
export async function updateImportRow(input: unknown): Promise<RowsResult> {
  return withImport(rowInput, input, async (_identity, found, parsed) => {
    const owned = await rowsOf(found.id, [parsed.id]);
    if (owned.length === 0) return { ok: false, error: "not_found" };
    const updated = await updatePendingTool(parsed.id, parsed.patch);
    if (!updated.ok) return { ok: false, error: updated.reason };
    return { ok: true, items: [toImportItemView(updated.item)] };
  });
}

/** **Set category** / **Set location** on the chosen rows. */
export async function setImportRowHints(input: unknown): Promise<RowsResult> {
  return withImport(hintsInput, input, async (_identity, found, parsed) => {
    if (parsed.categoryHint === undefined && parsed.locationHint === undefined) return { ok: false, error: "invalid_field" };
    const changed = await setImportHints(found.id, parsed.ids, {
      ...(parsed.categoryHint !== undefined ? { categoryHint: parsed.categoryHint } : {}),
      ...(parsed.locationHint !== undefined ? { locationHint: parsed.locationHint } : {}),
    });
    return { ok: true, items: (await rowsOf(found.id, changed)).map(toImportItemView) };
  });
}

/** **Remove** — the rows are discarded, like the chat card's Remove. */
export async function removeImportRows(input: unknown): Promise<RowsResult> {
  return withImport(rowsInput, input, async (_identity, found, parsed) => {
    const owned = await rowsOf(found.id, parsed.ids);
    for (const row of owned) await discardPendingTool(row.id);
    return { ok: true, items: (await rowsOf(found.id, owned.map((row) => row.id))).map(toImportItemView) };
  });
}

/** **Merge into row N** — a row listed twice becomes more units of the earlier one. */
export async function mergeImportRow(input: unknown): Promise<RowsResult> {
  return withImport(mergeInput, input, async (_identity, found, parsed) => {
    const merged = await mergeImportRows(found.id, { sourceId: parsed.sourceId, targetId: parsed.targetId });
    if (!merged.ok) return { ok: false, error: merged.reason };
    return { ok: true, items: (await rowsOf(found.id, [parsed.sourceId, parsed.targetId])).map(toImportItemView) };
  });
}

/**
 * **Accept** / **Accept all exact**: each suggestion becomes the row's name
 * (and brand, when it named one) through `updatePendingTool`, which re-runs the
 * duplicate check (§3.3), and the suggestion is cleared.
 */
export async function acceptImportSuggestions(input: unknown): Promise<RowsResult> {
  return withImport(rowsInput, input, async (_identity, found, parsed) => {
    const owned = await rowsOf(found.id, parsed.ids);
    for (const row of owned) {
      const suggestion = row.nameSuggestion;
      if (!suggestion) continue;
      await updatePendingTool(row.id, {
        name: suggestion.canonicalName,
        ...(suggestion.brand ? { brand: suggestion.brand } : {}),
        clearNameSuggestion: true,
      });
    }
    return { ok: true, items: (await rowsOf(found.id, owned.map((row) => row.id))).map(toImportItemView) };
  });
}

/** **Ignore** — the suggestion goes, the name stays. */
export async function ignoreImportSuggestions(input: unknown): Promise<RowsResult> {
  return withImport(rowsInput, input, async (_identity, found, parsed) => {
    const owned = await rowsOf(found.id, parsed.ids);
    for (const row of owned) {
      if (row.nameSuggestion) await updatePendingTool(row.id, { clearNameSuggestion: true });
    }
    return { ok: true, items: (await rowsOf(found.id, owned.map((row) => row.id))).map(toImportItemView) };
  });
}

/**
 * **Suggest names** over the chosen rows (§3.3): only rows still `identified`,
 * at most {@link SUGGEST_MAX_ITEMS} a press. It costs a quarter of an item each
 * against the research allowance, charged under the research lock before the
 * run starts (`daily_limit` with what is left otherwise).
 */
export async function requestImportSuggestions(input: unknown): Promise<ImportActionResult<{ requested: number }>> {
  return withImport(suggestInput, input, async (identity, found, parsed) => {
    const userId = identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    const rows = (await rowsOf(found.id, parsed.ids)).filter((row) => row.status === "identified");
    if (rows.length === 0) return { ok: false, error: "not_editable" };
    const charged = await chargeSuggestionAllowance({
      userId,
      ledgerRows: suggestLedgerRows(rows.length),
      limit: await researchLimitFor(userId),
      since: new Date(Date.now() - DAY_MS),
    });
    if (!charged.ok) return { ok: false, error: "daily_limit", remaining: charged.remaining };
    const requestId = randomUUID();
    try {
      await start(suggestNamesWorkflow, [requestId, rows.map((row) => row.id)]);
    } catch (error) {
      console.error(`[${SURFACE}] could not start Suggest names ${requestId}:`, error instanceof Error ? error.message : error);
      return { ok: false, error: "start_failed" };
    }
    return { ok: true, requested: rows.length };
  });
}

// ── Internals ───────────────────────────────────────────────────────

/**
 * Gate, parse, find the import, check it is the caller's to act on, then
 * write. A thrown write is `failed`, with its stack in the console.
 */
async function withImport<P extends { importId: string }, T extends { ok: boolean }>(
  schema: z.ZodType<P>,
  input: unknown,
  write: (identity: Identity, found: BulkImportRecord, parsed: P) => Promise<T | { ok: false; error: ImportActionError; remaining?: number }>
): Promise<T | { ok: false; error: ImportActionError; remaining?: number }> {
  const gate = await authorizeAdminAction(IMPORT_PERMISSION);
  if (!gate.ok) return gate;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  try {
    const found = await getBulkImport(parsed.data.importId);
    if (!found) return { ok: false, error: "not_found" };
    if (!canActOnImport(gate.identity, found)) return { ok: false, error: "not_permitted" };
    return await write(gate.identity, found, parsed.data);
  } catch (err) {
    console.error(`[${SURFACE}] the write failed`, err);
    return { ok: false, error: "failed" };
  }
}

/** The import's rows among `ids` — an id from elsewhere is not one of them. */
async function rowsOf(importId: string, rowIds: readonly string[]): Promise<PendingTool[]> {
  if (rowIds.length === 0) return [];
  const rows = await listPendingTools({ ids: [...rowIds], limit: null });
  return rows.filter((row) => row.importId === importId);
}

async function snapshot(found: BulkImportRecord) {
  const items = await listPendingTools({ importId: found.id, limit: null });
  return {
    import: toImportView(found),
    items: items.sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0)).map(toImportItemView),
  };
}
