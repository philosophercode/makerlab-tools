import {
  activeUserFacets,
  matchesUserFilters,
  NO_USER_FILTERS,
  parseUserFilters,
  userFiltersToSearchParams,
} from "./users-filters";

describe("users-filters", () => {
  it("reads every facet from the URL and writes it back the same", () => {
    const filters = parseUserFilters({ q: "ada", role: "admin", signed_in: "no", title: "Tech Lead" });
    expect(filters).toEqual({ query: "ada", role: "admin", signedIn: "no", title: "Tech Lead" });
    expect(userFiltersToSearchParams(filters).toString()).toBe("q=ada&role=admin&signed_in=no&title=Tech+Lead");
  });

  it("drops what the page does not offer, and takes the first of a repeated parameter", () => {
    expect(parseUserFilters({ role: "director", signed_in: "maybe", title: "  ", access: "banned" })).toEqual(
      NO_USER_FILTERS
    );
    expect(parseUserFilters({ signed_in: ["yes", "no"] }).signedIn).toBe("yes");
  });

  it("matches signed in, not yet, and the shown title exactly", () => {
    const signedIn = { role: "user" as const, joined: "2026-03-04", shownTitle: "Student" };
    const notYet = { role: "admin" as const, joined: null, shownTitle: "Tech Lead" };

    expect(matchesUserFilters(signedIn, { role: null, signedIn: "yes", title: null })).toBe(true);
    expect(matchesUserFilters(notYet, { role: null, signedIn: "yes", title: null })).toBe(false);
    expect(matchesUserFilters(notYet, { role: null, signedIn: "no", title: null })).toBe(true);
    expect(matchesUserFilters(notYet, { role: "admin", signedIn: null, title: "Tech Lead" })).toBe(true);
    expect(matchesUserFilters(notYet, { role: null, signedIn: null, title: "Tech" })).toBe(false);
  });

  it("counts the facets narrowing the roster, not the search", () => {
    expect(activeUserFacets({ query: "x", role: "admin", signedIn: "no", title: null })).toBe(2);
    expect(activeUserFacets(NO_USER_FILTERS)).toBe(0);
  });
});
