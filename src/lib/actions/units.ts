import "server-only";

import { z } from "zod";
import { countMaintenanceLogsForUnit, listUnitsForTool, type NewUnit, type UnitPatch, type UnitRecord } from "../data/units";
import { getDb } from "../db/client";
import { UNIT_CONDITION, UNIT_STATUS } from "../db/schema/vocabulary";
import {
  addUnit as addUnitWrite,
  editUnit as editUnitWrite,
  removeUnit,
  retireUnitForTool,
  type UnitWritePayload,
} from "../inventory/unit-edits";
import {
  INVENTORY_REVALIDATE,
  inventoryOutcome,
  revisionInputFor,
  tellMirror,
  TOOL_REF,
  toolPage,
  toolRef,
  toolRevisionInput,
  writeContext,
  type InventoryRefusal,
  type InventoryValue,
  type ToolRevisionInput,
} from "./catalog-write";
import { defineAction, toolShape, type ActionPreview, type ActionPreviewRow } from "./define";

/**
 * A tool's units, from the editor's Units section (assistant–GUI parity spec
 * §4.4 #31–32, §9 phase 4): add, edit, retire, delete. Moved from
 * `app/admin/inventory/unit-actions.ts`.
 *
 * `tools.edit`, the tool's revision on every one (a unit write touches the
 * tool row in the same transaction, so a card made before somebody's save
 * answers `conflict`), no audit (§4.11: an ordinary edit), the mirror told.
 * **Delete** is destructive for the assistant — typed confirmation, one at a
 * time — and usually refuses anyway (`unit_has_history`): retire is the
 * answer for a machine with a past.
 */

type UnitValue = InventoryValue<UnitWritePayload>;

const unitFields = {
  unitLabel: z.string().optional(),
  serialNumber: z.string().nullable().optional(),
  assetTag: z.string().nullable().optional(),
  status: z.string().optional(),
  condition: z.string().nullable().optional(),
  dateAcquired: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
};

/** What the model may set on a unit: capped, described, vocabulary as enums. */
const unitArgs = {
  serial_number: z.string().max(200).nullable().optional().describe("The serial number; null clears it"),
  asset_tag: z.string().max(200).nullable().optional().describe("The lab's asset tag; null clears it"),
  status: z.enum(UNIT_STATUS).optional().describe("available, in_use, under_maintenance, out_of_service or retired"),
  condition: z.enum(UNIT_CONDITION).nullable().optional().describe("excellent, good, fair, needs_repair or new; null for unknown"),
  date_acquired: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .describe("YYYY-MM-DD; null clears it"),
  notes: z.string().max(2000).nullable().optional().describe("Notes about this machine; null clears them"),
};

type UnitArgs = { [K in keyof typeof unitArgs]?: z.infer<(typeof unitArgs)[K]> };

function patchFrom(args: UnitArgs & { label?: string }): UnitPatch {
  const patch: UnitPatch = {};
  if (args.label !== undefined) patch.unitLabel = args.label;
  if (args.serial_number !== undefined) patch.serialNumber = args.serial_number;
  if (args.asset_tag !== undefined) patch.assetTag = args.asset_tag;
  if (args.status !== undefined) patch.status = args.status;
  if (args.condition !== undefined) patch.condition = args.condition;
  if (args.date_acquired !== undefined) patch.dateAcquired = args.date_acquired;
  if (args.notes !== undefined) patch.notes = args.notes;
  return patch;
}

/** Field name on the card, and the unit column it shows. */
const UNIT_ROWS: { field: string; key: keyof UnitPatch; format?: ActionPreviewRow["format"] }[] = [
  { field: "unitLabel", key: "unitLabel" },
  { field: "serialNumber", key: "serialNumber" },
  { field: "assetTag", key: "assetTag" },
  { field: "unitStatus", key: "status", format: "unitStatus" },
  { field: "condition", key: "condition", format: "unitCondition" },
  { field: "dateAcquired", key: "dateAcquired" },
  { field: "notes", key: "notes" },
];

/** Before → after for the fields a patch sets. */
function unitRows(before: UnitRecord | null, patch: UnitPatch): ActionPreviewRow[] {
  return UNIT_ROWS.filter((row) => patch[row.key] !== undefined).map((row) => ({
    field: row.field,
    before: before ? ((before[row.key] as string | null) ?? null) : null,
    after: (patch[row.key] as string | null) ?? null,
    ...(row.format ? { format: row.format } : {}),
  }));
}

/** The tool and one of its units, as they are now. Null when either is gone or the card's ref never resolved. */
async function toolAndUnit(input: ToolRevisionInput & { unitId?: string }) {
  if (!input.expectedRevision) return null;
  const tool = await toolRef(input.toolId);
  if (!tool) return null;
  if (input.unitId === undefined) return { tool, unit: null };
  const unit = (await listUnitsForTool(await getDb(), tool.id)).find((row) => row.id === input.unitId) ?? null;
  return unit ? { tool, unit } : null;
}

function unitPreview(
  found: NonNullable<Awaited<ReturnType<typeof toolAndUnit>>>,
  key: string,
  label: string,
  rows: ActionPreviewRow[]
): ActionPreview {
  return {
    summary: { key, values: { tool: found.tool.name, label } },
    rows,
    subjectName: label,
    link: toolPage(found.tool.slug),
  };
}

