import { z } from "zod";
import { placeKey } from "./placement.ts";
import type { FloorPlan, MapPoint } from "./types.ts";

/**
 * The floor plan's schema (lab config spec 2026-10-25 §4, §5.2, amendment
 * §12.6): what `lab/floor-plan.json` must look like, and the checks a schema
 * alone cannot say — every id unique, every station in a zone that exists,
 * zone labels inside their zone, zones not overlapping, everything inside the
 * `viewBox`, no two zones claiming one place name.
 *
 * `z.toJSONSchema` of {@link floorPlanSchema} is committed as
 * `lab/floor-plan.schema.json` (`npm run lab:schema`): the file a lab gives a
 * vision model with its plan image (`docs/map.md`). A test fails when it is
 * stale.
 *
 * The app does not run this: `plan.ts` imports the JSON as the shipped plan,
 * and `lab:check` and the tests validate it. Plain Node loads this file
 * (`scripts/lab-check.ts`), hence the relative `.ts` imports.
 */

const point = z
  .tuple([z.number(), z.number()])
  .describe("[x, y] in the plan's own units, the same units as viewBox");

const nonEmpty = z.string().trim().min(1, "must not be empty");

export const mapZoneSchema = z
  .object({
    id: nonEmpty.describe("Stable id within the plan: Z1, Z2, …"),
    number: nonEmpty.describe("The number printed for the zone on the lab's plan"),
    room: nonEmpty.describe("The inventory's room for this zone (locations.room), exactly as it spells it"),
    zone: nonEmpty.describe("The inventory's zone name (locations.zone), exactly as it spells it"),
    polygon: z.array(point).min(3, "needs at least three points").describe("The zone's outline, in order"),
    labelAt: point.describe("Where the zone's number and tool count are drawn; inside the polygon"),
    matches: z
      .array(nonEmpty)
      .optional()
      .describe(
        'Other inventory place names that mean this zone, "Room" or "Room / Zone", compared ignoring case and spacing'
      ),
  })
  .strict();

export const mapStationSchema = z
  .object({
    id: nonEmpty.describe("The label printed on the plan (1A, 4B); also the tool's locations.map_tag"),
    label: nonEmpty.describe('The legend\'s words for it: "Vinyl Cutting Station"'),
    zoneId: nonEmpty.describe("The id of the zone it stands in"),
    marks: z
      .array(point)
      .min(1, "needs at least one mark")
      .describe("Where its label sits; a station drawn in two places has two"),
  })
  .strict();

export const floorPlanSchema = z
  .object({
    $schema: z.string().optional().describe("Path to this schema, for editors"),
    id: nonEmpty.describe("Stable id, e.g. main-floor"),
    version: nonEmpty.describe("Bumped whenever the drawing changes, e.g. 2026-07-24.1"),
    title: nonEmpty.describe('What the plan draws: "Room 101, Engineering Building"'),
    source: nonEmpty.describe('Where the drawing came from, shown on the page: "Traced from …"'),
    placeholder: z.boolean().describe("True while the drawing is not traced from the lab's own plan"),
    viewBox: z
      .object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
      .strict()
      .describe("The drawing's coordinate box; every point lies inside it"),
    outline: z.array(point).min(3, "needs at least three points").describe("The building's outline"),
    walls: z.array(z.tuple([point, point])).describe("Interior walls, as [from, to] segments"),
    zones: z.array(mapZoneSchema).min(1, "needs at least one zone"),
    stations: z.array(mapStationSchema),
  })
  .strict();

type ParsedPlan = z.infer<typeof floorPlanSchema>;

/** The JSON Schema committed as `lab/floor-plan.schema.json`. */
export function floorPlanJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(floorPlanSchema, { target: "draft-2020-12" }),
    title: "Floor plan",
    description:
      "One floor of a makerspace, traced from its plan: zones (numbered areas) and stations (lettered labels inside a zone). See docs/map.md.",
  };
}

/**
 * Every problem with a plan, one line each with the field's path — empty when
 * it is valid. What `lab:check` prints and fails on.
 */
export function floorPlanIssues(input: unknown): string[] {
  const parsed = floorPlanSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(plan)"}: ${issue.message}`);
  }
  return geometryIssues(parsed.data);
}

/**
 * What may be intended but is worth a look, one line each: a station's mark
 * outside its zone. A printed plan sometimes sets a label beside the area it
 * names (Studio 101's 1H, the sink, is printed across the wall), so
 * `lab:check` prints these without failing.
 */
export function floorPlanWarnings(input: unknown): string[] {
  const parsed = floorPlanSchema.safeParse(input);
  if (!parsed.success) return [];
  const plan = parsed.data;
  const zoneById = new Map(plan.zones.map((z) => [z.id.toUpperCase(), z] as const));
  const warnings: string[] = [];
  plan.stations.forEach((station, si) => {
    const zone = zoneById.get(station.zoneId.toUpperCase());
    if (!zone) return;
    station.marks.forEach((mark, mi) => {
      if (!insidePolygon(mark, zone.polygon)) {
        warnings.push(`stations.${si}.marks.${mi}: station ${station.id}'s mark lies outside zone ${zone.id}`);
      }
    });
  });
  return warnings;
}

