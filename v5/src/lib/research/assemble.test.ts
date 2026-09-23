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

  it("keeps the search's links, and still no sources, when its pages could not be read", () => {
    const findings = parseSearchFindings(
      JSON.stringify({
        canonicalName: "Original Prusa MK4S",
        candidateLinks: [{ title: "Manual", url: MANUAL.url, type: "Manual" }],
        sourceUrls: [MANUAL.url],
        evidence: { userStatedModel: true, manufacturerPageFound: true },
      })
    );
    expect(draftFromFindings(findings).resources).toEqual([]);
    const kept = draftFromFindings(findings, { keepCandidateLinks: true });
    expect(kept.resources).toEqual([{ title: "Manual", url: MANUAL.url, type: "Manual" }]);
    expect(kept.sourceUrls).toEqual([]);

    // Nothing was read, so nothing the search claimed about a page survives.
    const result = assembleResearchResult({
      draft: kept,
      verified: kept.resources,
      dropped: [],
      categories: [],
      fallbackName: "MK4S",
    });
    expect(result.evidence.manufacturerPageFound).toBe(false);
    expect(result.evidence.userStatedModel).toBe(false);
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

describe('a video is not a source (amendment "Product-page first")', () => {
  it("does not let a YouTube page alone satisfy manufacturerPageFound or specsFromSource", () => {
    const result = assembleResearchResult({
      draft: draft({ sourceUrls: ["https://www.youtube.com/watch?v=x2d"] }),
      verified: [],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Bambu Lab X2D",
    });
    expect(result.evidence.manufacturerPageFound).toBe(false);
    expect(result.evidence.specsFromSource).toBe(false);
  });

  it("still counts them when a real page was read beside the video", () => {
    const result = assembleResearchResult({
      draft: draft({ sourceUrls: ["https://vimeo.com/1", "https://prusa3d.com/mk4s"] }),
      verified: [MANUAL],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Prusa MK4S",
    });
    expect(result.evidence.manufacturerPageFound).toBe(true);
    expect(result.evidence.specsFromSource).toBe(true);
  });

  it("caps the grade at medium when only a video was read, and says why (the luna-2 X2D run)", () => {
    // The user typed the model and a manual link passed checking: high on the
    // flags alone — but the only page read was a YouTube video.
    const result = assembleResearchResult({
      draft: draft({ sourceUrls: ["https://www.youtube.com/watch?v=x2d"] }),
      verified: [MANUAL],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Bambu Lab X2D",
    });
    expect(result.evidence).toMatchObject({ userStatedModel: true, manualFound: true, manufacturerPageFound: false });
    expect(scoreConfidence(result.evidence).level).toBe("high");
    expect(result.confidence.level).toBe("medium");
    expect(result.confidence.unknowns[0]).toMatch(/^Only a video was read/);
  });

  it("records the reviewer's note on the result, cleaned, and nothing when there is none", () => {
    const base = { draft: draft(), verified: [MANUAL], dropped: [], categories: CATEGORIES, fallbackName: "Prusa MK4S" };
    expect(assembleResearchResult({ ...base, reviewerNote: " use the\nprusa3d.com page " }).reviewerNote).toBe("use the prusa3d.com page");
    expect("reviewerNote" in assembleResearchResult(base)).toBe(false);
  });
});


describe('the search\'s copy of a page (amendment "Search text fallback and confidence cap")', () => {
  const X2D = { brand: "Bambu Lab", name: "Bambu Lab X2D" };
  const base = { verified: [], dropped: [], categories: CATEGORIES, fallbackName: "Bambu Lab X2D", subject: X2D };

  it("counts the brand's product page read through the search's copy as the manufacturer's page and the specs source", () => {
    const result = assembleResearchResult({
      ...base,
      draft: draft({ sourceUrls: ["https://bambulab.com/en/x2d", "https://www.youtube.com/watch?v=x2d"] }),
      searchTextUrls: ["https://bambulab.com/en/x2d"],
    });
    expect(result.evidence.manufacturerPageFound).toBe(true);
    expect(result.evidence.specsFromSource).toBe(true);
    expect(result.confidence.level).toBe("high");
    expect(result.searchTextSources).toEqual(["https://bambulab.com/en/x2d"]);
    expect(researchResultSchema.parse(result)).toEqual(result);
  });

  it("does not count a copy of any other page — a wiki, a retailer — toward either", () => {
    const result = assembleResearchResult({
      ...base,
      draft: draft({ sourceUrls: ["https://wiki.bambulab.com/en/x2d/manual", "https://shop.example/x2d"] }),
      searchTextUrls: ["https://wiki.bambulab.com/en/x2d/manual", "https://shop.example/x2d"],
    });
    expect(result.evidence.manufacturerPageFound).toBe(false);
    expect(result.evidence.specsFromSource).toBe(false);
    // They were read, so the grade is not capped for it — only the evidence is held down.
    expect(result.confidence.unknowns.join(" ")).not.toContain("Only a video");
  });

  it("still counts a page the server read itself beside such a copy", () => {
    const result = assembleResearchResult({
      ...base,
      draft: draft({ sourceUrls: ["https://wiki.bambulab.com/en/x2d/manual", "https://shop.example/x2d"] }),
      searchTextUrls: ["https://wiki.bambulab.com/en/x2d/manual"],
    });
    expect(result.evidence.manufacturerPageFound).toBe(true);
    expect(result.searchTextSources).toEqual(["https://wiki.bambulab.com/en/x2d/manual"]);
  });

  it("records no searchTextSources when no copy was used, and ignores a copy that is not a source", () => {
    const result = assembleResearchResult({
      ...base,
      draft: draft({ sourceUrls: ["https://bambulab.com/en/x2d"] }),
      searchTextUrls: ["https://elsewhere.example/x2d"],
    });
    expect("searchTextSources" in result).toBe(false);
  });
});
