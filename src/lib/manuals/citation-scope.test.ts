import { answerToolIds, isOtherMachine, searchScopeOf, searchScopes } from "./citation-scope";

/**
 * Which machines an answer may cite (manual text spec amendment 2026-10-06
 * "An answer cites only its machine's documents"). Pure.
 */

describe("answerToolIds", () => {
  it("is the focused tool on a tool page, whatever the searches did", () => {
    expect(answerToolIds("form", [{ toolIds: ["trotec"], wide: false }])).toEqual(new Set(["form"]));
  });

  it("is the machines the searches were scoped to off a tool page", () => {
    expect(
      answerToolIds(null, [
        { toolIds: ["trotec"], wide: false },
        { toolIds: ["trotec", "epilog"], wide: false },
      ])
    ).toEqual(new Set(["trotec", "epilog"]));
    expect(answerToolIds(undefined, [])).toEqual(new Set());
  });

  it("is any machine once a search compared the whole lab", () => {
    expect(answerToolIds(null, [{ toolIds: ["trotec"], wide: false }, { toolIds: [], wide: true }])).toBeNull();
  });
});

describe("isOtherMachine", () => {
  it("is true for a machine outside the set, or a passage with no machine", () => {
    const allowed = new Set(["bambu"]);
    expect(isOtherMachine("prusa", allowed)).toBe(true);
    expect(isOtherMachine(null, allowed)).toBe(true);
    expect(isOtherMachine("bambu", allowed)).toBe(false);
  });

  it("is never true when any machine may be cited", () => {
    expect(isOtherMachine("prusa", null)).toBe(false);
  });
});

describe("searchScopeOf / searchScopes", () => {
  it("reads what a search_manual output recorded about its scope", () => {
    expect(searchScopeOf({ status: "ok", toolIds: ["a", 7, ""], comparing: "none" })).toEqual({ toolIds: ["a"], wide: false });
    expect(searchScopeOf({ status: "ok", toolIds: [], comparing: "all" })).toEqual({ toolIds: [], wide: true });
    expect(searchScopeOf({ status: "ok", passages: [] })).toBeNull();
  });

  it("takes only searches that returned passages, and counts one with no recorded scope as wide", () => {
    expect(
      searchScopes([
        { status: "ok", toolIds: ["a"], comparing: "none" },
        { status: "no_results", toolIds: ["b"], comparing: "none" },
        { status: "needs_tool", message: "x" },
        { status: "ok", passages: [] },
      ])
    ).toEqual([
      { toolIds: ["a"], wide: false },
      { toolIds: [], wide: true },
    ]);
  });
});
