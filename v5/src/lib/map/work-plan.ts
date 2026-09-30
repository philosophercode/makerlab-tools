import { indexPlan, mapHref, placeTool, type PlaceableTool } from "./placement";
import type { FloorPlan, MapStation, MapZone } from "./types";

/**
 * "Where you'll work" (project map): a set of tools — the ones a project
 * used — grouped by the zone each one is in, in the plan's own zone order.
 * Pure, and built on `placeTool`, so the project page, `/map` and the tool
 * page can never disagree about where a tool is.
 *
 * Only zones holding at least one of the tools are listed; a tool the plan
 * cannot place is kept in `unplaced` and said, never dropped or guessed.
 */

export interface WorkPlanEntry<T> {
  tool: T;
  /** The station its map tag names, when there is one. */
  station: MapStation | null;
}

export interface WorkPlanZone<T> {
  zone: MapZone;
  /** `/map?highlight=<zone id>`. */
  href: string;
  tools: WorkPlanEntry<T>[];
}

export interface WorkPlan<T> {
  plan: FloorPlan;
  zones: WorkPlanZone<T>[];
  unplaced: T[];
  /** The zone and station ids to light up on the map. */
  zoneIds: Set<string>;
  stationIds: Set<string>;
}

export function planWork<T extends PlaceableTool>(plan: FloorPlan, tools: readonly T[]): WorkPlan<T> {
  const index = indexPlan(plan);
  const byZone = new Map<string, WorkPlanEntry<T>[]>();
  const unplaced: T[] = [];
  const stationIds = new Set<string>();
  for (const tool of tools) {
    const place = placeTool(index, tool);
    if (!place) {
      unplaced.push(tool);
      continue;
    }
    const list = byZone.get(place.zone.id) ?? [];
    list.push({ tool, station: place.station });
    byZone.set(place.zone.id, list);
    if (place.station) stationIds.add(place.station.id);
  }
  const zones = plan.zones
    .filter((zone) => byZone.has(zone.id))
    .map((zone) => ({ zone, href: mapHref(zone.id), tools: byZone.get(zone.id)! }));
  return { plan, zones, unplaced, zoneIds: new Set(byZone.keys()), stationIds };
}
