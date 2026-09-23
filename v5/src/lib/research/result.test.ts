import { parseResearchResult, researchResultSchema, type ResearchResult } from "./result";

/**
 * The `ResearchResult` schema (spec §4.10, §10 "Unit").
 *
 * Research output comes from a model that read arbitrary web pages, so the
 * schema is the fence (spec §8): it must refuse anything it was not told to
 * expect, at every level, rather than carry it into the database.
 */

function wellFormed(): ResearchResult {
  return {
    canonicalName: "Prusa MK4S",
    description: "An FDM 3D printer.",
    specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }],
    materials: ["PLA", "PETG"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [{ title: "User manual", url: "https://example.com/manual.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls: ["https://example.com/mk4s"],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
      categoryOnly: false,
    },
    confidence: { level: "high", basis: ["Manual found"], unknowns: [] },
  };
}

describe("researchResultSchema", () => {
  it("accepts a well-formed result, and nulls where the shape allows them", () => {
    expect(researchResultSchema.safeParse(wellFormed()).success).toBe(true);
    expect(
      researchResultSchema.safeParse({
        ...wellFormed(),
        trainingRequired: null,
        category: { name: "FDM", group: null, existingId: null },
        evidence: { ...wellFormed().evidence, modelPlateRead: "MK4S" },
      }).success
    ).toBe(true);
  });

  it("rejects an extra key at the top level", () => {
    expect(researchResultSchema.safeParse({ ...wellFormed(), publish: true }).success).toBe(false);
  });

  it.each([
    ["evidence", (r: ResearchResult) => ({ ...r, evidence: { ...r.evidence, trustMe: true } })],
    ["category", (r: ResearchResult) => ({ ...r, category: { ...r.category, isNew: true } })],
    [
      "resources",
      (r: ResearchResult) => ({ ...r, resources: [{ ...r.resources[0], verified: true }] }),
    ],
    ["confidence", (r: ResearchResult) => ({ ...r, confidence: { ...r.confidence, score: 0.9 } })],
    ["specs", (r: ResearchResult) => ({ ...r, specs: [{ label: "a", value: "b", unit: "mm" }] })],
  ])("rejects an extra key nested in %s", (_where, mutate) => {
    expect(researchResultSchema.safeParse(mutate(wellFormed())).success).toBe(false);
  });

  it.each([
    ["canonicalName as a number", { canonicalName: 4 }],
    ["trainingRequired as a string", { trainingRequired: "yes" }],
    ["materials as a string", { materials: "PLA" }],
    ["sourceUrls with a number", { sourceUrls: [1] }],
    ["a missing description", { description: undefined }],
    ["confidence level outside the grades", { confidence: { level: "certain", basis: [], unknowns: [] } }],
  ])("rejects %s", (_label, patch) => {
    expect(researchResultSchema.safeParse({ ...wellFormed(), ...patch }).success).toBe(false);
  });

  it("rejects a resource type outside Manual, Video and Other", () => {
    const result = wellFormed();
    result.resources = [
      { title: "SOP", url: "https://example.com/sop", type: "SOP" as ResearchResult["resources"][number]["type"] },
    ];
    expect(researchResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("parseResearchResult", () => {
  it("returns the parsed result, or null instead of throwing", () => {
    expect(parseResearchResult(wellFormed())).toEqual(wellFormed());
    expect(parseResearchResult({ canonicalName: "half a result" })).toBeNull();
    expect(parseResearchResult(null)).toBeNull();
    expect(parseResearchResult("Prusa MK4S")).toBeNull();
  });
});
