import { describe, expect, it } from "vitest";
import { densityStep, indexPlan, mapHref, placeTool, placeTools, resolveHighlight } from "./placement";
import { mapFactsFor } from "./locate";
import { STUDIO_101 } from "./studio-101";

const index = indexPlan(STUDIO_101);

describe("placeTool", () => {
  it("places a tool by its map tag on the station, with the station's zone", () => {
    const place = placeTool(index, { mapId: "4a", location: "Studio 101C", zone: "Trotec Laser Machine" });
    expect(place?.station?.id).toBe("4A");
    expect(place?.zone.zone).toBe("Laser Machine Room");
  });

  it("falls back to room + zone, ignoring case and spacing", () => {
    const place = placeTool(index, { mapId: null, location: "studio  101a", zone: "MACHINING SHOP" });
    expect(place?.zone.id).toBe("Z3");
    expect(place?.station).toBeNull();
  });

  it("falls back to room + zone when the tag is not on this plan", () => {
    expect(placeTool(index, { mapId: "ML-RESIN-01", location: "Studio 101", zone: "3D Printing Hub" })?.zone.id).toBe("Z2");
  });

  it("never guesses: Unknown / Unknown is not on the map", () => {
    expect(placeTool(index, { mapId: null, location: "Unknown", zone: "Unknown" })).toBeNull();
  });
});

describe("placeTools", () => {
  it("gives every zone an entry and keeps the unplaced", () => {
    const placement = placeTools(index, [
      { mapId: "2B", location: "", zone: "" },
      { mapId: null, location: "Studio 101", zone: "3D Printing Hub" },
      { mapId: null, location: "Unknown", zone: "Unknown" },
    ]);
    expect([...placement.byZone.keys()]).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
    expect(placement.byZone.get("Z2")).toHaveLength(2);
    expect(placement.byStation.get("2B")).toHaveLength(1);
    expect(placement.unplaced).toHaveLength(1);
  });
});

describe("resolveHighlight", () => {
  it("resolves a station tag and a zone id, and nothing else", () => {
    expect(resolveHighlight(index, "1c")?.zone.id).toBe("Z1");
    expect(resolveHighlight(index, "Z5")?.station).toBeNull();
    expect(resolveHighlight(index, "nope")).toBeNull();
    expect(resolveHighlight(index, null)).toBeNull();
  });
});

describe("densityStep", () => {
  it("is 0 for empty and quartiles of the busiest zone otherwise", () => {
    expect(densityStep(0, 57)).toBe(0);
    expect(densityStep(2, 57)).toBe(1);
    expect(densityStep(20, 57)).toBe(2);
    expect(densityStep(40, 57)).toBe(3);
    expect(densityStep(57, 57)).toBe(4);
  });
});

describe("the traced plan", () => {
  it("has unique station tags, each in a zone that exists", () => {
    const ids = STUDIO_101.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const zones = new Set(STUDIO_101.zones.map((z) => z.id));
    for (const s of STUDIO_101.stations) expect(zones.has(s.zoneId)).toBe(true);
  });

  it("names its zones as the live locations table does", () => {
    expect(STUDIO_101.zones.map((z) => `${z.room} / ${z.zone}`)).toEqual([
      "Studio 101 / Common Purpose Space",
      "Studio 101 / 3D Printing Hub",
      "Studio 101A / Machining Shop",
      "Studio 101C / Laser Machine Room",
      "Studio 101D / Electronics Lab",
    ]);
  });
});

describe("mapFactsFor (the assistant's view)", () => {
  it("gives words and a /map link, or null", () => {
    expect(mapFactsFor({ mapId: "4B", location: "", zone: "" })).toEqual({
      zone: "Laser Machine Room",
      zone_number: "4",
      room: "Studio 101C",
      station: "4B",
      station_label: "Epilog Laser Machine",
      map_page: mapHref("4B"),
    });
    expect(mapFactsFor({ mapId: null, location: "Unknown", zone: "Unknown" })).toBeNull();
  });
});
