import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_TOOL_IMAGES } from "./bundled-tool-images";
import { toolImageSrc } from "./catalog";

describe("BUNDLED_TOOL_IMAGES", () => {
  it("lists exactly the photos in public/tool-images", () => {
    const onDisk = readdirSync(join(process.cwd(), "public/tool-images"))
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.slice(0, -4))
      .sort();
    expect([...BUNDLED_TOOL_IMAGES].sort()).toEqual(onDisk);
  });
});

describe("toolImageSrc's bundled fallback (tool display names spec §5.8)", () => {
  it("finds the photo under the official name once the backfill moved the long name there", () => {
    const src = toolImageSrc({ name: "Festool Dust Extractor", officialName: "Festool 575267 Dust Extractor CT Midi Hepa" }, []);
    expect(src).toBe(`/tool-images/${encodeURIComponent("Festool 575267 Dust Extractor CT Midi Hepa")}.png`);
  });

  it("keeps the display name's photo when research later records a different official name", () => {
    expect(toolImageSrc({ name: "Form 4", officialName: "Formlabs Form 4 Resin 3D Printer" }, [])).toBe("/tool-images/Form%204.png");
  });

  it("writes a slash as an underscore, as the files are named", () => {
    const src = toolImageSrc({ name: "DEWALT Charger", officialName: "DEWALT DCB107 12V/20V MAX Lithium Ion Charger" }, []);
    expect(src).toBe(`/tool-images/${encodeURIComponent("DEWALT DCB107 12V_20V MAX Lithium Ion Charger")}.png`);
  });

  it("finds the photo by slug when both names changed since the import", () => {
    const src = toolImageSrc({ name: "RYOBI Impact Driver", officialName: "RYOBI 18V ONE+ 1/4\" Impact Driver (PCL235B)", slug: "ryobi-pcl235-one-18v-drill-driver" }, []);
    expect(src).toBe(`/tool-images/${encodeURIComponent("RYOBI PCL235 ONE+ 18V Drill_ Driver")}.png`);
  });

  it("falls back to the display name when neither has a photo", () => {
    expect(toolImageSrc({ name: "New Thing", officialName: null }, [])).toBe("/tool-images/New%20Thing.png");
  });
});
