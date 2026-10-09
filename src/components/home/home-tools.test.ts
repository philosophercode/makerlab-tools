import { mockCatalog } from "../../../test/fixtures/catalog";
import { categoryTiles, galleryToolCount, toHomeTool, type HomeTool } from "./home-tools";

/**
 * The home page's category tiles (student home spec 2026-10-07 §4): one per
 * category the public gallery shows, in the lab's order, each with a count,
 * its kinds, units out of service and a cover photo.
 */

const tools = mockCatalog.map(toHomeTool);

function tool(overrides: Partial<HomeTool> & Pick<HomeTool, "id" | "name" | "category">): HomeTool {
  return {
    slug: overrides.id,
    officialName: null,
    categorySub: overrides.category,
    status: "Available",
    imageSrc: "",
    thumbnails: null,
    galleryHidden: false,
    itemKind: "equipment",
    units: [],
    ...overrides,
  };
}

describe("toHomeTool", () => {
  it("keeps only what the search and the tiles read", () => {
    const home = toHomeTool(mockCatalog[0]);
    expect(Object.keys(home).sort()).toEqual(
      ["category", "categorySub", "galleryHidden", "id", "imageSrc", "itemKind", "name", "officialName", "slug", "status", "thumbnails", "units"].sort()
    );
    expect(home.units.every((unit) => Object.keys(unit).join() === "status")).toBe(true);
  });
});

describe("categoryTiles", () => {
  it("is one tile per category, in the lab's order, unknown names after it alphabetically", () => {
    expect(categoryTiles(tools, ["Laser", "3D Printing"]).map((tile) => tile.name)).toEqual(["Laser", "3D Printing", "Woodworking"]);
    expect(categoryTiles(tools, []).map((tile) => tile.name)).toEqual(["3D Printing", "Laser", "Woodworking"]);
  });

  it("counts tools, names the kinds and counts units out of service", () => {
    const tiles = categoryTiles(tools, []);
    const printing = tiles.find((tile) => tile.name === "3D Printing")!;
    expect(printing.count).toBe(2);
    expect(printing.subs.sort()).toEqual(["FDM", "Resin"]);
    expect(printing.unitsDown).toBe(0);
    const laser = tiles.find((tile) => tile.name === "Laser")!;
    expect(laser.unitsDown).toBe(1);
  });

  it("leaves out a category the gallery hides, and a sub-category named like its parent", () => {
    const list = [
      tool({ id: "a", name: "Bench", category: "Shop Infrastructure & Supplies", galleryHidden: true }),
      tool({ id: "b", name: "Laser", category: "Laser", categorySub: "Laser" }),
    ];
    const tiles = categoryTiles(list, []);
    expect(tiles.map((tile) => tile.name)).toEqual(["Laser"]);
    expect(tiles[0].subs).toEqual([]);
    expect(galleryToolCount(list)).toBe(1);
  });

  it("shows three kinds at most and says there are more", () => {
    const list = ["A", "B", "C", "D"].map((sub, index) => tool({ id: `t${index}`, name: `T${index}`, category: "Power Tools", categorySub: sub }));
    const [tile] = categoryTiles(list, []);
    expect(tile.subs).toEqual(["A", "B", "C"]);
    expect(tile.moreSubs).toBe(true);
  });

  it("covers a category with the photo of its equipment with the most units, never an accessory", () => {
    const list = [
      tool({ id: "blade", name: "Blade", category: "Power Tools", imageSrc: "/blade.png", itemKind: "accessory", units: [{ status: "Available" }, { status: "Available" }, { status: "Available" }] }),
      tool({ id: "drill", name: "Drill", category: "Power Tools", imageSrc: "/drill.png", units: [{ status: "Available" }] }),
      tool({ id: "saw", name: "Saw", category: "Power Tools", imageSrc: "/saw.png", units: [{ status: "Available" }, { status: "Offline" }] }),
      tool({ id: "sander", name: "Sander", category: "Power Tools", units: [{ status: "Available" }, { status: "Available" }, { status: "Available" }] }),
    ];
    const [tile] = categoryTiles(list, []);
    expect(tile.cover?.name).toBe("Saw");
    expect(tile.unitsDown).toBe(1);
    expect(categoryTiles([tool({ id: "x", name: "X", category: "Empty" })], [])[0].cover).toBeNull();
  });
});
