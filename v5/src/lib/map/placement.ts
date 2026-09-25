import type { FloorPlan, MapStation, MapZone } from "./types";

/**
 * Where a tool is on a plan (floor map spec §5.1). Pure: the tool page, the
 * `/map` explorer and the assistant's link all go through `placeTool`, so the
 * three can never disagree about where something is.
 *
 * 1. `locations.map_tag` → a **station** with that id (case-insensitive).
 *    The station's zone is the tool's zone.
 * 2. Otherwise `locations.room` + `locations.zone` → a **zone**, compared
 *    case- and space-insensitively ("Studio 101" / "studio  101").
 * 3. Otherwise the tool is **not on the map**, and the page says so rather
 *    than guessing a region (Article 4). "Unknown / Unknown" lands here.
 */

/** The fields of a `MakerLabTool` placement reads. */
export interface PlaceableTool {
  mapId: string | null;
  location: string;
  zone: string;
}

export interface ToolPlace {
  zone: MapZone;
  /** Present only when the tool's map tag names a station on this plan. */
  station: MapStation | null;
}

export function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameKey(room: string, zone: string): string {
  return `${normalizePlaceName(room)}\u0000${normalizePlaceName(zone)}`;
}

export interface PlanIndex {
  plan: FloorPlan;
  zoneById: Map<string, MapZone>;
  zoneByName: Map<string, MapZone>;
  stationById: Map<string, MapStation>;
}

export function indexPlan(plan: FloorPlan): PlanIndex {
  const zoneById = new Map(plan.zones.map((z) => [z.id.toUpperCase(), z] as const));
  const zoneByName = new Map(plan.zones.map((z) => [nameKey(z.room, z.zone), z] as const));
  const stationById = new Map(plan.stations.map((s) => [s.id.toUpperCase(), s] as const));
  return { plan, zoneById, zoneByName, stationById };
}

export function placeTool(index: PlanIndex, tool: PlaceableTool): ToolPlace | null {
  if (tool.mapId) {
    const station = index.stationById.get(tool.mapId.trim().toUpperCase());
    const zone = station ? index.zoneById.get(station.zoneId.toUpperCase()) : undefined;
    if (station && zone) return { zone, station };
  }
  const zone = index.zoneByName.get(nameKey(tool.location, tool.zone));
  return zone ? { zone, station: null } : null;
}

/**
 * What `?highlight=` names: a station tag (`1C`) or a zone id (`Z4`). A
 * station highlights itself and its zone; a zone highlights itself. Anything
 * else highlights nothing — a stale link opens the plain map.
 */
export function resolveHighlight(index: PlanIndex, id: string | null | undefined): ToolPlace | null {
  if (!id) return null;
  const key = id.trim().toUpperCase();
  const station = index.stationById.get(key);
  if (station) {
    const zone = index.zoneById.get(station.zoneId.toUpperCase());
    return zone ? { zone, station } : null;
  }
  const zone = index.zoneById.get(key);
  return zone ? { zone, station: null } : null;
}

/** The id a place is linked by: the station's tag when there is one, else the zone's. */
export function placeId(place: ToolPlace): string {
  return place.station?.id ?? place.zone.id;
}

export interface Placement<T> {
  /** Tools per zone id, in the order given. Every zone has an entry, empty or not. */
  byZone: Map<string, T[]>;
  /** Tools per station id — only stations holding at least one tool. */
  byStation: Map<string, T[]>;
  /** Tools that match nothing on this plan — listed under the map, never dropped. */
  unplaced: T[];
}

export function placeTools<T extends PlaceableTool>(index: PlanIndex, tools: readonly T[]): Placement<T> {
  const byZone = new Map<string, T[]>(index.plan.zones.map((z) => [z.id, []]));
  const byStation = new Map<string, T[]>();
  const unplaced: T[] = [];
  for (const tool of tools) {
    const place = placeTool(index, tool);
    if (!place) {
      unplaced.push(tool);
      continue;
    }
    byZone.get(place.zone.id)!.push(tool);
    if (place.station) {
      const list = byStation.get(place.station.id) ?? [];
      list.push(tool);
      byStation.set(place.station.id, list);
    }
  }
  return { byZone, byStation, unplaced };
}

/**
 * The shade step for a zone holding `count` tools: 0 for empty, then 1–4 by
 * quartile of the busiest zone. Steps, not a continuous ramp — four tonal
 * plates read at a glance, and the number is printed in the zone anyway
 * (DESIGN.md §2.5: say the numbers).
 */
export function densityStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** The `/map` link that opens the full plan with one place picked out. */
export function mapHref(id: string): string {
  return `/map?highlight=${encodeURIComponent(id)}`;
}
