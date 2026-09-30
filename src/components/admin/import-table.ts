import { hasUnresolvedDuplicate, isResearchable } from "../../lib/intake/access";
import { CONSUMABLE_NOTE } from "../../lib/import/items";
import type { ImportItemView } from "../../lib/import/view";

/**
 * The import review table's rules, apart from its markup (bulk intake spec §5
 * step 3, §6): which rows a filter shows, what a search matches, and which of
 * the selected rows **Research selected** may actually send. Pure, so the
 * table and its tests read the same rules.
 */

export const IMPORT_FILTERS = ["all", "duplicates", "unnamed", "consumables", "suggested", "selected"] as const;
export type ImportFilter = (typeof IMPORT_FILTERS)[number];

/** A row still on the table: everything but a discarded one. */
export function isLive(item: ImportItemView): boolean {
  return item.status !== "discarded";
}

/** The duplicate check matched something — decided or not. */
export function isFlagged(item: ImportItemView): boolean {
  return item.duplicateOf !== null && item.duplicateResolution !== "discard";
}

/**
 * "Needs a name" (§5 step 3): a name with no brand beside it and no model
 * number in it — "Heat gun", "Drill press" — which research would have to
 * guess at. The Suggest names pass is for exactly these.
 */
export function needsName(item: ImportItemView): boolean {
  if (item.brand && item.brand.trim()) return false;
  return !/\d/.test(item.name);
}

export function isConsumable(item: ImportItemView): boolean {
  return (item.notes ?? "").includes(CONSUMABLE_NOTE);
}

/** The rows a filter and a search show, in table order. */
export function visibleRows(
  items: readonly ImportItemView[],
  filter: ImportFilter,
  query: string,
  selected: ReadonlySet<string>
): ImportItemView[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (!isLive(item)) return false;
    switch (filter) {
      case "duplicates":
        if (!isFlagged(item)) return false;
        break;
      case "unnamed":
        if (!needsName(item)) return false;
        break;
      case "consumables":
        if (!isConsumable(item)) return false;
        break;
      case "suggested":
        if (!item.nameSuggestion) return false;
        break;
      case "selected":
        if (!selected.has(item.id)) return false;
        break;
      case "all":
        break;
    }
    if (!needle) return true;
    return [item.name, item.brand, item.categoryHint, item.locationHint, item.notes, item.serials.join(" ")]
      .some((value) => (value ?? "").toLowerCase().includes(needle));
  });
}

/**
 * Which selected rows **Research selected** sends, and why the rest wait:
 * a duplicate nobody has decided on (the research route refuses those), or a
 * row that is not researchable now (researching already, or settled).
 */
export function researchPlan(
  items: readonly ImportItemView[],
  selected: ReadonlySet<string>
): { send: string[]; undecided: string[]; notResearchable: string[] } {
  const send: string[] = [];
  const undecided: string[] = [];
  const notResearchable: string[] = [];
  for (const item of items) {
    if (!selected.has(item.id) || !isLive(item)) continue;
    const researchable = isResearchable({
      status: item.status,
      workflowRunId: item.hasWorkflowRun ? "run" : null,
      duplicateResolution: item.duplicateResolution,
      researchError: item.researchError,
      researchRequestedAt: item.researchRequestedAt,
    });
    if (!researchable) notResearchable.push(item.id);
    else if (hasUnresolvedDuplicate({ duplicateOfToolId: item.duplicateOf?.kind === "tool" ? item.duplicateOf.id : null, duplicateOfPendingId: item.duplicateOf?.kind === "pending" ? item.duplicateOf.id : null, duplicateResolution: item.duplicateResolution })) undecided.push(item.id);
    else send.push(item.id);
  }
  return { send, undecided, notResearchable };
}

/** The row number of the import row a pending duplicate points at, when it is in this import. */
export function sameImportTarget(item: ImportItemView, byId: ReadonlyMap<string, ImportItemView>): ImportItemView | null {
  if (item.duplicateOf?.kind !== "pending") return null;
  const target = byId.get(item.duplicateOf.id);
  return target && isLive(target) ? target : null;
}
