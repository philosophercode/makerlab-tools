import { and, asc, count, eq } from "drizzle-orm";
import { maintenanceLogs, units } from "../db/schema/index.ts";
import { isOneOf, UNIT_CONDITION, UNIT_STATUS } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUniqueViolation } from "./pg-errors.ts";
import { isUuid } from "./uuid.ts";
import type { Refused } from "./write-result.ts";

/**
 * Unit writes — the physical machines behind a tool (spec §4.5, §5.3(3)).
 *
 * The editor's Units section adds one, edits label, serial, asset tag, status,
 * condition and date acquired, retires one, and deletes one *only* when it has
 * no maintenance history.
 *
 * **Every function takes the handle first, like `claimAttachments`.** A unit
 * write never travels alone: it runs inside the transaction that also touches
 * its tool, so the tool's revision moves with it and a second editor's stale
 * token stops matching. A unit write that committed while the tool touch rolled
 * back would be a change nobody could detect.
 *
 * **Vocabulary is checked here, before Postgres sees it.** `units_status_check`
 * and `units_condition_check` reject the whole statement with a message no page
 * can render; `invalid_field` is one the editor can put next to the field.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** The fields the editor offers for a unit. */
export interface UnitFields {
  unitLabel: string;
  serialNumber: string | null;
  assetTag: string | null;
  /** One of `UNIT_STATUS`. Defaults to `available` on a new unit. */
  status: string;
  /** One of `UNIT_CONDITION`, or null — unknown is an honest state (§4.5). */
  condition: string | null;
  /** `YYYY-MM-DD`, or null. */
  dateAcquired: string | null;
  notes: string | null;
}

export type NewUnit = Partial<UnitFields> & Pick<UnitFields, "unitLabel">;
export type UnitPatch = Partial<UnitFields>;

/** Which unit, and which tool it has to belong to. */
export interface UnitScope {
  toolId: string;
  unitId: string;
}

export type UnitWriteResult =
  | { ok: true; unitId: string }
  | Refused<"not_found" | "invalid_field" | "duplicate_serial" | "unit_has_history">;

// ── Reading ─────────────────────────────────────────────────────────

/** One unit as the editor lists it — every field the Units section shows. */
export interface UnitRecord extends UnitFields {
  id: string;
}

/**
 * Every unit of one tool, retired ones included, in label order.
 *
 * The editor's list is not the catalogue's: `./catalog.ts` hides retired
 * machines from a visitor, and the one person who has to see a retired unit is
 * the one deciding whether it can finally be deleted.
 */
export async function listUnitsForTool(db: Db, toolId: string): Promise<UnitRecord[]> {
  if (!isUuid(toolId)) return [];

  return db
    .select({
      id: units.id,
      unitLabel: units.unitLabel,
      serialNumber: units.serialNumber,
      assetTag: units.assetTag,
      status: units.status,
      condition: units.condition,
      dateAcquired: units.dateAcquired,
      notes: units.notes,
    })
    .from(units)
    .where(eq(units.toolId, toolId))
    .orderBy(asc(units.unitLabel), asc(units.id));
}

// ── Writing ─────────────────────────────────────────────────────────

/**
 * Add a unit to a tool.
 *
 * A duplicate serial is a refusal, not an error: `units_tool_serial_key` is
 * case-insensitive and per tool, and it exists precisely so that "is this
 * actually a second machine?" gets asked (§4.5). Catching the violation rather
 * than pre-checking keeps the index the arbiter — a pre-check races.
 */
export async function createUnit(
  db: Db,
  toolId: string,
  input: NewUnit,
  actorUserId?: string | null
): Promise<UnitWriteResult> {
  if (!isUuid(toolId)) return { ok: false, reason: "not_found" };

  const values = toUnitValues(input);
  if (!values) return { ok: false, reason: "invalid_field" };
  // A unit's label is how it is asked for at the desk ("the second Form 4").
  if (!values.unitLabel) return { ok: false, reason: "invalid_field" };

  try {
    const [row] = await db
      .insert(units)
      .values({
        ...values,
        unitLabel: values.unitLabel,
        toolId,
        status: values.status ?? "available",
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      })
      .returning({ id: units.id });
    return { ok: true, unitId: row.id };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate_serial" };
    throw err;
  }
}

/**
 * Edit one of a tool's units.
 *
 * Scoped by `tool_id` as well as `id`, so a unit id belonging to another tool
 * is `not_found` rather than an edit the panel never offered. The caller holds
 * `tools.edit` either way — this is about the panel's own integrity, not about
 * privilege.
 */
