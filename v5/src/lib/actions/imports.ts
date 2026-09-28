import "server-only";

import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { z } from "zod";
import type { ImportActionError } from "../../app/admin/intake/imports/action-result";
import type { AdminGateError } from "../admin/action-result";
import { chargeSuggestionAllowance, getBulkImport, mergeImportRows, setImportHints, type BulkImportRecord } from "../data/bulk-imports";
import { discardPendingTool, listPendingTools, updatePendingTool, type PendingTool } from "../data/pending-tools";
import { researchLimitFor } from "../data/research-allowances";
import { isUuid } from "../data/uuid";
import { canActOnImport, IMPORT_PERMISSION } from "../import/access";
import { suggestLedgerRows } from "../import/allowance";
import { IMPORT_FIELDS } from "../import/columns";
import { IMPORT_MAX_ITEMS, IMPORT_MAX_QUANTITY, SUGGEST_MAX_ITEMS } from "../import/limits";
import { confirmImportMapping } from "../import/service";
import { importPath, toImportItemView, toImportView, type ImportItemView, type ImportView } from "../import/view";
import { suggestNames as suggestNamesWorkflow } from "../../workflows/suggest-names";
import { defineAction, toolShape, type ActionContext, type ActionPreview, type ActionPreviewRow } from "./define";

/**
 * The import review page (bulk intake spec §5, §8; assistant–GUI parity spec
 * §4.3 #23–26, §9 phase 5): confirm the column matches, edit a row, set hints,
 * remove, merge, decide name suggestions, ask for them. Moved from
 * `app/admin/intake/imports/actions.ts`, whose exports are now one-line
 * wrappers.
 *
 * `tools.add`, then **the import must be the caller's, or they hold
 * `tools.approve`** (`check`), and every row id must belong to the import
 * named — an id from somebody else's import changes nothing. Nothing here
 * researches or approves: that is the intake queue's (Article 5).
 *
 * **Asking for name suggestions spends** a quarter item each against the
 * research allowance (§3.3), so for the assistant it is a card with the
 * person's click, never over MCP (§11 answer 3).
 */

const SURFACE = "admin/intake/imports";

type ImportRefusal = Exclude<ImportActionError, AdminGateError>;

const id = z.string().refine(isUuid);
const ids = z.array(id).min(1).max(IMPORT_MAX_ITEMS);
const line = z.string().trim().max(200);
const optionalLine = line.nullable().transform((value) => (value ? value : null));

/** The import named, if it exists and is the caller's to act on — the page's own two refusals. */
async function importRefusal(importId: string, ctx: ActionContext): Promise<ImportRefusal | "not_permitted" | null> {
  const found = await getBulkImport(importId);
  if (!found) return "not_found";
  return canActOnImport(ctx.identity, found) ? null : "not_permitted";
}

/** The import's rows among `rowIds` — an id from elsewhere is not one of them. */
async function rowsOf(importId: string, rowIds: readonly string[]): Promise<PendingTool[]> {
  if (rowIds.length === 0) return [];
  const rows = await listPendingTools({ ids: [...rowIds], limit: null });
  return rows.filter((row) => row.importId === importId);
}

async function itemsOf(importId: string, rowIds: readonly string[]): Promise<ImportItemView[]> {
  return (await rowsOf(importId, rowIds)).map(toImportItemView);
}

async function snapshot(found: BulkImportRecord): Promise<{ import: ImportView; items: ImportItemView[] }> {
  const items = await listPendingTools({ importId: found.id, limit: null });
  return {
    import: toImportView(found),
    items: items.sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0)).map(toImportItemView),
  };
}

/** The card for a change to some of an import's rows: the file, and each row by name. */
async function rowsPreview(
  importId: string,
  rowIds: readonly string[],
  key: string,
  rows: (found: PendingTool[]) => ActionPreviewRow[]
): Promise<ActionPreview | null> {
  const found = await getBulkImport(importId);
  if (!found) return null;
  const owned = await rowsOf(importId, rowIds);
  if (owned.length === 0) return null;
  const file = found.sourceName ?? "pasted list";
  return {
    summary: { key, values: { file, count: owned.length } },
    rows: rows(owned),
    subjectName: file,
    link: importPath(importId),
  };
}

const names = (rows: PendingTool[]) => rows.map((row) => row.name).join(", ");

const IMPORT_ID = z.string().min(1).max(64).describe("The import's id, from list_imports or the page");
const ROW_IDS = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(IMPORT_MAX_ITEMS)
  .describe("The import rows' ids, from list_imports or the page's selection");

// ── imports.confirm_columns ─────────────────────────────────────────

/** The mapping step's **Continue**: the rows are created from the confirmed matches. */
export const IMPORTS_CONFIRM_COLUMNS = defineAction<
  { importId: string; columnMap: (string | null)[] },
  { import: ImportView; items: ImportItemView[] },
  ImportRefusal
