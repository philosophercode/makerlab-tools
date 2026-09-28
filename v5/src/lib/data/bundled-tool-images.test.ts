import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_TOOL_IMAGES } from "./bundled-tool-images";
import { bundledThumbnailsForUrl, toolImage, toolImageSrc, type AttachmentRow } from "./catalog";
import { BUNDLED_TOOL_THUMBNAILS } from "./bundled-tool-thumbnails";

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

  it("answers no image, not a guessed path, when neither name has a photo", () => {
    // `ToolImage` draws the empty plate for "" — a guessed
    // `/tool-images/New%20Thing.png` was a request that could only 404.
    expect(toolImageSrc({ name: "New Thing", officialName: null }, [])).toBe("");
  });
});

describe("toolImage — which thumbnails a tool is shown with", () => {
  const blob = (overrides: Partial<AttachmentRow> = {}): AttachmentRow => ({
    ownerType: "tool",
    ownerId: "t",
    position: 0,
    access: "public",
    publicUrl: "https://abc.public.blob.vercel-storage.com/uploads/tool/IMG_1-x.jpg",
    originalFilename: "IMG_1.jpg",
    ...overrides,
  });
  const own = { base: "https://abc.public.blob.vercel-storage.com/thumbs/uploads/tool/IMG_1-x.0123", widths: [160, 320, 640], width: 4032, height: 3024 };

  it("uses a Blob photo's own thumbnails", () => {
    expect(toolImage({ name: "Saw", officialName: null }, [blob({ thumbnails: own })])).toEqual({
      imageSrc: "https://abc.public.blob.vercel-storage.com/uploads/tool/IMG_1-x.jpg",
      thumbnails: own,
    });
  });

  it("has none for a Blob photo that has not been rendered yet (next/image then resizes the original)", () => {
    expect(toolImage({ name: "Form 4", officialName: null }, [blob()]).thumbnails).toBeNull();
    expect(toolImage({ name: "Saw", officialName: null }, [blob({ thumbnails: { base: "" } as never })]).thumbnails).toBeNull();
  });

  it("uses the bundled set for a photo found by name", () => {
    expect(toolImage({ name: "Form 4", officialName: null }, [])).toEqual({
      imageSrc: "/tool-images/Form%204.png",
      thumbnails: BUNDLED_TOOL_THUMBNAILS["Form 4"],
    });
    const slash = toolImage({ name: "DEWALT Charger", officialName: "DEWALT DCB107 12V/20V MAX Lithium Ion Charger" }, []);
    expect(slash.thumbnails).toBe(BUNDLED_TOOL_THUMBNAILS["DEWALT DCB107 12V_20V MAX Lithium Ion Charger"]);
  });

  it("uses the bundled set when an attachment points at a bundled photo, encoded or not", () => {
    const trotec = BUNDLED_TOOL_THUMBNAILS["Trotec Speedy 400, 80w"];
    expect(toolImage({ name: "Trotec", officialName: null }, [blob({ publicUrl: "/tool-images/Trotec Speedy 400, 80w.png" })]).thumbnails).toBe(trotec);
    expect(bundledThumbnailsForUrl("/tool-images/Trotec%20Speedy%20400%2C%2080w.png")).toBe(trotec);
    expect(bundledThumbnailsForUrl("/tool-images/Nope.png")).toBeNull();
    expect(bundledThumbnailsForUrl("/tool-images/%E0%A4%A.png")).toBeNull();
  });

  it("has neither image nor thumbnails for a tool with no photo", () => {
    expect(toolImage({ name: "New Thing", officialName: null }, [])).toEqual({ imageSrc: "", thumbnails: null });
  });
});