export async function updateUnit(
  db: Db,
  scope: UnitScope,
  patch: UnitPatch,
  actorUserId?: string | null
): Promise<UnitWriteResult> {
  if (!isUuid(scope.toolId) || !isUuid(scope.unitId)) return { ok: false, reason: "not_found" };

  const values = toUnitValues(patch);
  if (!values) return { ok: false, reason: "invalid_field" };
  if (values.unitLabel !== undefined && !values.unitLabel) {
    return { ok: false, reason: "invalid_field" };
  }

  try {
    const rows = await db
      .update(units)
      .set({ ...values, updatedBy: actorUserId ?? null })
      .where(and(eq(units.id, scope.unitId), eq(units.toolId, scope.toolId)))
      .returning({ id: units.id });
    return rows.length > 0
      ? { ok: true, unitId: rows[0].id }
      : { ok: false, reason: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate_serial" };
    throw err;
  }
}

/**
 * Retire a unit — the answer to "this machine is gone" that keeps its history
 * readable (§5.3 "Deleting"). An ordinary status change, named because it is
 * the one the editor offers beside a delete it usually cannot do.
 */
export async function retireUnit(
  db: Db,
  scope: UnitScope,
  actorUserId?: string | null
): Promise<UnitWriteResult> {
  return updateUnit(db, scope, { status: "retired" }, actorUserId);
}

/**
 * Delete a unit, but only when nothing refers to it (§5.3 "Deleting").
 *
 * `maintenance_logs.unit_id` is `on delete set null`, so Postgres would let
 * this through and quietly detach every ticket ever filed against the machine —
 * the snapshot columns would keep the label readable, but the unit's history
 * would stop being *its* history. A unit with tickets is retired instead, which
 * is why `unit_has_history` is a refusal the panel can explain rather than an
 * error.
 */
export async function deleteUnit(db: Db, scope: UnitScope): Promise<UnitWriteResult> {
  if (!isUuid(scope.toolId) || !isUuid(scope.unitId)) return { ok: false, reason: "not_found" };

  const history = await countMaintenanceLogsForUnit(db, scope.unitId);
  if (history > 0) return { ok: false, reason: "unit_has_history" };

  const rows = await db
    .delete(units)
    .where(and(eq(units.id, scope.unitId), eq(units.toolId, scope.toolId)))
    .returning({ id: units.id });

  return rows.length > 0 ? { ok: true, unitId: rows[0].id } : { ok: false, reason: "not_found" };
}

/** How many maintenance logs name this unit. Zero for anything unresolvable. */
export async function countMaintenanceLogsForUnit(db: Db, unitId: string): Promise<number> {
  if (!isUuid(unitId)) return 0;
  const [row] = await db
    .select({ total: count() })
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.unitId, unitId));
  return row?.total ?? 0;
}

// ── Validation ──────────────────────────────────────────────────────

type UnitValues = Partial<typeof units.$inferInsert>;

/** `YYYY-MM-DD`. The column is a `date`; anything else is a cast error. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The caller's fields as column values, or null when one of them is not a
 * value this column accepts.
 *
 * Only keys the caller sent are included, so editing a serial number does not
 * blank the notes.
 */
function toUnitValues(input: UnitPatch): UnitValues | null {
  const values: UnitValues = {};

  if (input.unitLabel !== undefined) values.unitLabel = input.unitLabel.trim();
  if (input.serialNumber !== undefined) values.serialNumber = emptyToNull(input.serialNumber);
  if (input.assetTag !== undefined) values.assetTag = emptyToNull(input.assetTag);
  if (input.notes !== undefined) values.notes = emptyToNull(input.notes);

  if (input.status !== undefined) {
    if (!isOneOf(UNIT_STATUS, input.status)) return null;
    values.status = input.status;
  }

  if (input.condition !== undefined) {
    // Null is a value here, not an absence: "we do not know what condition it
    // is in" is the honest answer for most imported units.
    if (input.condition !== null && !isOneOf(UNIT_CONDITION, input.condition)) return null;
    values.condition = input.condition;
  }

  if (input.dateAcquired !== undefined) {
    const date = emptyToNull(input.dateAcquired);
    if (date !== null && !ISO_DATE.test(date)) return null;
    values.dateAcquired = date;
  }

  return values;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}