>({
  id: "imports.confirm_columns",
  toolName: "confirm_import_columns",
  description: "Confirm which column of an imported list holds which field.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  assistant: "never",
  neverReason: "Matching columns is a form of choices made looking at the file's columns, not a sentence (like the mirror mapping, §4.9 #51)",
  input: z.strictObject({ importId: id, columnMap: z.array(z.enum(IMPORT_FIELDS).nullable()).max(200) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "import", id: input.importId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  run: async (input) => {
    const confirmed = await confirmImportMapping(input.importId, input.columnMap as never);
    if (!confirmed.ok) return { ok: false, error: confirmed.error };
    const fresh = await getBulkImport(input.importId);
    if (!fresh) return { ok: false, error: "not_found" };
    return { ok: true, value: await snapshot(fresh), committed: true };
  },
});

// ── imports.edit_row ────────────────────────────────────────────────

const rowPatch = z.strictObject({
  name: line.min(1).optional(),
  brand: optionalLine.optional(),
  categoryHint: optionalLine.optional(),
  locationHint: optionalLine.optional(),
  quantity: z.number().int().min(1).max(IMPORT_MAX_QUANTITY).optional(),
  duplicateResolution: z.enum(["new_tool", "add_unit", "discard"]).nullable().optional(),
});

/**
 * One row's inline edit: name, brand, hints, quantity or the duplicate
 * decision, through `updatePendingTool` — so a new name re-runs the duplicate
 * check, against the rest of the import too.
 */
export const IMPORTS_EDIT_ROW = defineAction<
  { importId: string; id: string; patch: z.infer<typeof rowPatch> },
  { items: ImportItemView[] },
  ImportRefusal
>({
  id: "imports.edit_row",
  toolName: "edit_import_row",
  description:
    "Edit one row of an imported list before research: its name, brand, category or location hint, quantity, or duplicate decision. Only the fields passed change. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  input: z.strictObject({ importId: id, id, patch: rowPatch }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(
    z.strictObject({
      import_id: IMPORT_ID,
      row_id: z.string().min(1).max(64).describe("The row's id, from list_imports"),
      name: z.string().min(1).max(200).optional(),
      brand: z.string().max(200).nullable().optional(),
      category_hint: z.string().max(200).nullable().optional(),
      location_hint: z.string().max(200).nullable().optional(),
      quantity: z.number().int().min(1).max(IMPORT_MAX_QUANTITY).optional().describe("How many units approval creates"),
      duplicate_resolution: z.enum(["new_tool", "add_unit", "discard"]).optional(),
    }),
    (args) => {
      const patch: z.infer<typeof rowPatch> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.brand !== undefined) patch.brand = args.brand;
      if (args.category_hint !== undefined) patch.categoryHint = args.category_hint;
      if (args.location_hint !== undefined) patch.locationHint = args.location_hint;
      if (args.quantity !== undefined) patch.quantity = args.quantity;
      if (args.duplicate_resolution !== undefined) patch.duplicateResolution = args.duplicate_resolution;
      if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
      return { ok: true, inputs: [{ importId: args.import_id, id: args.row_id, patch }] };
    }
  ),
  preview: (input) =>
    rowsPreview(input.importId, [input.id], "imports_edit_row", ([row]) => {
      const out: ActionPreviewRow[] = [];
      const add = (field: string, after: unknown, before: unknown) => {
        if (after !== undefined) out.push({ field, before: before === null || before === undefined ? null : String(before), after: after === null ? null : String(after) });
      };
      add("name", input.patch.name, row.name);
      add("brand", input.patch.brand, row.brand);
      add("categoryHint", input.patch.categoryHint, row.categoryHint);
      add("locationHint", input.patch.locationHint, row.locationHint);
      add("quantity", input.patch.quantity, row.quantity);
      add("duplicateResolution", input.patch.duplicateResolution, row.duplicateResolution);
      return out;
    }),
  run: async (input) => {
    if ((await rowsOf(input.importId, [input.id])).length === 0) return { ok: false, error: "not_found" };
    const updated = await updatePendingTool(input.id, input.patch);
    if (!updated.ok) return { ok: false, error: updated.reason };
    return { ok: true, value: { items: [toImportItemView(updated.item)] }, committed: true };
  },
});

// ── imports.set_hints ───────────────────────────────────────────────

/** **Set category** / **Set location** on the chosen rows. */
export const IMPORTS_SET_HINTS = defineAction<
  { importId: string; ids: string[]; categoryHint?: string | null; locationHint?: string | null },
  { items: ImportItemView[] },
  ImportRefusal
