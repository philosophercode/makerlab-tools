import { useId } from "react";
import type { FloorPlan, MapPoint, MapStation, MapZone } from "../../lib/map/types";
import { densityStep, type ToolPlace } from "../../lib/map/placement";
import "../../styles/floor-map.css";

/**
 * The floor map (floor map spec §6.1): one inline SVG drawn from a
 * `FloorPlan`, used as a thumbnail on the tool page and full size on `/map`.
 *
 * No directive and no state, so a server component (the tool page) and a
 * client island (the `/map` explorer) can both render it. Every string
 * arrives translated through `labels`.
 *
 * - **`mode="thumbnail"`** is one picture (`role="img"`) with a sentence for
 *   a name — "Form 4 is in zone 2, 3D Printing Hub" — and nothing focusable
 *   inside it: the page offers one "Open map" link beside it instead of
 *   twenty-two tab stops.
 * - **`mode="full"`** makes every zone and station a real link
 *   (`<a href>` inside the SVG — focusable, activated by Enter, works with no
 *   JavaScript). `onSelect`, when given, takes the click instead so the
 *   explorer can update without a navigation. The explorer also renders the
 *   same places as a list, which is the map's text alternative.
 */

export interface FloorMapLabels {
  /** The SVG's accessible name. */
  title: string;
  /** A zone link's name: "Zone 3, Machining Shop, 57 tools". */
  zone: (zone: MapZone, count: number) => string;
  /** A station link's name: "1C, Vinyl Cutting Station, 1 tool". */
  station: (station: MapStation, count: number) => string;
  /** The small count under a zone's number: "57 TOOLS". */
  zoneCount?: (count: number) => string;
}

export interface FloorMapProps {
  plan: FloorPlan;
  labels: FloorMapLabels;
  mode: "thumbnail" | "full";
  /** Tools per zone id; shades the zones when given. */
  zoneCounts?: ReadonlyMap<string, number>;
  /** Tools per station id. */
  stationCounts?: ReadonlyMap<string, number>;
  /** Where "it" is — the tool on its page, or `?highlight=` on `/map`. */
  here?: ToolPlace | null;
  /** Zones / stations holding a tool the search matched. */
  matchedZones?: ReadonlySet<string>;
  matchedStations?: ReadonlySet<string>;
  selectedZoneId?: string | null;
  /** The link each place goes to (full mode). */
  hrefFor?: (id: string) => string;
  onSelect?: (id: string) => void;
  className?: string;
}

function points(polygon: readonly MapPoint[]): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

const TAG_W = 56;
const TAG_H = 34;

export function FloorMap({
  plan,
  labels,
  mode,
  zoneCounts,
  stationCounts,
  here = null,
  matchedZones,
  matchedStations,
  selectedZoneId = null,
  hrefFor,
  onSelect,
  className,
}: FloorMapProps) {
  const gridId = `${useId()}-grid`;
  const titleId = `${gridId}-title`;
  const full = mode === "full";
  const { x, y, w, h } = plan.viewBox;
  const max = zoneCounts ? Math.max(0, ...zoneCounts.values()) : 0;

  // In the thumbnail only the station that is "here" is drawn: seventeen tags
  // at 320px are noise, one is the answer.
  // A thumbnail draws its one tag twice as big, so it still reads at 320px.
  const tagScale = full ? 1 : 2;
  const stations = full ? plan.stations : plan.stations.filter((s) => s.id === here?.station?.id);

  function activate(id: string) {
    return onSelect
      ? (event: React.MouseEvent) => {
          event.preventDefault();
          onSelect(id);
        }
      : undefined;
  }

  return (
    <svg
      className={["floor-map", className].filter(Boolean).join(" ")}
      viewBox={`${x} ${y} ${w} ${h}`}
      role={full ? "group" : "img"}
      aria-labelledby={titleId}
      data-mode={mode}
      data-plan={plan.id}
    >
      <title id={titleId}>{labels.title}</title>
      <defs>
        <pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse">
          <rect className="fm-grid" x="0" y="0" width="2" height="2" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${gridId})`} aria-hidden="true" />

      {plan.zones.map((zone) => {
        const count = zoneCounts?.get(zone.id) ?? 0;
        const shape = (
          <>
            <polygon
              className="fm-zone"
              points={points(zone.polygon)}
              data-step={zoneCounts ? densityStep(count, max) : 0}
              data-here={here?.zone.id === zone.id ? "true" : undefined}
              data-match={matchedZones?.has(zone.id) ? "true" : undefined}
              data-selected={selectedZoneId === zone.id ? "true" : undefined}
            />
            <text className="fm-zone-number" x={zone.labelAt[0]} y={zone.labelAt[1]} aria-hidden="true">
              {zone.number}
            </text>
            {full && zoneCounts && labels.zoneCount ? (
              <text className="fm-zone-count" x={zone.labelAt[0]} y={zone.labelAt[1] + 40} aria-hidden="true">
                {labels.zoneCount(count)}
              </text>
            ) : null}
          </>
        );
        return full ? (
          <a
            key={zone.id}
            href={hrefFor?.(zone.id)}
            aria-label={labels.zone(zone, count)}
            data-zone={zone.id}
            onClick={activate(zone.id)}
          >
            {shape}
          </a>
        ) : (
          <g key={zone.id} aria-hidden="true">
            {shape}
          </g>
        );
      })}

      <polygon className="fm-outline" points={points(plan.outline)} aria-hidden="true" />
      {plan.walls.map(([[x1, y1], [x2, y2]], i) => (
        <line key={i} className="fm-wall" x1={x1} y1={y1} x2={x2} y2={y2} aria-hidden="true" />
      ))}

      {stations.map((station) => {
        const count = stationCounts?.get(station.id) ?? 0;
        const tags = station.marks.map(([mx, my], i) => (
          <g key={i}>
            <rect
              className="fm-tag"
              x={mx - (TAG_W * tagScale) / 2}
              y={my - (TAG_H * tagScale) / 2}
              width={TAG_W * tagScale}
              height={TAG_H * tagScale}
            />
            <text className="fm-tag-text" x={mx} y={my} style={tagScale > 1 ? { fontSize: 22 * tagScale } : undefined}>
              {station.id}
            </text>
          </g>
        ));
        const attrs = {
          className: "fm-station",
          "data-station": station.id,
          "data-here": here?.station?.id === station.id ? "true" : undefined,
          "data-match": matchedStations?.has(station.id) ? "true" : undefined,
          "data-empty": full && stationCounts && count === 0 ? "true" : undefined,
        };
        return full ? (
          <a
            key={station.id}
            {...attrs}
            href={hrefFor?.(station.id)}
            aria-label={labels.station(station, count)}
            onClick={activate(station.id)}
          >
            {tags}
          </a>
        ) : (
          <g key={station.id} {...attrs} aria-hidden="true">
            {tags}
          </g>
        );
      })}
    </svg>
  );
}
