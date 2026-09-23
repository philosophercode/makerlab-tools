// @vitest-environment node
import { FatalError } from "workflow";
import { scoreConfidence } from "../capabilities/confidence";
import type { CategoryOption } from "../data/taxonomy";
import { assembleResearchResult, draftFromFindings, uniqueHosts, uniqueLinks } from "./assemble";
import { parseFetchDraft, parseSearchFindings, type FetchDraft } from "./model-output";
import { researchResultSchema } from "./result";

/**
 * The draft → stored result step (spec §4.10, §8). Everything the code decides
 * rather than the model: the grade, the evidence held to what happened, the
 * verified links, the category.
 */

const CATEGORIES: CategoryOption[] = [{ id: "cat-fdm", name: "FDM", group: "3D Printing" }];

const MANUAL = { title: "MK4S manual", url: "https://prusa3d.com/mk4s.pdf", type: "Manual" as const };

function draft(overrides: Partial<Record<string, unknown>> = {}): FetchDraft {
  return parseFetchDraft(
    JSON.stringify({
      canonicalName: "Original Prusa MK4S",
      description: "An enclosed-optional FDM printer.",
      specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }],
      materials: ["PLA", "PETG"],
      ppeRequired: [],
      tags: ["FDM"],
      trainingRequired: true,
      useRestrictions: null,
      category: { name: "fdm", group: "3D printing" },
      resources: [MANUAL],
      sourceUrls: ["https://prusa3d.com/mk4s"],
      evidence: {
        userStatedModel: true,
        modelPlateRead: null,
        manufacturerPageFound: true,
        manualFound: true,
        specsFromSource: true,
        categoryOnly: false,
      },
      ...overrides,
    })
  );
}

describe("assembleResearchResult", () => {
  it("builds a result that parses, with a high grade computed from the evidence", () => {
    const result = assembleResearchResult({
      draft: draft(),
      verified: [MANUAL],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(researchResultSchema.parse(result)).toEqual(result);
    expect(result.confidence.level).toBe("high");
    expect(result.confidence).toEqual(scoreConfidence(result.evidence));
    expect(result.category).toEqual({ name: "FDM", group: "3D Printing", existingId: "cat-fdm" });
    expect(result.resources).toEqual([MANUAL]);
  });

  it("ignores a confidence the model claimed", () => {
    const claimed = draft({
      confidence: { level: "high", basis: ["trust me"], unknowns: [] },
      evidence: { categoryOnly: true },
    });
    const result = assembleResearchResult({
      draft: claimed,
      verified: [],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.confidence.level).toBe("low");
    expect(result.confidence.basis).not.toContain("trust me");
  });

  it("keeps only verified links as resources and carries the dropped ones as text", () => {
    const video = { title: "Setup", url: "https://youtu.be/nope", type: "Video" as const };
    const result = assembleResearchResult({
      draft: draft({ resources: [MANUAL, video] }),
      verified: [MANUAL],
      dropped: ['Video "Setup" (https://youtu.be/nope) — video does not exist'],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.resources).toEqual([MANUAL]);
    expect(result.droppedLinks).toEqual(['Video "Setup" (https://youtu.be/nope) — video does not exist']);
  });

  it("takes back a manual the link check dropped", () => {
    const result = assembleResearchResult({
      draft: draft(),
      verified: [],
      dropped: ['Manual "MK4S manual" (https://prusa3d.com/mk4s.pdf) — HTTP 404'],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.evidence.manualFound).toBe(false);
    // The manufacturer page still stands, so the grade holds; the unknowns say what is missing.
    expect(result.confidence.level).toBe("high");
    expect(result.confidence.unknowns).toContain("No manual was found");
  });

  it("grades low when nothing was read, whatever the model reported", () => {
    const result = assembleResearchResult({
      draft: draft({ sourceUrls: [], resources: [] }),
      verified: [],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.evidence).toMatchObject({
      userStatedModel: false,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
    });
    expect(result.confidence.level).toBe("low");
  });

  it("never records a plate read — research is shown no photos", () => {
    const result = assembleResearchResult({
      draft: draft({ evidence: { modelPlateRead: "MK4S-1234" } }),
      verified: [],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.evidence.modelPlateRead).toBeNull();
  });

  it("cleans labels: trimmed, short, one of each", () => {
    const result = assembleResearchResult({
      draft: draft({
        materials: [" PLA ", "pla", "PETG.", "", "Wood (plywood, hardwood, veneer, MDF and many other sheet goods)"],
      }),
      verified: [MANUAL],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.materials).toEqual(["PLA", "PETG"]);
  });

  it("falls back to the item's own name and keeps only http(s) sources", () => {
    const result = assembleResearchResult({
      draft: draft({ canonicalName: "", sourceUrls: ["https://a.example/x", "javascript:alert(1)", "not a url"] }),
      verified: [MANUAL],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.canonicalName).toBe("Prusa MK4S");
    expect(result.sourceUrls).toEqual(["https://a.example/x"]);
  });

  it("throws FatalError when the result cannot fit the schema", () => {
    const broken = { ...draft(), specs: [{ label: 1, value: 2 }] } as unknown as FetchDraft;
    expect(() =>
      assembleResearchResult({ draft: broken, verified: [], dropped: [], categories: [], fallbackName: "X" })
    ).toThrow(FatalError);
  });
});

describe("draftFromFindings", () => {
  it("invents nothing, and what it makes grades low", () => {
    const findings = parseSearchFindings(
      JSON.stringify({
        canonicalName: "Unknown Vinyl Cutter",
        description: "",
        evidence: { userStatedModel: true, manufacturerPageFound: true },
      })
    );
    const empty = draftFromFindings(findings);
    expect(empty).toMatchObject({ specs: [], resources: [], sourceUrls: [], materials: [], tags: [] });

    const result = assembleResearchResult({
      draft: empty,
      verified: [],
      dropped: [],
      categories: [],
      fallbackName: "Vinyl cutter",
    });
    expect(result.confidence.level).toBe("low");
    expect(result.resources).toEqual([]);
  });
});

describe("uniqueLinks / uniqueHosts", () => {
  it("dedupes links by URL and lists each host once", () => {
    const links = uniqueLinks([MANUAL, { ...MANUAL, title: "again" }, { ...MANUAL, url: "https://www.prusa3d.com/x" }]);
    expect(links).toHaveLength(2);
    expect(uniqueHosts([...links.map((l) => l.url), "ftp://x.example/y", "garbage"])).toEqual([
      "prusa3d.com",
      "www.prusa3d.com",
    ]);
  });
});
