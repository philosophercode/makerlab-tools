import { indexPlan, mapHref, placeId, placeTool, type PlaceableTool, type ToolPlace } from "./placement";
import { FLOOR_PLANS } from "./studio-101";
import type { FloorPlan } from "./types";

/**
 * "Where is it?" for one tool, against the plans the app knows (spec §5.1,
 * §5.4). The tool page's thumbnail and the assistant's answer both call this,
 * so the words a student reads and the region the map lights up come from one
 * place.
 */

const INDEXES = FLOOR_PLANS.map(indexPlan);

export interface ToolLocation {
  plan: FloorPlan;
  place: ToolPlace;
  /** `/map?highlight=<station tag or zone id>`. */
  href: string;
}

export function locateTool(tool: PlaceableTool): ToolLocation | null {
  for (const index of INDEXES) {
    const place = placeTool(index, tool);
    if (place) return { plan: index.plan, place, href: mapHref(placeId(place)) };
  }
  return null;
}

/**
 * The assistant's view of a location (`get_tool_details` → `map`): English
 * words and a link, never coordinates. Null when the tool is not on any plan
 * — the model then says "not on the map yet" rather than guessing a room.
 */
export interface ToolMapFacts {
  zone: string;
  zone_number: string;
  room: string;
  station: string | null;
  station_label: string | null;
  map_page: string;
}

export function mapFactsFor(tool: PlaceableTool): ToolMapFacts | null {
  const located = locateTool(tool);
  if (!located) return null;
  const { zone, station } = located.place;
  return {
    zone: zone.zone,
    zone_number: zone.number,
    room: zone.room,
    station: station?.id ?? null,
    station_label: station?.label ?? null,
    map_page: located.href,
  };
}
