import { REVIEWER_NOTE_MAX_CHARS } from "../intake/limits";
import {
  imageCandidateSchema,
  parseResearchResult,
  researchImagesSchema,
  researchResultSchema,
  type ImageCandidate,
  type ResearchImages,
  type ResearchResult,
} from "./result";

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

describe("ResearchResult.images (gateway spec §4.1)", () => {
  function candidate(rank: 1 | 2 | 3, patch: Partial<ImageCandidate> = {}): ImageCandidate {
    return {
      url: `https://cdn.example.com/mk4s-${rank}.jpg`,
      pageUrl: "https://example.com/mk4s",
      source: "og",
      width: 1200,
      height: 900,
      contentType: "image/jpeg",
      rank,
      reason: "Front view of the whole printer on a plain background.",
      ...patch,
    };
  }

  function images(patch: Partial<ResearchImages> = {}): ResearchImages {
    return {
      candidates: [candidate(1), candidate(2, { source: "jsonld" }), candidate(3, { source: "exa", pageUrl: null })],
      cleaned: { attachmentId: "5f0c7c1e-8a4e-4a5b-9d59-2b1f3c4d5e6f", fromUrl: "https://cdn.example.com/mk4s-1.jpg" },
      ...patch,
    };
  }

  it("still parses a row researched before the image stage, and parses it back to exactly itself", () => {
    const old = wellFormed();
    expect("images" in old).toBe(false);
    expect(parseResearchResult(old)).toEqual(old);
    expect(Object.keys(parseResearchResult(old)!)).not.toContain("images");
  });

  it("parses a row with images and no error, and one with the stage failed", () => {
    expect(parseResearchResult({ ...wellFormed(), images: images(), imageError: null })).toEqual({
      ...wellFormed(),
      images: images(),
      imageError: null,
    });
    expect(parseResearchResult({ ...wellFormed(), images: null, imageError: "image stage timed out" })).not.toBeNull();
  });

  it("parses no candidates and no cleaned copy — the stage found nothing", () => {
    expect(researchImagesSchema.safeParse({ candidates: [], cleaned: null }).success).toBe(true);
  });

  it("parses fewer than three candidates", () => {
    expect(researchImagesSchema.safeParse(images({ candidates: [candidate(1)], cleaned: null })).success).toBe(true);
  });

  it.each([
    ["rank 4", (c: ImageCandidate) => ({ ...c, rank: 4 })],
    ["rank 0", (c: ImageCandidate) => ({ ...c, rank: 0 })],
    ["a reason over 200 characters", (c: ImageCandidate) => ({ ...c, reason: "x".repeat(201) })],
    ["an extra key", (c: ImageCandidate) => ({ ...c, publish: true })],
    ["a GIF", (c: ImageCandidate) => ({ ...c, contentType: "image/gif" })],
    ["an unknown source", (c: ImageCandidate) => ({ ...c, source: "google" })],
    ["a zero width", (c: ImageCandidate) => ({ ...c, width: 0 })],
    ["a fractional height", (c: ImageCandidate) => ({ ...c, height: 10.5 })],
    ["a javascript: URL", (c: ImageCandidate) => ({ ...c, url: "javascript:alert(1)" })],
    ["a relative URL", (c: ImageCandidate) => ({ ...c, url: "/p.jpg" })],
    ["a data: page URL", (c: ImageCandidate) => ({ ...c, pageUrl: "data:text/html,hi" })],
  ])("refuses a candidate with %s", (_label, mutate) => {
    expect(imageCandidateSchema.safeParse(mutate(candidate(1))).success).toBe(false);
  });

  it("accepts a reason of exactly 200 characters", () => {
    expect(imageCandidateSchema.safeParse(candidate(1, { reason: "x".repeat(200) })).success).toBe(true);
  });

  it("refuses more than three candidates", () => {
    const four = [...images().candidates, { ...candidate(3), url: "https://cdn.example.com/4.jpg" }];
    expect(researchImagesSchema.safeParse(images({ candidates: four })).success).toBe(false);
  });

  it("refuses candidates out of rank order", () => {
    const swapped = [candidate(2), candidate(1)];
    expect(researchImagesSchema.safeParse(images({ candidates: swapped })).success).toBe(false);
    expect(researchImagesSchema.safeParse(images({ candidates: [candidate(2)] })).success).toBe(false);
  });

  it("refuses an extra key on the images object or on the cleaned copy", () => {
    expect(researchImagesSchema.safeParse({ ...images(), chosen: 1 }).success).toBe(false);
    expect(
      researchImagesSchema.safeParse(images({ cleaned: { attachmentId: "a", fromUrl: "https://x.test/", publicUrl: "https://x" } as never }))
        .success
    ).toBe(false);
  });

  it("parses a candidate's background and the clean note, and rows from before either existed", () => {
    const classified = images({
      candidates: [candidate(1, { background: "transparent" }), candidate(2, { background: "busy" })],
      cleaned: null,
      cleanNote: "busy_background",
    });
    expect(researchImagesSchema.parse(classified)).toEqual(classified);
    const old = images();
    const parsed = researchImagesSchema.parse(old);
    expect(parsed).toEqual(old);
    expect("cleanNote" in parsed).toBe(false);
    expect("background" in parsed.candidates[0]).toBe(false);
  });

  it("refuses a background or clean note it does not know", () => {
    expect(imageCandidateSchema.safeParse(candidate(1, { background: "white" as never })).success).toBe(false);
    expect(researchImagesSchema.safeParse(images({ cleanNote: "redrawn" as never })).success).toBe(false);
  });

  it("parses a candidate's product box, and refuses one that is not a box (amendment \"The picked image is cleaned too\")", () => {
    const boxed = candidate(2, { productBox: [0.2, 0.1, 0.8, 0.9] });
    expect(imageCandidateSchema.parse(boxed)).toEqual(boxed);
    for (const productBox of [[0.8, 0.1, 0.2, 0.9], [0, 0, 1.2, 1], [0.1, 0.1, 0.5]]) {
      expect(imageCandidateSchema.safeParse(candidate(2, { productBox: productBox as never })).success).toBe(false);
    }
  });

  it("refuses a bad images value on the result as a whole", () => {
    expect(parseResearchResult({ ...wellFormed(), images: { candidates: [candidate(4 as 1)], cleaned: null } })).toBeNull();
    expect(parseResearchResult({ ...wellFormed(), imageError: 42 })).toBeNull();
  });
});

