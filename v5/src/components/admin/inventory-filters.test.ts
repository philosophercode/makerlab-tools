// @vitest-environment node
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";
import {
  NO_FILTERS,
  hasActiveFilters,
  matchesFilters,
  parseInventoryFilters,
  toSearchParams,
  type InventoryFilterState,
} from "./inventory-filters";

/**
 * The filter vocabulary — what a URL may say, and what each value hides.
 *
 * Parsing is where a pasted link becomes a view, so the cases that matter are
 * the ones a link can be wrong in: a value this page does not offer, a
 * parameter repeated, a parameter left blank.
 */

/** Overrides where `attention` may name just the flags the case is about. */
type RowOverrides = Partial<Omit<InventoryRow, "attention" | "needsAttention">> & {
  attention?: Partial<InventoryAttention>;
};

function row(overrides: RowOverrides = {}): InventoryRow {
  const attention = {
    noPhoto: false,
    noManual: false,
    openTickets: false,
    neverReviewed: false,
    ...overrides.attention,
  };
  return {
    id: "t",
    slug: "form-4",
    name: "Form 4",
    photoUrl: null,
    categoryName: "Resin Printing",
    categoryGroup: "3D Printing",
    room: "Bloomberg 061",
    zone: "Resin Bay",
    unitCount: 1,
    worstUnitStatus: "available",
    state: "published",
    openTicketCount: 0,
    lastReviewedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    attention,
    needsAttention: Object.values(attention).some(Boolean),
  };
}

function filters(overrides: Partial<InventoryFilterState> = {}): InventoryFilterState {
  return { ...NO_FILTERS, ...overrides };
}

describe("parseInventoryFilters", () => {
  it("reads every filter the page offers", () => {
    expect(
      parseInventoryFilters({
        q: "form",
        state: "draft",
        category: "Resin Printing",
        location: "Bloomberg 061",
        attention: "no_manual",
      })
    ).toEqual({
      query: "form",
      state: "draft",
      category: "Resin Printing",
      location: "Bloomberg 061",
      attention: "no_manual",
    });
  });

  it("drops a state or a flag this page does not offer, instead of filtering by it", () => {
    expect(parseInventoryFilters({ state: "broken", attention: "on_fire" })).toEqual(NO_FILTERS);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseInventoryFilters({ state: ["archived", "draft"] }).state).toBe("archived");
  });

  it("treats a blank parameter as no filter", () => {
    expect(parseInventoryFilters({ category: "", q: "" })).toEqual(NO_FILTERS);
  });

  it("round-trips through the query string it writes", () => {
    const original = filters({ query: "trotec", state: "archived", attention: "any" });
    const params = Object.fromEntries(toSearchParams(original));
    expect(parseInventoryFilters(params)).toEqual(original);
  });
});

describe("toSearchParams", () => {
  it("leaves unset filters out rather than sending them blank", () => {
    expect(toSearchParams(filters({ state: "draft" })).toString()).toBe("state=draft");
  });

  it("trims the free text, so a stray space is not a filter", () => {
    expect(toSearchParams(filters({ query: "  form 4  " })).toString()).toBe("q=form+4");
    expect(hasActiveFilters(filters({ query: "   " }))).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("narrows by state, category and location exactly", () => {
    expect(matchesFilters(row(), filters({ state: "draft" }))).toBe(false);
    expect(matchesFilters(row(), filters({ category: "Laser Cutting" }))).toBe(false);
    expect(matchesFilters(row(), filters({ location: "Bloomberg 061" }))).toBe(true);
  });

  it("matches one flag at a time", () => {
    const missingPhoto = row({ attention: { noPhoto: true } });
    expect(matchesFilters(missingPhoto, filters({ attention: "no_photo" }))).toBe(true);
    expect(matchesFilters(missingPhoto, filters({ attention: "no_manual" }))).toBe(false);
  });

  it("matches anything flagged under `any` — the filter a review starts from", () => {
    expect(matchesFilters(row({ attention: { openTickets: true } }), filters({ attention: "any" }))).toBe(true);
    expect(matchesFilters(row(), filters({ attention: "any" }))).toBe(false);
  });

  it("ANDs across facets: a draft with no manual is not every draft", () => {
    const draftWithManual = row({ state: "draft" });
    expect(matchesFilters(draftWithManual, filters({ state: "draft", attention: "no_manual" }))).toBe(
      false
    );
  });
});