function geometryIssues(plan: ParsedPlan): string[] {
  const issues: string[] = [];
  const { x, y, w, h } = plan.viewBox;
  const inBox = ([px, py]: MapPoint) => px >= x && px <= x + w && py >= y && py <= y + h;
  const boxCheck = (path: string, points: readonly MapPoint[]) => {
    points.forEach((p, i) => {
      if (!inBox(p)) issues.push(`${path}.${i}: [${p.join(", ")}] lies outside the viewBox`);
    });
  };

  boxCheck("outline", plan.outline);
  plan.walls.forEach((wall, i) => boxCheck(`walls.${i}`, wall));

  duplicates(plan.zones.map((z) => z.id.toUpperCase())).forEach((id) => issues.push(`zones: the id ${id} is used twice`));
  duplicates(plan.stations.map((s) => s.id.toUpperCase())).forEach((id) =>
    issues.push(`stations: the id ${id} is used twice`)
  );
  duplicates(plan.zones.map((z) => placeKey(`${z.room} / ${z.zone}`))).forEach((name) =>
    issues.push(`zones: two zones have the room and zone "${name}"`)
  );

  // A place name claimed twice would place a tool by list order, a guess (§12.6).
  const claimed = new Map<string, string>();
  plan.zones.forEach((zone, zi) => {
    for (const name of [`${zone.room} / ${zone.zone}`, ...(zone.matches ?? [])]) {
      const key = placeKey(name);
      const owner = claimed.get(key);
      if (owner && owner !== zone.id) issues.push(`zones.${zi}.matches: "${name}" is already ${owner}'s`);
      else claimed.set(key, zone.id);
    }
  });

  const zoneById = new Map(plan.zones.map((z) => [z.id.toUpperCase(), z] as const));
  plan.zones.forEach((zone, zi) => {
    boxCheck(`zones.${zi}.polygon`, zone.polygon);
    if (!insidePolygon(zone.labelAt, zone.polygon)) issues.push(`zones.${zi}.labelAt: lies outside zone ${zone.id}`);
  });
  plan.stations.forEach((station, si) => {
    const zone = zoneById.get(station.zoneId.toUpperCase());
    if (!zone) {
      issues.push(`stations.${si}.zoneId: no zone has the id ${station.zoneId}`);
      return;
    }
    station.marks.forEach((mark, mi) => {
      if (!inBox(mark)) issues.push(`stations.${si}.marks.${mi}: [${mark.join(", ")}] lies outside the viewBox`);
    });
  });

  for (let a = 0; a < plan.zones.length; a++) {
    for (let b = a + 1; b < plan.zones.length; b++) {
      if (polygonsOverlap(plan.zones[a].polygon, plan.zones[b].polygon)) {
        issues.push(`zones: ${plan.zones[a].id} and ${plan.zones[b].id} overlap`);
      }
    }
  }
  return issues;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of values) (seen.has(value) ? twice : seen).add(value);
  return [...twice];
}

const EPSILON = 1e-6;

function cross(o: MapPoint, a: MapPoint, b: MapPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function onSegment(p: MapPoint, a: MapPoint, b: MapPoint): boolean {
  return (
    Math.abs(cross(a, b, p)) <= EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function edges(polygon: readonly MapPoint[]): Array<[MapPoint, MapPoint]> {
  return polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]]);
}

function onBoundary(p: MapPoint, polygon: readonly MapPoint[]): boolean {
  return edges(polygon).some(([a, b]) => onSegment(p, a, b));
}

/** Even-odd ray cast; a point on the boundary counts as inside. */
export function insidePolygon(p: MapPoint, polygon: readonly MapPoint[]): boolean {
  if (onBoundary(p, polygon)) return true;
  return strictlyInside(p, polygon);
}

function strictlyInside([px, py]: MapPoint, polygon: readonly MapPoint[]): boolean {
  let inside = false;
  for (const [[ax, ay], [bx, by]] of edges(polygon)) {
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/**
 * Whether two zones share any area. Zones that only touch, along a shared
 * wall or at a corner, do not overlap: two edges must properly cross, or a
 * point of one (a vertex, an edge's midpoint, or the vertices' average when
 * it lies inside its own zone) lie strictly inside the other.
 */
export function polygonsOverlap(a: readonly MapPoint[], b: readonly MapPoint[]): boolean {
  for (const [p1, p2] of edges(a)) {
    for (const [q1, q2] of edges(b)) {
      const d1 = cross(q1, q2, p1);
      const d2 = cross(q1, q2, p2);
      const d3 = cross(p1, p2, q1);
      const d4 = cross(p1, p2, q2);
      if (d1 * d2 < -EPSILON && d3 * d4 < -EPSILON) return true;
    }
  }
  const probes = (polygon: readonly MapPoint[]): MapPoint[] => [
    ...edges(polygon).flatMap(([p, q]) => [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const]),
    // The vertices' average, so a zone drawn twice on the same outline is
    // caught; only when it lies inside its own zone (a concave one's may not).
    ...[average(polygon)].filter((p) => !onBoundary(p, polygon) && strictlyInside(p, polygon)),
  ];
  const strictly = (p: MapPoint, polygon: readonly MapPoint[]) => !onBoundary(p, polygon) && strictlyInside(p, polygon);
  return probes(a).some((p) => strictly(p, b)) || probes(b).some((p) => strictly(p, a));
}

function average(polygon: readonly MapPoint[]): MapPoint {
  return [polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length, polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length];
}

/** The parsed plan as the app's type: the schema and `types.ts` describe one shape. */
export function toFloorPlan(plan: ParsedPlan): FloorPlan {
  const { $schema: _schema, ...rest } = plan;
  return rest;
}