describe('views, reviewer notes and image reruns (amendment "Product-page first, front-facing images, reviewer notes")', () => {
  const candidate: ImageCandidate = {
    url: "https://bambulab.com/img/x2d.png",
    pageUrl: "https://bambulab.com/en/x2d",
    source: "og",
    width: 1200,
    height: 900,
    contentType: "image/png",
    rank: 1,
    reason: "front",
  };

  it("accepts an old candidate with no view, and parses it to itself", () => {
    expect(imageCandidateSchema.parse(candidate)).toEqual(candidate);
    expect("view" in imageCandidateSchema.parse(candidate)).toBe(false);
  });

  it("accepts a known view and refuses an unknown one", () => {
    expect(imageCandidateSchema.safeParse({ ...candidate, view: "back" }).success).toBe(true);
    expect(imageCandidateSchema.safeParse({ ...candidate, view: "upside_down" }).success).toBe(false);
  });

  it("accepts an old result with no note and no rerun, and a new one with both", () => {
    expect(parseResearchResult(wellFormed())).toEqual(wellFormed());
    const next: ResearchResult = {
      ...wellFormed(),
      reviewerNote: "use the bambulab.com X2D product page",
      imageRetry: { requestId: "r1", requestedAt: "2026-09-23T12:00:00.000Z", status: "failed", note: null, error: "nothing new" },
    };
    expect(parseResearchResult(next)).toEqual(next);
    expect(researchResultSchema.safeParse({ ...wellFormed(), reviewerNote: "x".repeat(REVIEWER_NOTE_MAX_CHARS + 1) }).success).toBe(false);
    expect(researchResultSchema.safeParse({ ...next, imageRetry: { ...next.imageRetry, status: "queued" } }).success).toBe(false);
  });
});


describe('a guided redo\'s record (amendment "Guided redo (focus + guidance)")', () => {
  it("parses a result from before focus existed to itself, with none of the new keys", () => {
    const old = wellFormed();
    const parsed = parseResearchResult(old);
    expect(parsed).toEqual(old);
    for (const key of ["researchFocus", "researchedAs", "redoRequest", "updated"]) {
      expect(key in (parsed as object)).toBe(false);
    }
  });

  it("parses a result carrying a focus, the saved name, a redo marker and what changed", () => {
    const next: ResearchResult = {
      ...wellFormed(),
      reviewerNote: "x".repeat(REVIEWER_NOTE_MAX_CHARS),
      researchFocus: ["specs", "links"],
      researchedAs: { name: "Prusa MK4S", brand: null },
      redoRequest: { requestId: "r1", requestedAt: "2026-09-23T12:00:00.000Z", focus: [] },
      updated: { at: "2026-09-23T12:05:00.000Z", sections: ["specs"] },
    };
    expect(parseResearchResult(next)).toEqual(next);
  });

  it("refuses an unknown focus, an empty recorded focus and an unknown section", () => {
    expect(researchResultSchema.safeParse({ ...wellFormed(), researchFocus: ["everything"] }).success).toBe(false);
    expect(researchResultSchema.safeParse({ ...wellFormed(), researchFocus: [] }).success).toBe(false);
    expect(
      researchResultSchema.safeParse({ ...wellFormed(), updated: { at: "2026-09-23T12:05:00.000Z", sections: ["tags"] } })
        .success
    ).toBe(false);
  });
});

describe('ResearchResult.starterQuestions (amendment "Tool-specific starter questions")', () => {
  it("parses a row researched before them to exactly itself", () => {
    const old = wellFormed();
    expect(parseResearchResult(old)).toEqual(old);
    expect("starterQuestions" in (parseResearchResult(old) ?? {})).toBe(false);
  });

  it("parses up to three short questions", () => {
    const row = { ...wellFormed(), starterQuestions: ["What resins can I print with?", "How big can a part be?"] };
    expect(parseResearchResult(row)).toEqual(row);
  });

  it("refuses more than three, an empty or over-long one", () => {
    expect(parseResearchResult({ ...wellFormed(), starterQuestions: ["A?", "B?", "C?", "D?"] })).toBeNull();
    expect(parseResearchResult({ ...wellFormed(), starterQuestions: [""] })).toBeNull();
    expect(parseResearchResult({ ...wellFormed(), starterQuestions: [`${"x".repeat(80)}?`] })).toBeNull();
  });
});
