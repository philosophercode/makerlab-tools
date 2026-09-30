import { describe, expect, it } from "vitest";
import { STUDIO_101 } from "./studio-101";
import { planWork } from "./work-plan";

const tool = (name: string, location: string, zone: string, mapId: string | null = null) => ({ name, location, zone, mapId });

describe("planWork (project map grouping)", () => {
  it("groups tools by zone in the plan's zone order, keeping stations and unplaced tools", () => {
    const laser = tool("Trotec", "Studio 101C", "Laser Machine Room", "4A");
    const printer = tool("Form 4", "Studio 101", "3D Printing Hub");
    const bambu = tool("Bambu", "Studio 101", "3D Printing Hub");
    const lost = tool("Mystery", "Unknown", "Unknown");

    const work = planWork(STUDIO_101, [laser, printer, lost, bambu]);

    expect(work.zones.map((z) => z.zone.id)).toEqual(["Z2", "Z4"]);
    expect(work.zones[0].tools.map((e) => e.tool.name)).toEqual(["Form 4", "Bambu"]);
    expect(work.zones[0].href).toBe("/map?highlight=Z2");
    expect(work.zones[1].tools[0].station?.id).toBe("4A");
    expect(work.unplaced).toEqual([lost]);
    expect([...work.zoneIds].sort()).toEqual(["Z2", "Z4"]);
    expect([...work.stationIds]).toEqual(["4A"]);
  });

  it("is empty for no tools", () => {
    const work = planWork(STUDIO_101, []);
    expect(work.zones).toEqual([]);
    expect(work.unplaced).toEqual([]);
    expect(work.zoneIds.size).toBe(0);
  });
});
