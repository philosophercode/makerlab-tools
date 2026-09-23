import { focusIncludes, isImageOnlyFocus, parseResearchFocus } from "./research-focus";

/** What a Research again may ask to redo (amendment "Guided redo (focus + guidance)"). */
describe("parseResearchFocus", () => {
  it("is everything (null) when absent, empty, or naming everything at all", () => {
    expect(parseResearchFocus(undefined)).toBeNull();
    expect(parseResearchFocus(null)).toBeNull();
    expect(parseResearchFocus([])).toBeNull();
    expect(parseResearchFocus(["everything"])).toBeNull();
    expect(parseResearchFocus(["specs", "everything"])).toBeNull();
  });

  it("is the fields in canonical order, once each", () => {
    expect(parseResearchFocus(["image", "specs", "specs", "description"])).toEqual(["description", "specs", "image"]);
    expect(parseResearchFocus(["links"])).toEqual(["links"]);
  });

  it("refuses anything that is not a list of known choices", () => {
    expect(parseResearchFocus("specs")).toBe("invalid");
    expect(parseResearchFocus(["specs", "tags"])).toBe("invalid");
    expect(parseResearchFocus([1])).toBe("invalid");
  });

  it("knows an image-only focus, and what a focus touches", () => {
    expect(isImageOnlyFocus(["image"])).toBe(true);
    expect(isImageOnlyFocus(["specs", "image"])).toBe(false);
    expect(isImageOnlyFocus(null)).toBe(false);
    expect(focusIncludes(null, "links")).toBe(true);
    expect(focusIncludes(["specs"], "links")).toBe(false);
  });
});
