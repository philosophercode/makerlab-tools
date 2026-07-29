import {
  confidenceLevel,
  confidenceLines,
  scoreConfidence,
  toEvidence,
} from "./confidence";
import type { IntakeEvidence } from "./types";

/**
 * Unit coverage for the scoring function (confidence spec §10). This is the
 * file that makes deriving confidence in code worth it: every evidence
 * combination is graded here, offline, with no model in the loop.
 */

/** Build evidence with everything absent except the named fields. */
function evidence(over: Partial<IntakeEvidence> = {}): IntakeEvidence {
  return toEvidence(over);
}

/** Every reachable evidence combination: 5 booleans × plate present/absent. */
function allCombinations(): IntakeEvidence[] {
  const out: IntakeEvidence[] = [];
  for (let bits = 0; bits < 64; bits += 1) {
    out.push({
      userStatedModel: Boolean(bits & 1),
      modelPlateRead: bits & 2 ? "X1-Carbon" : null,
      manufacturerPageFound: Boolean(bits & 4),
      manualFound: Boolean(bits & 8),
      specsFromSource: Boolean(bits & 16),
      categoryOnly: Boolean(bits & 32),
    });
  }
  return out;
}

describe("confidence levels", () => {
  it("grades a stated model with a manual as high", () => {
    // Spec §10: "user-stated model + manual found → high".
    const c = scoreConfidence(
      evidence({ userStatedModel: true, manualFound: true })
    );
    expect(c.level).toBe("high");
  });

  it("grades a read plate with a manufacturer page as high", () => {
    const c = scoreConfidence(
      evidence({ modelPlateRead: "X1-Carbon", manufacturerPageFound: true })
    );
    expect(c.level).toBe("high");
  });

  it("grades a read plate with no source as medium", () => {
    // Spec §10: "plate read + no source → medium". We know *what* it is; we
    // have nothing to check its specs against.
    const c = scoreConfidence(evidence({ modelPlateRead: "MK4" }));
    expect(c.level).toBe("medium");
  });

  it("grades a stated model with no source as medium", () => {
    expect(scoreConfidence(evidence({ userStatedModel: true })).level).toBe(
      "medium"
    );
  });

  it("grades a source with no identified model as medium", () => {
    // A page was read but the exact variant is ambiguous.
    const c = scoreConfidence(evidence({ manufacturerPageFound: true }));
    expect(c.level).toBe("medium");
  });

  it("grades specs-from-source with no model as medium", () => {
    expect(scoreConfidence(evidence({ specsFromSource: true })).level).toBe(
      "medium"
    );
  });

  it("grades category-only as low", () => {
    // Spec §10: "category only → low".
    expect(scoreConfidence(evidence({ categoryOnly: true })).level).toBe("low");
  });

  it("grades no evidence at all as low", () => {
    expect(scoreConfidence(evidence()).level).toBe("low");
  });

  it("caps at low when categoryOnly contradicts the rest", () => {
    // Contradictory input resolves toward asking a question, never toward a
    // confident-looking card.
    const c = scoreConfidence(
      evidence({
        categoryOnly: true,
        userStatedModel: true,
        modelPlateRead: "MK4",
        manufacturerPageFound: true,
        manualFound: true,
        specsFromSource: true,
      })
    );
    expect(c.level).toBe("low");
  });

  it("never reaches high on specs-from-source alone", () => {
    // specsFromSource corroborates the specs but is neither a manufacturer page
    // nor a manual, which is what the spec table requires for high.
    const c = scoreConfidence(
      evidence({ userStatedModel: true, specsFromSource: true })
    );
    expect(c.level).toBe("medium");
  });
});

