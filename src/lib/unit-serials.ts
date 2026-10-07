import type { Identity } from "./auth/identity";
import { can } from "./auth/permissions";
import { listUnitSerials } from "./data/catalog";
import type { MakerLabTool, MakerLabUnit } from "../components/catalog-types";

/**
 * Whole unit serial numbers are for staff (data platform spec amendment
 * 2026-10-06); students and visitors see only the last four characters.
 *
 * The catalogue reads (`getCatalogTools`, `getCatalogTool`, the kiosk, the
 * gallery) carry units with **no `serial` field at all**, only
 * `serialMasked` (`•••• 9831`, `lib/serial-mask.ts`), so the cached pages and
 * every answer built from them hold no whole serial. A staff surface swaps in
 * the full serial here, after one check: the tool page's units table, the
 * assistant's focused-tool context, `get_unit_details` and `get_tool_details`
 * (chat and MCP alike). Students and anonymous visitors tell units apart by
 * name ("Bambu X1C #1") and by that masked ending ("the one ending 9831").
 *
 * Enforced on the server: nothing that reaches a non-staff browser, model or
 * MCP client ever had the full serial. Hiding characters in the browser would
 * not be enough.
 */

/** Who may see serials: `catalog.view_serials` (admins and super admins). */
export function canSeeSerials(identity: Pick<Identity, "role"> | null | undefined): boolean {
  return can(identity, "catalog.view_serials");
}

/**
 * The serials of these units, keyed by unit id, for a viewer who may see them,
 * and an empty map (with no query) for anyone else.
 */
export async function serialsForViewer(
  identity: Pick<Identity, "role"> | null | undefined,
  unitIds: readonly string[]
): Promise<Map<string, string>> {
  if (!canSeeSerials(identity) || unitIds.length === 0) return new Map();
  return listUnitSerials(unitIds);
}

/**
 * Units with `serial` set from `serials`, in place of their masked last four;
 * a unit missing from the map is left as it was.
 */
export function withUnitSerials<T extends Pick<MakerLabUnit, "id" | "serialMasked">>(
  units: readonly T[],
  serials: ReadonlyMap<string, string>
): Array<T | (Omit<T, "serialMasked"> & { serial: string })> {
  return units.map((unit) => {
    const serial = serials.get(unit.id);
    if (serial === undefined) return unit;
    const { serialMasked: _masked, ...rest } = unit;
    return { ...rest, serial };
  });
}

/**
 * These units as this viewer may see them: with full serials for staff,
 * unchanged (the masked last four only) for anyone else.
 */
export async function unitsForViewer(
  identity: Pick<Identity, "role"> | null | undefined,
  units: readonly MakerLabUnit[]
): Promise<MakerLabUnit[]> {
  const serials = await serialsForViewer(
    identity,
    units.map((unit) => unit.id)
  );
  return serials.size === 0 ? [...units] : withUnitSerials(units, serials);
}

/** A tool as this viewer may see it: its units with full serials for staff, the same tool for anyone else. */
export async function toolForViewer(
  identity: Pick<Identity, "role"> | null | undefined,
  tool: MakerLabTool
): Promise<MakerLabTool> {
  if (!canSeeSerials(identity) || tool.units.length === 0) return tool;
  return { ...tool, units: await unitsForViewer(identity, tool.units) };
}
