import { categoryEntries, categoryKeywords, rankByPaletteScore, toolKeywords } from "./palette-search";

/**
 * What the ⌘K palette and the home page's smart search share (student home
 * spec 2026-10-07 §3): one matcher, one keyword list per tool, one category
 * list.
 */

const TOOLS = [
  { slug: "form-4", name: "Form 4", officialName: "Formlabs Form 4", category: "3D Printing", categorySub: "Resin" },
  { slug: "prusa-mk4", name: "Prusa MK4", officialName: null, category: "3D Printing", categorySub: "FDM" },
  { slug: "trotec-speedy-400", name: "Laser cutter", officialName: "Trotec Speedy 400", category: "Laser", categorySub: "Laser" },
  { slug: "bandsaw", name: "Bandsaw", category: "Woodworking", categorySub: "Cutting" },
  { slug: "loose", name: "Loose part", category: null },
];

describe("toolKeywords", () => {
  it("is the display name, the official name and the slug", () => {
    expect(toolKeywords(TOOLS[0])).toEqual(["Form 4", "Formlabs Form 4", "form-4"]);
    expect(toolKeywords(TOOLS[1])).toEqual(["Prusa MK4", "", "prusa-mk4"]);
  });
});

describe("categoryEntries", () => {
  it("counts each top-level category and lists its second-level names, alphabetically", () => {
    expect(categoryEntries(TOOLS)).toEqual([
      { name: "3D Printing", count: 2, subs: ["FDM", "Resin"] },
      { name: "Laser", count: 1, subs: [] },
      { name: "Woodworking", count: 1, subs: ["Cutting"] },
    ]);
  });

  it("finds a category by a second-level name", () => {
    const entries = categoryEntries(TOOLS);
    expect(rankByPaletteScore(entries, "resin", categoryKeywords, 3).map((entry) => entry.name)).toEqual(["3D Printing"]);
  });
});

describe("rankByPaletteScore", () => {
  it("keeps only items with every word, best first, and stops at the limit", () => {
    const found = rankByPaletteScore(TOOLS, "speedy", toolKeywords, 5);
    expect(found.map((tool) => tool.slug)).toEqual(["trotec-speedy-400"]);
    // "form" starts "Form 4" (prefix) and sits inside nothing else.
    expect(rankByPaletteScore(TOOLS, "form", toolKeywords, 5).map((tool) => tool.slug)).toEqual(["form-4"]);
    expect(rankByPaletteScore(TOOLS, "r", toolKeywords, 2)).toHaveLength(2);
  });

  it("ranks a prefix match above a word inside the name, ties in the order given", () => {
    const items = [{ k: ["Cutting mat"] }, { k: ["Laser cutter"] }, { k: ["Cutter knife"] }];
    expect(rankByPaletteScore(items, "cut", (item) => item.k, 5).map((item) => item.k[0])).toEqual([
      "Cutting mat",
      "Cutter knife",
      "Laser cutter",
    ]);
  });

  it("matches nothing for an empty or blank query, and is not fuzzy", () => {
    expect(rankByPaletteScore(TOOLS, "", toolKeywords, 5)).toEqual([]);
    expect(rankByPaletteScore(TOOLS, "   ", toolKeywords, 5)).toEqual([]);
    expect(rankByPaletteScore(TOOLS, "frm", toolKeywords, 5)).toEqual([]);
  });
});
