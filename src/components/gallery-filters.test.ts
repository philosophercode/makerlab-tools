import { mockCatalog } from "../../test/fixtures/catalog";
import { toGalleryTool } from "./catalog-types";
import {
  DEFAULT_GALLERY_GROUP,
  DEFAULT_GALLERY_STATE,
  availableUnits,
  compareCategoryNames,
  groupTools,
  resolvedGroup,
  parseGalleryState,
  sortTools,
  toGallerySearchParams,
} from "./gallery-filters";

/** The gallery's URL vocabulary, sort and grouping (UI system phase 5a). */

const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name);

describe("parseGalleryState / toGallerySearchParams", () => {
  it("round-trips every choice and leaves defaults out of the URL", () => {
    const state = {
      query: "laser ",
      status: "Available" as const,
      category: "Laser",
      material: "Acrylic",
      location: "Laser Room",
      kind: "accessory" as const,
      show: "all" as const,
      view: "table" as const,
      sort: "recent" as const,
      group: "location" as const,
    };
    const params = toGallerySearchParams(state);
    expect(parseGalleryState(params)).toEqual(state);
    expect(toGallerySearchParams(DEFAULT_GALLERY_STATE).toString()).toBe("");
  });

  it("drops values the gallery does not offer and takes a repeated parameter's first value", () => {
    expect(parseGalleryState({ sort: "price", group: "colour", view: "list" })).toMatchObject({
      sort: null,
      group: null,
      view: "grid",
    });
    expect(parseGalleryState({ sort: ["name-desc", "recent"] }).sort).toBe("name-desc");
    expect(parseGalleryState({ status: "Broken" }).status).toBeNull();
    expect(parseGalleryState({ status: "In Use" }).status).toBe("In Use");
    expect(parseGalleryState({ kind: "gadget" }).kind).toBeNull();
    expect(parseGalleryState({ kind: "consumable" }).kind).toBe("consumable");
    expect(parseGalleryState({ show: "everything" }).show).toBe("categories");
  });

  it("browses the categories by default, all tools with ?show=all, written first", () => {
    expect(parseGalleryState({}).show).toBe("categories");
    expect(parseGalleryState({ show: "all" }).show).toBe("all");
    expect(toGallerySearchParams({ ...DEFAULT_GALLERY_STATE, show: "all", material: "PLA" }).toString()).toBe("show=all&material=PLA");
    expect(toGallerySearchParams({ ...DEFAULT_GALLERY_STATE, show: "categories" }).toString()).toBe("");
  });
});

describe("sortTools", () => {
  it("keeps the arriving order by default and sorts by name both ways", () => {
    const reversed = mockCatalog.slice().reverse();
    expect(names(sortTools(reversed, null))).toEqual(names(reversed));
    expect(names(sortTools(reversed, "name"))).toEqual(["Bandsaw", "Form 4", "Prusa MK4", "Trotec Speedy 400"]);
    expect(names(sortTools(reversed, "name-desc"))).toEqual(["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]);
  });

  it("sorts newest first, with undated tools last", () => {
    const dated = mockCatalog.map((tool, i) => ({ ...tool, addedAt: i === 0 ? null : `2026-0${i}-01T00:00:00Z` }));
    const sorted = sortTools(dated, "recent");
    expect(sorted[sorted.length - 1].addedAt).toBeNull();
    expect(sorted[0].addedAt).toBe(`2026-0${mockCatalog.length - 1}-01T00:00:00Z`);
  });

  it("sorts by category group then category, and by location then zone", () => {
    expect(names(sortTools(mockCatalog, "category"))).toEqual(["Prusa MK4", "Form 4", "Trotec Speedy 400", "Bandsaw"]);
    expect(sortTools(mockCatalog, "location").map((tool) => tool.location)).toEqual([
      "Laser Room",
      "MakerLab",
      "MakerLab",
      "Wood Shop",
    ]);
  });
});

describe("groupTools", () => {
  it("is one unlabelled section when not grouping", () => {
    expect(groupTools(mockCatalog, null)).toEqual([{ key: "all", label: "", tools: mockCatalog }]);
  });

  it("orders sections alphabetically with 'not recorded' last, keeping the tools' order inside each", () => {
    const tools = [
      ...mockCatalog,
      { ...mockCatalog[0], id: "x", name: "Mystery", category: "Uncategorized", categorySub: "Other" },
    ];
    const sections = groupTools(sortTools(tools, "name-desc"), "categoryGroup");
    expect(sections.map((section) => section.label)).toEqual(["3D Printing", "Laser", "Woodworking", "Uncategorized"]);
    expect(names(sections[0].tools)).toEqual(["Prusa MK4", "Form 4"]);
  });

  it("labels a category with its group", () => {
    expect(groupTools(mockCatalog, "category").map((section) => section.label)).toEqual([
      "3D Printing › FDM",
      "3D Printing › Resin",
      "Laser › CO2",
      "Woodworking › Cutting",
    ]);
  });

  it("follows the lab's category order when given one, for both category groupings but not rooms", () => {
    const categoryOrder = ["Woodworking", "Laser", "3D Printing"];
    expect(groupTools(mockCatalog, "categoryGroup", { categoryOrder }).map((section) => section.label)).toEqual([
      "Woodworking",
      "Laser",
      "3D Printing",
    ]);
    expect(groupTools(mockCatalog, "category", { categoryOrder }).map((section) => section.label)).toEqual([
      "Woodworking › Cutting",
      "Laser › CO2",
      "3D Printing › FDM",
      "3D Printing › Resin",
    ]);
    expect(groupTools(mockCatalog, "location", { categoryOrder }).map((section) => section.label)).toEqual([
      "Laser Room",
      "MakerLab",
      "Wood Shop",
    ]);
  });
});

describe("the default grouping (amendment \"One page: the list at rest\")", () => {
  it("rests on category group: null in the state, nothing in the URL; none is one list", () => {
    expect(DEFAULT_GALLERY_GROUP).toBe("categoryGroup");
    expect(resolvedGroup(null)).toBe("categoryGroup");
    expect(resolvedGroup("none")).toBeNull();
    expect(resolvedGroup("location")).toBe("location");
    expect(parseGalleryState({ group: "none" }).group).toBe("none");
    expect(toGallerySearchParams({ ...DEFAULT_GALLERY_STATE, group: "none" }).toString()).toBe("group=none");
  });

  it("reads an old link's explicit ?group=categoryGroup as the default, and never writes it", () => {
    expect(parseGalleryState({ group: "categoryGroup" }).group).toBeNull();
    expect(toGallerySearchParams(parseGalleryState({ group: "categoryGroup" })).toString()).toBe("");
  });
});

describe("compareCategoryNames", () => {
  it("orders by the lab's order, then any other name alphabetically, 'not recorded' last", () => {
    const names = ["Zebra", "Uncategorized", "Laser", "Alpha", "3D Printing"];
    expect(names.sort(compareCategoryNames(["Laser", "3D Printing"]))).toEqual(["Laser", "3D Printing", "Alpha", "Zebra", "Uncategorized"]);
  });
});

describe("toGalleryTool (performance plan, quick win 11)", () => {
  it("keeps what the gallery reads and drops the rest", () => {
    const slim = toGalleryTool(mockCatalog[0]);
    expect(slim).not.toHaveProperty("shortDescription");
    expect(slim).not.toHaveProperty("links");
    expect(slim).not.toHaveProperty("notes");
    expect(slim.units.every((unit) => Object.keys(unit).join() === "status")).toBe(true);
    expect(availableUnits(slim)).toBe(availableUnits(mockCatalog[0]));
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(mockCatalog[0]).length);
  });
});
