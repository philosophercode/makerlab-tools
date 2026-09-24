"use server";

import type { NewUnit, UnitPatch } from "../../../lib/data/units";
import {
  addUnit as addUnitWrite,
  editUnit as editUnitWrite,
  removeUnit as removeUnitWrite,
  retireUnitForTool,
  type UnitWritePayload,
} from "../../../lib/inventory/unit-edits";
import type { InventoryActionResult } from "./action-result";
import { withToolEdit, type ToolWriteInput } from "./tool-write-context";

/**
 * The Units section of the tool editor (spec §5.3(3), §4.5).
 *
 * Its own module because the panel fires these one at a time, without a full
 * save: adding a machine, marking one out of service and correcting a serial
 * number are three separate acts, and the person doing them is usually standing
 * in front of the machine.
 *
 * **Each one gates itself on `tools.edit`** — a server action is a POST
 * endpoint reachable without the panel — and each carries the panel's revision
 * token, so a unit write refuses if somebody else has touched this tool since
 * the panel opened. The write itself touches the tool in the same transaction
 * (see `src/lib/inventory/tool-transaction.ts`), which is what makes the tool's
 * token mean something for a unit-only edit.
 *
 * **No audit events**: a unit going out of service is an ordinary edit (§4.11).
 */

/** Add a unit. A duplicate serial refuses with `duplicate_serial`; §4.5. */
export async function addUnit(
  input: ToolWriteInput & { unit: NewUnit }
): Promise<InventoryActionResult<UnitWritePayload>> {
  return withToolEdit(input, (context) => addUnitWrite(context, input.unit));
}

/** Edit label, serial, asset tag, status, condition, date acquired or notes. */
export async function editUnit(
  input: ToolWriteInput & { unitId: string; patch: UnitPatch }
): Promise<InventoryActionResult<UnitWritePayload>> {
  return withToolEdit(input, (context) => editUnitWrite(context, input.unitId, input.patch));
}

/**
 * Retire a unit — the answer for a machine that is gone but has a history,
 * which is most of them (§5.3 "Deleting").
 */
export async function retireUnit(
  input: ToolWriteInput & { unitId: string }
): Promise<InventoryActionResult<UnitWritePayload>> {
  return withToolEdit(input, (context) => retireUnitForTool(context, input.unitId));
}

/**
 * Delete a unit, which usually refuses.
 *
 * `unit_has_history` is the refusal the panel turns into "retire it instead":
 * `maintenance_logs.unit_id` is `on delete set null`, so Postgres would let the
 * delete through and quietly detach every ticket filed against the machine.
 */
export async function deleteUnit(
  input: ToolWriteInput & { unitId: string }
): Promise<InventoryActionResult<UnitWritePayload>> {
  return withToolEdit(input, (context) => removeUnitWrite(context, input.unitId));
}