describe("confidence across every evidence combination", () => {
  it("only ever returns one of the three levels", () => {
    for (const e of allCombinations()) {
      expect(["high", "medium", "low"]).toContain(confidenceLevel(e));
    }
  });

  it("never grades high without both an identified model and a fetched source", () => {
    // The case that would embarrass us (spec §10): a confidently wrong card.
    for (const e of allCombinations()) {
      if (confidenceLevel(e) !== "high") continue;
      expect(e.userStatedModel || e.modelPlateRead !== null).toBe(true);
      expect(e.manufacturerPageFound || e.manualFound).toBe(true);
      expect(e.categoryOnly).toBe(false);
    }
  });

  it("grades low whenever the category is all we have", () => {
    for (const e of allCombinations()) {
      if (e.categoryOnly) expect(confidenceLevel(e)).toBe("low");
    }
  });

  it("never grades high with an empty basis", () => {
    for (const e of allCombinations()) {
      const c = scoreConfidence(e);
      if (c.level !== "low") expect(c.basis.length).toBeGreaterThan(0);
    }
  });

  it("always names at least one unknown below high", () => {
    for (const e of allCombinations()) {
      const c = scoreConfidence(e);
      if (c.level !== "high") expect(c.unknowns.length).toBeGreaterThan(0);
    }
  });

  it("generates one basis line per piece of evidence held", () => {
    for (const e of allCombinations()) {
      const held =
        Number(e.userStatedModel) +
        Number(e.modelPlateRead !== null) +
        Number(e.manufacturerPageFound) +
        Number(e.manualFound) +
        Number(e.specsFromSource);
      expect(confidenceLines(e).basis).toHaveLength(held);
    }
  });

  it("never emits the same line twice", () => {
    for (const e of allCombinations()) {
      const lines = confidenceLines(e);
      const codes = [
        ...lines.basis.map((l) => `b:${l.code}`),
        ...lines.unknowns.map((l) => `u:${l.code}`),
      ];
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("never contradicts itself — a found manual is never also an unknown", () => {
    for (const e of allCombinations()) {
      const lines = confidenceLines(e);
      const unknowns = lines.unknowns.map((l) => l.code);
      if (e.manualFound) expect(unknowns).not.toContain("manual");
      if (e.specsFromSource) expect(unknowns).not.toContain("specs");
      if (e.manufacturerPageFound || e.manualFound) {
        expect(unknowns).not.toContain("source");
      }
      if (e.userStatedModel || e.modelPlateRead !== null) {
        expect(unknowns).not.toContain("model");
      }
    }
  });

  it("is pure — it does not mutate the evidence it is given", () => {
    for (const e of allCombinations()) {
      const before = JSON.stringify(e);
      scoreConfidence(e);
      expect(JSON.stringify(e)).toBe(before);
    }
  });
});

describe("basis and unknown lines", () => {
  it("quotes the plate text it actually read", () => {
    const lines = confidenceLines(evidence({ modelPlateRead: "X1-Carbon" }));
    const plate = lines.basis.find((l) => l.code === "modelPlateRead");
    expect(plate?.values).toEqual({ plate: "X1-Carbon" });
    expect(scoreConfidence(evidence({ modelPlateRead: "X1-Carbon" })).basis)
      .toContain('Model plate reads "X1-Carbon"');
  });

  it("asks for the label when no model is identified", () => {
    const lines = confidenceLines(evidence({ manufacturerPageFound: true }));
    expect(lines.unknowns.map((l) => l.code)).toContain("model");
  });

  it("collapses the per-source unknowns when nothing was fetched at all", () => {
    const lines = confidenceLines(evidence({ userStatedModel: true }));
    const codes = lines.unknowns.map((l) => l.code);
    expect(codes).toContain("source");
    expect(codes).not.toContain("manual");
    expect(codes).not.toContain("specs");
  });

  it("names the missing manual when a page was read but no manual found", () => {
    const lines = confidenceLines(
      evidence({ userStatedModel: true, manufacturerPageFound: true })
    );
    const codes = lines.unknowns.map((l) => l.code);
    expect(codes).toContain("manual");
    expect(codes).toContain("specs");
    expect(codes).not.toContain("source");
  });

  it("says nothing is unknown once everything corroborates", () => {
    const c = scoreConfidence(
      evidence({
        userStatedModel: true,
        modelPlateRead: "X1-Carbon",
        manufacturerPageFound: true,
        manualFound: true,
        specsFromSource: true,
      })
    );
    expect(c.level).toBe("high");
    expect(c.unknowns).toEqual([]);
    expect(c.basis).toHaveLength(5);
  });
});

describe("toEvidence", () => {
  it("defaults every unreported field to absent", () => {
    expect(toEvidence()).toEqual({
      userStatedModel: false,
      modelPlateRead: null,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    });
  });

  it("treats a blank plate reading as no plate", () => {
    expect(toEvidence({ modelPlateRead: "   " }).modelPlateRead).toBeNull();
    expect(scoreConfidence({ modelPlateRead: "" }).level).toBe("low");
  });

  it("trims the plate text it keeps", () => {
    expect(toEvidence({ modelPlateRead: "  MK4 " }).modelPlateRead).toBe("MK4");
  });

  it("fills the gaps in a partial report without inventing evidence", () => {
    const e = toEvidence({ manualFound: true });
    expect(e.manualFound).toBe(true);
    expect(e.manufacturerPageFound).toBe(false);
    expect(scoreConfidence(e).level).toBe("medium");
  });
});
