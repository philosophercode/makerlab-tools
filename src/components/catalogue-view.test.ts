import { mockCatalog } from "../../test/fixtures/catalog";
import { toGalleryTool, type GalleryTool } from "./catalog-types";
import { DEFAULT_GALLERY_STATE, type GalleryState } from "./gallery-filters";
import { catalogueView, categoryChips, narrowed } from "./catalogue-view";

/**
 * What the home page's list shows (student home spec 2026-10-07, amendment
 * "One page: the list at rest"): the groups at rest, the ranked results in
 * their place while searching, and the category chips.
 */

const tools = mockCatalog.map(toGalleryTool);
const state = (patch: Partial<GalleryState> = {}): GalleryState => ({ ...DEFAULT_GALLERY_STATE, ...patch });
const names = (list: readonly { name: string }[]) => list.map((tool) => tool.name);

describe("catalogueView at rest", () => {
  it("groups by category group in the lab's order, the shown list following the sections", () => {
    const view = catalogueView(tools, state(), ["Woodworking", "3D Printing", "Laser"]);
    expect(view.searching).toBe(false);
    expect(view.sections.map((section) => section.label)).toEqual(["Woodworking", "3D Printing", "Laser"]);
    expect(names(view.shown)).toEqual(["Bandsaw", "Prusa MK4", "Form 4", "Trotec Speedy 400"]);
    expect(view.visible).toHaveLength(4);
  });

  it("is one unlabelled list when grouping is none", () => {
    const view = catalogueView(tools, state({ group: "none" }), []);
    expect(view.sections).toEqual([{ key: "all", label: "", tools: view.shown }]);
  });

  it("leaves a hidden-by-default category out unless it is the one chosen", () => {
    const hidden = tools.map((tool) => (tool.slug === "bandsaw" ? { ...tool, category: "Supplies", galleryHidden: true } : tool));
    expect(names(catalogueView(hidden, state(), []).shown)).not.toContain("Bandsaw");
    expect(names(catalogueView(hidden, state({ category: "Supplies" }), []).shown)).toEqual(["Bandsaw"]);
  });
});

describe("catalogueView searching", () => {
  it("is one section of the matches, best first", () => {
    const view = catalogueView(tools, state({ query: "form" }), []);
    expect(view.searching).toBe(true);
    expect(view.sections).toHaveLength(1);
    expect(names(view.shown)).toEqual(["Form 4"]);
  });

  it("ranks a name match above a details match", () => {
    // "cutting": the Bandsaw's subcategory and the Trotec's tag; "Cutting mat" says it in its name.
    const withMat = [...tools, { ...tools[0], id: "mat", slug: "cutting-mat", name: "Cutting mat", category: "Woodworking", categorySub: "Benches", tags: [] }];
    expect(names(catalogueView(withMat, state({ query: "cutting" }), []).shown)).toEqual(["Cutting mat", "Bandsaw", "Trotec Speedy 400"]);
  });

  it("reaches a hidden-by-default category, after the list's own tools", () => {
    const hidden: GalleryTool[] = tools.map((tool) =>
      tool.slug === "bandsaw" ? { ...tool, name: "Prusa spare nozzle", category: "Supplies", galleryHidden: true } : tool
    );
    expect(names(catalogueView(hidden, state({ query: "prusa" }), []).shown)).toEqual(["Prusa MK4", "Prusa spare nozzle"]);
  });

  it("puts equipment before an accessory on an equal match", () => {
    const kit = tools.map((tool) => (tool.slug === "form-4" ? { ...tool, name: "Prusa enclosure", itemKind: "accessory" as const } : tool));
    // Both names start with "prusa": the machine first, though the accessory came first in the catalogue's order.
    const reordered = [kit[3], ...kit.slice(0, 3)];
    expect(names(catalogueView(reordered, state({ query: "prusa" }), []).shown)).toEqual(["Prusa MK4", "Prusa enclosure"]);
  });

  it("keeps the facets: a search inside a category stays inside it", () => {
    expect(names(catalogueView(tools, state({ query: "o", category: "Laser" }), []).shown)).toEqual(["Trotec Speedy 400"]);
  });

  it("matches nothing for a question no tool's words contain", () => {
    expect(catalogueView(tools, state({ query: "how do I load filament" }), []).shown).toEqual([]);
  });
});

describe("categoryChips", () => {
  it("lists every category in the lab's order, hidden-by-default ones last, counted under the other facets", () => {
    const hidden = tools.map((tool) => (tool.slug === "bandsaw" ? { ...tool, category: "Supplies", galleryHidden: true } : tool));
    expect(categoryChips(hidden, state(), ["Supplies", "Laser", "3D Printing"])).toEqual([
      { name: "Laser", count: 1 },
      { name: "3D Printing", count: 2 },
      { name: "Supplies", count: 1 },
    ]);
    expect(categoryChips(hidden, state({ status: "Available" }), ["Laser"]).map((chip) => chip.count)).toEqual([0, 1, 1]);
  });

  it("does not let the chosen category or the search change the counts", () => {
    const chips = categoryChips(tools, state({ category: "Laser", query: "zzz" }), []);
    expect(chips).toEqual([
      { name: "3D Printing", count: 2 },
      { name: "Laser", count: 1 },
      { name: "Woodworking", count: 1 },
    ]);
  });
});

describe("narrowed", () => {
  it("applies every facet but the one excepted", () => {
    const s = state({ status: "Available", category: "Woodworking" });
    expect(names(narrowed(tools, s))).toEqual(["Bandsaw"]);
    expect(names(narrowed(tools, s, "category"))).toEqual(["Bandsaw", "Form 4"]);
  });
});
