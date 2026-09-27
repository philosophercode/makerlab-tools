import type { CategoryOption } from "../data/taxonomy";
import { matchCategory } from "./taxonomy-match";

/**
 * Resolving the model's category to an existing one (spec §3.7). A wrong
 * preselection is worse than none, so every ambiguous case answers none.
 */

const CATEGORIES: CategoryOption[] = [
  { id: "cat-resin", name: "Resin", group: "3D Printing" },
  { id: "cat-fdm", name: "FDM", group: "3D Printing" },
  { id: "cat-co2", name: "CO2", group: "Laser" },
  { id: "cat-acc-laser", name: "Accessories", group: "Laser" },
  { id: "cat-acc-print", name: "Accessories", group: "3D Printing" },
  { id: "cat-hand", name: "Hand Tools", group: null },
];

describe("matchCategory", () => {
  it("matches name and group, ignoring case and spacing, and answers with the stored spelling", () => {
    expect(matchCategory({ name: "  fdm ", group: "3d   printing" }, CATEGORIES)).toEqual({
      name: "FDM",
      group: "3D Printing",
      existingId: "cat-fdm",
    });
  });

  it("matches a unique name when the model gave no group", () => {
    expect(matchCategory({ name: "resin", group: null }, CATEGORIES)).toEqual({
      name: "Resin",
      group: "3D Printing",
      existingId: "cat-resin",
    });
  });

  it("matches a unique ungrouped category even when the model added a group", () => {
    expect(matchCategory({ name: "Hand tools", group: "Workshop" }, CATEGORIES).existingId).toBe("cat-hand");
  });

  it("uses the group to choose between categories that share a name", () => {
    expect(matchCategory({ name: "Accessories", group: "laser" }, CATEGORIES).existingId).toBe("cat-acc-laser");
  });

  it("does not guess between categories that share a name", () => {
    expect(matchCategory({ name: "Accessories", group: null }, CATEGORIES)).toEqual({
      name: "Accessories",
      group: null,
      existingId: null,
    });
  });

  it("does not read a contradicting group as a match", () => {
    expect(matchCategory({ name: "CO2", group: "3D Printing" }, CATEGORIES)).toEqual({
      name: "CO2",
      group: "3D Printing",
      existingId: null,
    });
  });

  it("keeps the model's words for a category the lab does not have", () => {
    expect(matchCategory({ name: "Vinyl Cutting", group: "Cutting" }, CATEGORIES)).toEqual({
      name: "Vinyl Cutting",
      group: "Cutting",
      existingId: null,
    });
  });

  it("answers an empty proposal with an empty category", () => {
    expect(matchCategory(null, CATEGORIES)).toEqual({ name: "", group: null, existingId: null });
    expect(matchCategory({ name: "  ", group: " " }, CATEGORIES)).toEqual({ name: "", group: null, existingId: null });
  });
});
