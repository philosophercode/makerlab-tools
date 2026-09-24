import { rebaseAfterConflict } from "./decide";
import { addRestrictions, keepsLabRestrictions, rebaseRestrictions, replacesLabRule, restrictionLines, trainingChangeAllowed } from "./lab-rules";
import type { FieldProposal } from "./types";

/**
 * Research never replaces the lab's rules (refresh research spec, amendment
 * 2026-09-24): restrictions only gain lines, training only tightens.
 */

const verified = [{ quote: "must be supervised", url: "https://formlabs.com/form-4", verified: true }];

function card(overrides: Partial<FieldProposal>): FieldProposal {
  return {
    id: "use_restrictions",
    field: "use_restrictions",
    kind: "differs",
    safety: true,
    current: "Resin handling training required before first print.",
    proposed: "Resin handling training required before first print.\nYoung or inexperienced users must be supervised.",
    added: ["Young or inexperienced users must be supervised."],
    citations: verified,
    decision: "pending",
    ...overrides,
  };
}

describe("restrictionLines", () => {
  it("splits on lines, strips bullets and drops blanks", () => {
    expect(restrictionLines("- Authorized users only.\n\n• No metals\r\n  Staff present ")).toEqual(["Authorized users only.", "No metals", "Staff present"]);
    expect(restrictionLines(null)).toEqual([]);
  });
});

describe("addRestrictions", () => {
  it("keeps the lab's text verbatim and appends only new lines", () => {
    expect(addRestrictions("Resin handling training required before first print.", "Young or inexperienced users must be supervised.")).toEqual({
      proposed: "Resin handling training required before first print.\nYoung or inexperienced users must be supervised.",
      added: ["Young or inexperienced users must be supervised."],
    });
  });

  it("adds nothing the lab already says, ignoring case and punctuation", () => {
    expect(addRestrictions("Authorized users only. No metals!", "no metals")).toBeNull();
    expect(addRestrictions("Authorized users only.", "authorized users only")).toBeNull();
  });

  it("fills an empty text with research's lines", () => {
    expect(addRestrictions(null, "No metals.")).toEqual({ proposed: "No metals.", added: ["No metals."] });
  });
});

describe("keepsLabRestrictions / trainingChangeAllowed", () => {
  it("a replacement drops a lab line; an addition keeps them all", () => {
    expect(keepsLabRestrictions("A rule.\nB rule.", "A rule.\nB rule.\nC rule.")).toBe(true);
    expect(keepsLabRestrictions("A rule.\nB rule.", "C rule.")).toBe(false);
    expect(keepsLabRestrictions(null, "C rule.")).toBe(true);
  });

  it("training may be turned on, never off", () => {
    expect(trainingChangeAllowed(false, true)).toBe(true);
    expect(trainingChangeAllowed(true, false)).toBe(false);
  });
});

describe("replacesLabRule", () => {
  it("flags a replacement of the Form 4's resin rule and a training switch-off", () => {
    expect(replacesLabRule(card({ proposed: "Young or inexperienced users must be supervised.", added: undefined }))).toBe(true);
    expect(replacesLabRule(card({ field: "training_required", id: "training_required", current: true, proposed: false }))).toBe(true);
  });

  it("passes an addition, a first restriction, training turned on, and other fields", () => {
    expect(replacesLabRule(card({}))).toBe(false);
    expect(replacesLabRule(card({ kind: "new", current: null, proposed: "No metals." }))).toBe(false);
    expect(replacesLabRule(card({ field: "training_required", id: "training_required", current: false, proposed: true }))).toBe(false);
    expect(replacesLabRule(card({ field: "emergency_stop", id: "emergency_stop", current: "Red button, left.", proposed: "Red button, right." }))).toBe(false);
  });
});

describe("re-basing after a conflict", () => {
  it("puts research's lines on top of what the lab has now", () => {
    expect(rebaseRestrictions(card({}), "Staff present at all times.")).toMatchObject({
      current: "Staff present at all times.",
      proposed: "Staff present at all times.\nYoung or inexperienced users must be supervised.",
      added: ["Young or inexperienced users must be supervised."],
    });
  });

  it("proposes the text unchanged when the lab already added the line", () => {
    const now = "Resin handling training required.\nYoung or inexperienced users must be supervised.";
    expect(rebaseRestrictions(card({}), now)).toMatchObject({ current: now, proposed: now, added: [] });
  });

  it("rebaseAfterConflict re-bases a restrictions card additively and marks it a conflict", () => {
    const [rebased] = rebaseAfterConflict([card({})], {
      name: "Form 4",
      description: null,
      materials: [],
      tags: [],
      trainingRequired: true,
      useRestrictions: "Staff present at all times.",
      emergencyStop: null,
      floorCheck: null,
    });
    expect(rebased).toMatchObject({
      decision: "conflict",
      proposed: "Staff present at all times.\nYoung or inexperienced users must be supervised.",
    });
    expect(replacesLabRule(rebased)).toBe(false);
  });
});
