/**
 * The floor map's shape (floor map spec 2026-09-25 §4). Pure data, no
 * directives: the tool page (server), the `/map` explorer (client) and the
 * tests all import it.
 *
 * The lab's own zone plan ("Latest MakerLAB zone plan", Studio 101, TATA
 * Innovation Center) has two levels, and so does this:
 *
 * - **Zones** — the numbered areas (1 Common Purpose Space … 5 Electronics
 *   Lab). A zone is placed by `locations.room` + `locations.zone`, which the
 *   import already carries with exactly these names.
 * - **Stations** — the lettered labels inside a zone (`1C` Vinyl Cutting
 *   Station, `4A` Trotec Laser Machine). A station's `id` **is** the
 *   `locations.map_tag` it stands for: the printed label on the floor map.
 *
 * Walls are drawn for orientation and are never interactive. Coordinates are
 * in the plan's own units (its `viewBox`), so one drawing serves the tool
 * page's thumbnail and the full `/map` page.
 */

export type MapPoint = readonly [number, number];

export interface MapZone {
  /** Stable id within the plan: `Z1` … `Z5`. */
  id: string;
  /** The number printed in the red circle on the lab's plan. */
  number: string;
  /** `locations.room` / `locations.zone`, exactly as the import spells them. */
  room: string;
  zone: string;
  polygon: readonly MapPoint[];
  /** Where the zone's number and count are drawn. */
  labelAt: MapPoint;
}

export interface MapStation {
  /** The `locations.map_tag` — `1A`, `4B`. The join key. */
  id: string;
  /** The legend's words for it: "Vinyl Cutting Station". Data, not a translated string. */
  label: string;
  zoneId: string;
  /** Where its label sits; a station drawn in two places (`1G`) has two. */
  marks: readonly MapPoint[];
}

export interface FloorPlan {
  /** Stable id, e.g. `studio-101`. */
  id: string;
  /** Bumped whenever the drawing changes; shown on the page and stored with the asset. */
  version: string;
  /** What the plan draws: "Studio 101, TATA Innovation Center". */
  title: string;
  /** Where the drawing came from, said on the page (e.g. "Traced from …"). */
  source: string;
  /**
   * True while the drawing is generated rather than traced from the lab's own
   * plan. The page must then say "placeholder layout", in words.
   */
  placeholder: boolean;
  viewBox: { x: number; y: number; w: number; h: number };
  /** The building's outline. */
  outline: readonly MapPoint[];
  /** Interior walls, as segments. */
  walls: ReadonlyArray<readonly [MapPoint, MapPoint]>;
  zones: readonly MapZone[];
  stations: readonly MapStation[];
}
