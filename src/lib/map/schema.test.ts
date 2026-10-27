// @vitest-environment node
import { readFileSync } from "node:fs";
import planFile from "../../../lab/floor-plan.json";
import { floorPlanSchemaText, SCHEMA_PATH } from "../../../scripts/lab-schema";
import { floorPlanIssues, floorPlanWarnings, polygonsOverlap } from "./schema";
import type { MapPoint } from "./types";

/** A small valid plan: two zones side by side sharing a wall, a station in each. */
function fixture() {
  return {
    id: "fixture",
    version: "1",
    title: "Fixture floor",
    source: "Drawn for the tests",
    placeholder: true,
    viewBox: { x: 0, y: 0, w: 200, h: 100 },
    outline: [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ],
    walls: [
      [
        [100, 0],
        [100, 100],
      ],
    ],
    zones: [
      {
        id: "Z1",
        number: "1",
        room: "Shop",
        zone: "Wood",
        polygon: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        labelAt: [50, 50],
      },
      {
        id: "Z2",
        number: "2",
        room: "Shop",
        zone: "Metal",
        polygon: [
          [100, 0],
          [200, 0],
          [200, 100],
          [100, 100],
        ],
        labelAt: [150, 50],
        matches: ["Metal Shop"],
      },
    ],
    stations: [
      { id: "1A", label: "Saw", zoneId: "Z1", marks: [[20, 20]] },
      { id: "2A", label: "Welder", zoneId: "Z2", marks: [[180, 80]] },
    ],
  };
}

describe("the floor plan schema (lab config spec §4, §5.2, §12.6)", () => {
  it("accepts the shipped plan", () => {
    expect(floorPlanIssues(planFile)).toEqual([]);
  });

  it("warns, without failing, about the shipped plan's one label printed outside its zone", () => {
    expect(floorPlanWarnings(planFile)).toEqual(["stations.7.marks.0: station 1H's mark lies outside zone Z1"]);
  });

  it("keeps lab/floor-plan.schema.json current (npm run lab:schema)", () => {
    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(floorPlanSchemaText());
  });

  it("accepts the fixture: zones that share a wall do not overlap", () => {
    expect(floorPlanIssues(fixture())).toEqual([]);
  });

  it.each<[string, (plan: ReturnType<typeof fixture>) => void, string]>([
    ["a missing title", (p) => ((p as { title?: string }).title = undefined), "title:"],
    ["a two-point polygon", (p) => (p.zones[0].polygon = p.zones[0].polygon.slice(0, 2)), "zones.0.polygon: needs at least three points"],
    ["an unknown key", (p) => Object.assign(p, { colour: "red" }), "(plan): Unrecognized key"],
    ["a duplicate zone id", (p) => (p.zones[1].id = "z1"), "zones: the id Z1 is used twice"],
    ["a duplicate station id", (p) => (p.stations[1].id = "1a"), "stations: the id 1A is used twice"],
    ["a station in no zone", (p) => (p.stations[0].zoneId = "Z9"), "stations.0.zoneId: no zone has the id Z9"],
    ["a zone label outside its zone", (p) => (p.zones[0].labelAt = [150, 50]), "zones.0.labelAt: lies outside zone Z1"],
    ["a point outside the viewBox", (p) => (p.outline[1] = [250, 0]), "outline.1: [250, 0] lies outside the viewBox"],
    ["a mark outside the viewBox", (p) => (p.stations[0].marks = [[-5, 20]]), "stations.0.marks.0: [-5, 20] lies outside the viewBox"],
    ["two zones with one room and zone", (p) => (p.zones[1].zone = "wood"), 'zones: two zones have the room and zone "shop / wood"'],
    ["a match another zone claims", (p) => (p.zones[0] = { ...p.zones[0], matches: ["metal shop"] } as never), 'zones.1.matches: "Metal Shop" is already Z1\'s'],
    [
      "overlapping zones",
      (p) =>
        (p.zones[1].polygon = [
          [80, 0],
          [200, 0],
          [200, 100],
          [80, 100],
        ]),
      "zones: Z1 and Z2 overlap",
    ],
  ])("rejects %s", (_name, mutate, message) => {
    const plan = fixture();
    mutate(plan);
    expect(floorPlanIssues(plan).some((issue) => issue.startsWith(message))).toBe(true);
  });

  it("warns about a station mark outside its own zone", () => {
    const plan = fixture();
    plan.stations[0].marks = [[150, 50]];
    expect(floorPlanIssues(plan)).toEqual([]);
    expect(floorPlanWarnings(plan)).toEqual(["stations.0.marks.0: station 1A's mark lies outside zone Z1"]);
  });
});

describe("polygonsOverlap", () => {
  const square = (x: number, y: number, size = 10): MapPoint[] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  it("is false for zones that only touch at an edge or a corner", () => {
    expect(polygonsOverlap(square(0, 0), square(10, 0))).toBe(false);
    expect(polygonsOverlap(square(0, 0), square(10, 10))).toBe(false);
  });
  it("is false for an L-shaped zone around a square it only touches", () => {
    // The L's vertex average, (1.67, 1.67), lies in the square, not in the L.
    const ell: MapPoint[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    expect(polygonsOverlap(ell, square(1, 1, 3))).toBe(false);
  });
  it("is true for crossing, nested and identical zones", () => {
    expect(polygonsOverlap(square(0, 0), square(5, 5))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 20), square(5, 5, 5))).toBe(true);
    expect(polygonsOverlap(square(0, 0), square(0, 0))).toBe(true);
  });
});
