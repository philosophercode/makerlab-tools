import {
  countSentences,
  DESCRIPTION_LIMIT_CHARS,
  DESCRIPTION_RULES,
  descriptionProblems,
  hasMarkdownList,
  newNumbers,
} from "./description-rules";

/** The description rules (gateway spec amendment 2026-09-26 "Short descriptions"). */

describe("countSentences", () => {
  it.each([
    ["", 0],
    ["A laser cutter.", 1],
    ["A laser cutter. It cuts acrylic! Does it engrave? Yes.", 4],
    ["It has a 0.4 mm nozzle and a 1.5 kW spindle.", 1],
    ["It works many materials, e.g. plywood and acrylic, i.e. sheet stock.", 1],
    ["A printer from Bambu Lab Inc. in Shenzhen. It prints PLA.", 2],
    ["A printer. It prints PLA", 2],
    ['It is called "the Speedy." Students cut signs with it.', 2],
  ])("%j has %i sentence(s)", (text, n) => {
    expect(countSentences(text)).toBe(n);
  });
});

describe("hasMarkdownList", () => {
  it("finds bullet and numbered lists, not a hyphen in prose", () => {
    expect(hasMarkdownList("A printer.\n\n- **Build volume:** 250 mm")).toBe(true);
    expect(hasMarkdownList("A printer.\n* Fast")).toBe(true);
    expect(hasMarkdownList("Steps:\n1. Load it")).toBe(true);
    expect(hasMarkdownList("A 3-axis mill - small and quiet.")).toBe(false);
  });
});

describe("descriptionProblems", () => {
  it("passes a short description, and an empty one", () => {
    expect(
      descriptionProblems(
        "The Formlabs Form 4 is a resin 3D printer. In a makerspace, students use it for detailed prototypes and small parts."
      )
    ).toEqual([]);
    expect(descriptionProblems("")).toEqual([]);
    expect(descriptionProblems(null)).toEqual([]);
  });

  it("flags more than five sentences, over the limit, and a list", () => {
    expect(descriptionProblems("One. Two. Three. Four. Five. Six.")).toEqual(["too_many_sentences"]);
    expect(descriptionProblems("One. Two. Three. Four. Five.")).toEqual([]);
    expect(descriptionProblems(`A ${"very ".repeat(DESCRIPTION_LIMIT_CHARS / 5)}long sentence.`)).toEqual(["too_long"]);
    expect(descriptionProblems("A printer.\n\n- **Speed:** 500 mm/s")).toEqual(["has_list"]);
  });
});

describe("newNumbers", () => {
  it("finds numbers the original does not have, thousands separators aside", () => {
    expect(newNumbers("A 1,500 W heat gun with a 250 × 210 mm bed.", "A 1500 W heat gun, 250 mm wide.")).toEqual([]);
    expect(newNumbers("A heat gun.", "A 1500 W heat gun at 120 V.")).toEqual(["1500", "120"]);
  });
});

describe("DESCRIPTION_RULES", () => {
  it("says the owner's shape: 1–3 sentences, max 5, ~450 chars, what it is, light specs, no list, no PPE", () => {
    expect(DESCRIPTION_RULES).toContain("**one to three sentences**, at most 5 for a complicated machine, about 450 characters or fewer");
    expect(DESCRIPTION_RULES).toContain("**Open with what the tool is**");
    expect(DESCRIPTION_RULES).toContain("what students use it for in a makerspace");
    expect(DESCRIPTION_RULES).toContain("at most one or two headline specs");
    expect(DESCRIPTION_RULES).toContain("**Never a list of specs**");
    expect(DESCRIPTION_RULES).toContain("**Never mention protective equipment**");
  });
});