const UNIT_ID = z.string().min(1).max(64).describe("The unit's id, from get_tool_units");

// ── units.add ───────────────────────────────────────────────────────

/** **Add unit**. A duplicate serial refuses with `duplicate_serial` (§4.5). */
export const UNITS_ADD = defineAction<ToolRevisionInput & { unit: NewUnit }, UnitValue, InventoryRefusal>({
  id: "units.add",
  toolName: "add_unit",
  description:
    "Add a unit (one physical machine) to a tool, with its label and optionally serial number, asset tag, status, condition, date acquired and notes. Proposes the addition; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({ unit: z.object({ ...unitFields, unitLabel: z.string() }) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({ tool_id: TOOL_REF, label: z.string().min(1).max(100).describe("How the unit is asked for at the desk: \"Prusa #3\""), ...unitArgs }),
    async (args) => {
      const unit = patchFrom(args) as NewUnit;
      return { ok: true, inputs: [{ ...(await revisionInputFor(args.tool_id)), unit }] };
    }
  ),
  preview: async (input) => {
    const found = await toolAndUnit(input);
    return found ? unitPreview(found, "units_add", input.unit.unitLabel, unitRows(null, input.unit)) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await addUnitWrite(writeContext(input, ctx), input.unit)),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

// ── units.edit ──────────────────────────────────────────────────────

/** Edit label, serial, asset tag, status, condition, date acquired or notes. */
export const UNITS_EDIT = defineAction<ToolRevisionInput & { unitId: string; patch: UnitPatch }, UnitValue, InventoryRefusal>({
  id: "units.edit",
  toolName: "edit_unit",
  description:
    "Change one unit's label, serial number, asset tag, status (e.g. out_of_service), condition, date acquired or notes. Only the fields passed change. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({ unitId: z.string(), patch: z.object(unitFields) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "unit", id: input.unitId }),
  tool: toolShape(
    z.strictObject({ tool_id: TOOL_REF, unit_id: UNIT_ID, label: z.string().min(1).max(100).optional().describe("A new label"), ...unitArgs }),
    async (args) => {
      const patch = patchFrom(args);
      if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
      return { ok: true, inputs: [{ ...(await revisionInputFor(args.tool_id)), unitId: args.unit_id, patch }] };
    }
  ),
  preview: async (input) => {
    const found = await toolAndUnit(input);
    return found?.unit ? unitPreview(found, "units_edit", found.unit.unitLabel, unitRows(found.unit, input.patch)) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await editUnitWrite(writeContext(input, ctx), input.unitId, input.patch)),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

// ── units.retire ────────────────────────────────────────────────────

/** **Retire** — the answer for a machine that is gone but has a history (§5.3 "Deleting"). */
export const UNITS_RETIRE = defineAction<ToolRevisionInput & { unitId: string }, UnitValue, InventoryRefusal>({
  id: "units.retire",
  toolName: "retire_unit",
  description:
    "Retire one unit that has left the lab; its maintenance history stays. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({ unitId: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "unit", id: input.unitId }),
  tool: toolShape(z.strictObject({ tool_id: TOOL_REF, unit_id: UNIT_ID }), async (args) => ({
    ok: true,
    inputs: [{ ...(await revisionInputFor(args.tool_id)), unitId: args.unit_id }],
  })),
  preview: async (input) => {
    const found = await toolAndUnit(input);
    return found?.unit ? unitPreview(found, "units_retire", found.unit.unitLabel, unitRows(found.unit, { status: "retired" })) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await retireUnitForTool(writeContext(input, ctx), input.unitId)),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

// ── units.delete ────────────────────────────────────────────────────

/**
 * **Delete** a unit, which usually refuses: `unit_has_history` is the
 * refusal the panel turns into "retire it instead". The assistant is told
 * the same before any card is drawn.
 */
export const UNITS_DELETE = defineAction<ToolRevisionInput & { unitId: string }, UnitValue, InventoryRefusal>({
  id: "units.delete",
  toolName: "delete_unit",
  description:
    "Delete one unit entered by mistake. A unit with any maintenance history cannot be deleted — retire it instead. Proposes the deletion; nothing changes until the person types the unit's label on the card and confirms.",
  permission: "tools.edit",
  risk: "destructive",
  input: toolRevisionInput.extend({ unitId: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "unit", id: input.unitId }),
  // Refused before a card is drawn: a card the click can only refuse helps nobody.
  proposeCheck: async (input) => ((await countMaintenanceLogsForUnit(await getDb(), input.unitId).catch(() => 0)) > 0 ? "unit_has_history" : null),
  tool: toolShape(z.strictObject({ tool_id: TOOL_REF, unit_id: UNIT_ID }), async (args) => ({
    ok: true,
    inputs: [{ ...(await revisionInputFor(args.tool_id)), unitId: args.unit_id }],
  })),
  preview: async (input) => {
    const found = await toolAndUnit(input);
    return found?.unit ? unitPreview(found, "units_delete", found.unit.unitLabel, []) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await removeUnit(writeContext(input, ctx), input.unitId)),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});