>({
  id: "imports.set_hints",
  toolName: "set_import_hints",
  description:
    "Set the category hint and/or location hint on several rows of an imported list at once. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  input: z.strictObject({ importId: id, ids, categoryHint: optionalLine.optional(), locationHint: optionalLine.optional() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "import", id: input.importId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(
    z.strictObject({
      import_id: IMPORT_ID,
      row_ids: ROW_IDS,
      category_hint: z.string().max(200).nullable().optional(),
      location_hint: z.string().max(200).nullable().optional(),
    }),
    (args) => {
      if (args.category_hint === undefined && args.location_hint === undefined) return { ok: false, error: "nothing_to_change" };
      return {
        ok: true,
        inputs: [
          {
            importId: args.import_id,
            ids: args.row_ids,
            ...(args.category_hint !== undefined ? { categoryHint: args.category_hint } : {}),
            ...(args.location_hint !== undefined ? { locationHint: args.location_hint } : {}),
          },
        ],
      };
    }
  ),
  preview: (input) =>
    rowsPreview(input.importId, input.ids, "imports_set_hints", (rows) => [
      { field: "rows", before: null, after: names(rows) },
      ...(input.categoryHint !== undefined ? [{ field: "categoryHint", before: null, after: input.categoryHint }] : []),
      ...(input.locationHint !== undefined ? [{ field: "locationHint", before: null, after: input.locationHint }] : []),
    ]),
  run: async (input) => {
    if (input.categoryHint === undefined && input.locationHint === undefined) return { ok: false, error: "invalid_field" };
    const changed = await setImportHints(input.importId, input.ids, {
      ...(input.categoryHint !== undefined ? { categoryHint: input.categoryHint } : {}),
      ...(input.locationHint !== undefined ? { locationHint: input.locationHint } : {}),
    });
    return { ok: true, value: { items: await itemsOf(input.importId, changed) }, committed: true };
  },
});

// ── imports.remove_rows ─────────────────────────────────────────────

/**
 * **Remove** — the rows are discarded, like the chat card's Remove. Catalog
 * risk, not destructive: they were never researched and nothing links to them
 * yet. Refused in a tainted turn and never offered over MCP.
 */
export const IMPORTS_REMOVE_ROWS = defineAction<{ importId: string; ids: string[] }, { items: ImportItemView[] }, ImportRefusal>({
  id: "imports.remove_rows",
  toolName: "remove_import_rows",
  description:
    "Remove rows from an imported list before research (they are discarded, never researched). Proposes the removal; nothing changes until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  // It discards, like `pending.discard`, but a list's rows before research are
  // the list owner's own tidying, so it batches and asks no typed name. What it
  // may not do is follow the rows' own text: never from a turn that read
  // outside content — `list_imports` included — and never over MCP (§8.4).
  refuseWhenTainted: true,
  mcp: "never",
  input: z.strictObject({ importId: id, ids }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "import", id: input.importId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(z.strictObject({ import_id: IMPORT_ID, row_ids: ROW_IDS }), (args) => ({
    ok: true,
    inputs: [{ importId: args.import_id, ids: args.row_ids }],
  })),
  preview: (input) => rowsPreview(input.importId, input.ids, "imports_remove_rows", (rows) => [{ field: "rows", before: null, after: names(rows) }]),
  run: async (input) => {
    const owned = await rowsOf(input.importId, input.ids);
    for (const row of owned) await discardPendingTool(row.id);
    return { ok: true, value: { items: await itemsOf(input.importId, owned.map((row) => row.id)) }, committed: true };
  },
});

// ── imports.merge_row ───────────────────────────────────────────────

/** **Merge into row N** — a row listed twice becomes more units of the earlier one. */
export const IMPORTS_MERGE_ROW = defineAction<{ importId: string; sourceId: string; targetId: string }, { items: ImportItemView[] }, ImportRefusal>({
  id: "imports.merge_row",
  toolName: "merge_import_row",
  description:
    "Merge one row of an imported list into another (a machine listed twice becomes more units of the kept row). Proposes the merge; nothing changes until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  input: z.strictObject({ importId: id, sourceId: id, targetId: id }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.sourceId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(
    z.strictObject({
      import_id: IMPORT_ID,
      source_row_id: z.string().min(1).max(64).describe("The row that goes away"),
      target_row_id: z.string().min(1).max(64).describe("The row it becomes more units of"),
    }),
    (args) => ({ ok: true, inputs: [{ importId: args.import_id, sourceId: args.source_row_id, targetId: args.target_row_id }] })
  ),
  preview: async (input) => {
    const owned = await rowsOf(input.importId, [input.sourceId, input.targetId]);
    const source = owned.find((row) => row.id === input.sourceId);
    const target = owned.find((row) => row.id === input.targetId);
    if (!source || !target) return null;
    return rowsPreview(input.importId, [input.sourceId], "imports_merge_row", () => [
      { field: "mergeInto", before: source.name, after: target.name },
      { field: "quantity", before: String(target.quantity), after: String(target.quantity + source.quantity) },
    ]);
  },
  run: async (input) => {
    const merged = await mergeImportRows(input.importId, { sourceId: input.sourceId, targetId: input.targetId });
    if (!merged.ok) return { ok: false, error: merged.reason };
    return { ok: true, value: { items: await itemsOf(input.importId, [input.sourceId, input.targetId]) }, committed: true };
  },
});

