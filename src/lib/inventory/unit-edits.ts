import "server-only";

import {
  createUnit,
  deleteUnit,
  retireUnit,
  updateUnit,
  type NewUnit,
  type UnitPatch,
} from "../data/units";
import type { InventoryWriteResult } from "./result";
import { withTouchedTool, type ToolWriteContext } from "./tool-transaction";

/**
 * The Units section of the tool editor (spec §5.3(3), §4.5).
 *
 * Each write is the unit's statement and a touch of its tool, in one
 * transaction — see `./tool-transaction.ts` for why the tool is touched at all.
 * None of them is audited: a unit going out of service is an ordinary edit
 * (§4.11), however consequential it feels standing next to the machine.
 */

/** What comes back beside the new revision. */
export interface UnitWritePayload {
  unitId: string;
}

/** Add a unit to a tool. A duplicate serial refuses; nothing is written. */
export async function addUnit(
  context: ToolWriteContext,
  input: NewUnit
): Promise<InventoryWriteResult<UnitWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const created = await createUnit(tx, context.toolId, input, context.actorUserId);
    return created.ok ? { ok: true, unitId: created.unitId } : created;
  });
}

/** Edit one of the tool's units — label, serial, asset tag, status, condition, date. */
export async function editUnit(
  context: ToolWriteContext,
  unitId: string,
  patch: UnitPatch
): Promise<InventoryWriteResult<UnitWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const written = await updateUnit(
      tx,
      { toolId: context.toolId, unitId },
      patch,
      context.actorUserId
    );
    return written.ok ? { ok: true, unitId: written.unitId } : written;
  });
}

/**
 * Retire a unit — `status = retired` (§5.3 "Deleting").
 *
 * The answer for a machine that is gone but has a history, which is most of
 * them. Named rather than left to {@link editUnit} because it is the control
 * the panel offers beside a delete that usually refuses.
 */
export async function retireUnitForTool(
  context: ToolWriteContext,
  unitId: string
): Promise<InventoryWriteResult<UnitWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const written = await retireUnit(tx, { toolId: context.toolId, unitId }, context.actorUserId);
    return written.ok ? { ok: true, unitId: written.unitId } : written;
  });
}

/**
 * Delete a unit, only when it has no maintenance history (§5.3 "Deleting").
 *
 * `unit_has_history` is the refusal the panel turns into "retire it instead" —
 * and it is a refusal rather than a cascade because `maintenance_logs.unit_id`
 * is `on delete set null`: Postgres would let the delete through and quietly
 * detach every ticket ever filed against the machine.
 */
export async function removeUnit(
  context: ToolWriteContext,
  unitId: string
): Promise<InventoryWriteResult<UnitWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const deleted = await deleteUnit(tx, { toolId: context.toolId, unitId });
    return deleted.ok ? { ok: true, unitId: deleted.unitId } : deleted;
  });
}
