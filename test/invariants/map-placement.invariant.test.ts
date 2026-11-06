// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
import planFile from "../../lab/floor-plan.json";
import { fc, RUNS } from "./fc";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { locations, tools } from "@/lib/db/schema/index";
import { indexPlan, placeTool, placeTools, type PlaceableTool } from "@/lib/map/placement";
import { insidePolygon } from "@/lib/map/schema";
import type { FloorPlan } from "@/lib/map/types";

/**
 * INVARIANT 6 — every tool has a place, and every place is on the map.
 *
 * Placement (`lib/map/placement.ts`) is what the tool page, `/map` and the
 * assistant all use, so these must hold for any inventory naming:
 *
 * - Every zone on the shipped plan is reachable: a tool naming its room and
 *   zone (any case, any spacing) lands in it, and its label sits on the map.
 * - Every station is reachable by its tag and lands in the station's own zone.
 * - Placement never invents a zone: a result is always one of the plan's.
 * - Placement never drops a tool: each one is in exactly one zone or in
 *   `unplaced`, which the page lists under the map.
 * - In the database, every tool row that names a location names a real one
 *   with both a room and a zone (the demo seed checked; `npm run lab:check`
 *   runs the same report against a real inventory).
 *
 * Plan geometry (overlaps, marks outside zones) is `map/schema.test.ts`'s.
 */

const plan = planFile as unknown as FloorPlan;
const index = indexPlan(plan);

/** Case and whitespace noise an inventory might carry. */
const noisy = (value: string) =>
  fc
    .tuple(
      fc.constantFrom("", " ", "  ", "\t"),
      fc.constantFrom("", " "),
      fc.constantFrom<"upper" | "lower" | "same">("upper", "lower", "same"),
      fc.array(fc.constantFrom(" ", "  ", "\t"), { minLength: 8, maxLength: 8 })
    )
    .map(([pad, end, kase, gaps]) => {
      let i = 0;
      const spaced = value.replace(/ /g, () => gaps[i++ % gaps.length]);
      const cased = kase === "upper" ? spaced.toUpperCase() : kase === "lower" ? spaced.toLowerCase() : spaced;
      return `${pad}${cased}${end}`;
    });

const anyTool: fc.Arbitrary<PlaceableTool> = fc.record({
  mapId: fc.option(fc.oneof(fc.string({ maxLength: 6 }), fc.constantFrom(...plan.stations.map((s) => s.id))), {
    nil: null,
  }),
  location: fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom(...plan.zones.map((z) => z.room))),
  zone: fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom(...plan.zones.map((z) => z.zone))),
});

afterAll(() => resetDbForTests());

describe("invariant: every zone and station is reachable on the map", () => {
  it("has zones and stations to check", () => {
    expect(plan.zones.length).toBeGreaterThan(0);
    expect(plan.stations.length).toBeGreaterThan(0);
  });

  it("a tool naming a zone's room and zone lands in that zone, whatever its spacing or case", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...plan.zones).chain((zone) => fc.tuple(fc.constant(zone), noisy(zone.room), noisy(zone.zone))),
        ([zone, room, name]) => {
          const place = placeTool(index, { mapId: null, location: room, zone: name });
          expect(place?.zone.id).toBe(zone.id);
        }
      ),
      { numRuns: RUNS }
    );
  });

  it("every zone's label is drawn inside the map", () => {
    const { x, y, w, h } = plan.viewBox;
    for (const zone of plan.zones) {
      const [lx, ly] = zone.labelAt;
      expect(lx >= x && lx <= x + w && ly >= y && ly <= y + h, zone.id).toBe(true);
      expect(zone.polygon.length, zone.id).toBeGreaterThanOrEqual(3);
      expect(insidePolygon(zone.labelAt, zone.polygon), `${zone.id}'s label is outside its zone`).toBe(true);
    }
  });

  it("a station tag places the tool at that station, inside the station's zone", () => {
    fc.assert(
      fc.property(fc.constantFrom(...plan.stations), anyTool, fc.boolean(), (station, tool, lower) => {
        const tag = lower ? station.id.toLowerCase() : ` ${station.id} `;
        const place = placeTool(index, { ...tool, mapId: tag });
        expect(place?.station?.id).toBe(station.id);
        expect(place?.zone.id).toBe(station.zoneId);
      }),
      { numRuns: RUNS }
    );
  });
});

describe("invariant: placement never invents a zone and never drops a tool", () => {
  it("any result is one of the plan's own zones", () => {
    const zones = new Set(plan.zones);
    fc.assert(
      fc.property(anyTool, (tool) => {
        const place = placeTool(index, tool);
        if (place) expect(zones.has(place.zone)).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });

  it("each tool is in exactly one zone or in unplaced", () => {
    fc.assert(
      fc.property(fc.array(anyTool, { maxLength: 40 }), (list) => {
        const placement = placeTools(index, list);
        const seen = [...placement.byZone.values()].flat().concat(placement.unplaced);
        expect(seen.length).toBe(list.length);
        expect(new Set(seen).size).toBe(new Set(list).size);
        expect([...placement.byZone.keys()].sort()).toEqual(plan.zones.map((z) => z.id).sort());
      }),
      { numRuns: RUNS }
    );
  });
});

describe("invariant: every tool's location is a real place", () => {
  it("no tool names a missing location, and every location has a room and a zone", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const db = await getDb();
    const rows = await db
      .select({ tool: tools.slug, locationId: tools.locationId, room: locations.room, zone: locations.zone })
      .from(tools)
      .leftJoin(locations, eq(tools.locationId, locations.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.locationId === null) continue; // "not on the map", said on the page
      expect(row.room?.trim(), `${row.tool}: location has no room`).toBeTruthy();
      expect(row.zone?.trim(), `${row.tool}: location has no zone`).toBeTruthy();
    }
    const orphans = await db.select({ slug: tools.slug }).from(tools).where(isNull(tools.locationId));
    expect(orphans, "seeded tools without a location").toEqual([]);
  }, 30_000);
});