// ── imports.decide_suggestions ──────────────────────────────────────

/**
 * **Accept** / **Accept all exact**: each suggestion becomes the row's name
 * (and brand, when it named one) through `updatePendingTool`, which re-runs the
 * duplicate check (§3.3). **Ignore**: the suggestion goes, the name stays.
 */
export const IMPORTS_DECIDE_SUGGESTIONS = defineAction<
  { importId: string; ids: string[]; decision: "accept" | "ignore" },
  { items: ImportItemView[] },
  ImportRefusal
>({
  id: "imports.decide_suggestions",
  toolName: "decide_import_suggestions",
  description:
    "Accept or ignore the suggested names on rows of an imported list (accepting renames the row to the suggestion). Proposes the decision; nothing changes until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "catalog",
  input: z.strictObject({ importId: id, ids, decision: z.enum(["accept", "ignore"]) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "import", id: input.importId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(
    z.strictObject({ import_id: IMPORT_ID, row_ids: ROW_IDS, decision: z.enum(["accept", "ignore"]) }),
    (args) => ({ ok: true, inputs: [{ importId: args.import_id, ids: args.row_ids, decision: args.decision }] })
  ),
  preview: (input) =>
    rowsPreview(input.importId, input.ids, input.decision === "accept" ? "imports_accept_suggestions" : "imports_ignore_suggestions", (rows) =>
      rows
        .filter((row) => row.nameSuggestion)
        .slice(0, 20)
        .map((row) => ({
          field: "name",
          before: row.name,
          after: input.decision === "accept" ? (row.nameSuggestion?.canonicalName ?? row.name) : row.name,
        }))
    ),
  run: async (input) => {
    const owned = await rowsOf(input.importId, input.ids);
    for (const row of owned) {
      const suggestion = row.nameSuggestion;
      if (!suggestion) continue;
      if (input.decision === "accept") {
        await updatePendingTool(row.id, {
          name: suggestion.canonicalName,
          ...(suggestion.brand ? { brand: suggestion.brand } : {}),
          clearNameSuggestion: true,
        });
      } else {
        await updatePendingTool(row.id, { clearNameSuggestion: true });
      }
    }
    return { ok: true, value: { items: await itemsOf(input.importId, owned.map((row) => row.id)) }, committed: true };
  },
});

// ── imports.request_suggestions ─────────────────────────────────────

const DAY_MS = 24 * 60 * 60_000;

/**
 * **Suggest names** over the chosen rows (§3.3): only rows still `identified`,
 * at most {@link SUGGEST_MAX_ITEMS} a press. A quarter of an item each against
 * the research allowance, charged under the research lock before the run
 * starts (`daily_limit` with what is left otherwise).
 */
export const IMPORTS_REQUEST_SUGGESTIONS = defineAction<{ importId: string; ids: string[] }, { requested: number }, ImportRefusal>({
  id: "imports.request_suggestions",
  toolName: "request_import_suggestions",
  description:
    "Ask for suggested official names for rows of an imported list that are not yet researched (costs a quarter of a research item per row from today's allowance). Proposes the request; nothing starts until the person confirms it on the card.",
  permission: IMPORT_PERMISSION,
  risk: "spend",
  input: z.strictObject({ importId: id, ids: z.array(id).min(1).max(SUGGEST_MAX_ITEMS) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "import", id: input.importId }),
  check: (input, ctx) => importRefusal(input.importId, ctx) as Promise<ImportRefusal | null>,
  tool: toolShape(
    z.strictObject({
      import_id: IMPORT_ID,
      row_ids: z.array(z.string().min(1).max(64)).min(1).max(SUGGEST_MAX_ITEMS).describe("The rows to suggest names for, from list_imports"),
    }),
    (args) => ({ ok: true, inputs: [{ importId: args.import_id, ids: args.row_ids }] })
  ),
  preview: (input) =>
    rowsPreview(input.importId, input.ids, "imports_request_suggestions", (rows) => [
      { field: "rows", before: null, after: names(rows.filter((row) => row.status === "identified")) || null },
    ]),
  run: async (input, ctx) => {
    const userId = ctx.identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    const rows = (await rowsOf(input.importId, input.ids)).filter((row) => row.status === "identified");
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
    return { ok: true, value: { requested: rows.length }, committed: true };
  },
});
