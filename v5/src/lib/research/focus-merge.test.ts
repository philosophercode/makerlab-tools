import { scoreConfidence } from "../capabilities/confidence";
import { changedSections, mergeResearch } from "./focus-merge";
import type { ResearchResult } from "./result";

/**
 * How a Research again lands on the stored result (amendment "Guided redo
 * (focus + guidance)"). The property that matters: a scoped redo changes the
 * focused fields and **nothing else** — every other field comes back
 * byte-identical — and the grade moves only when the evidence did.
 */

const AT = "2026-09-23T12:00:00.000Z";
const SAVED: { name: string; brand: string | null } = { name: "Bambu Lab X2D", brand: "Bambu Lab" };

function previous(): ResearchResult {
  const evidence = {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: false,
    manualFound: false,
    specsFromSource: false,
    categoryOnly: false,
  };
  const sourceUrls = ["https://wiki.bambulab.com/en/x2d/manual/first-print"];
  return {
    canonicalName: "Bambu Lab X2D",
    description: "A dual-nozzle printer.",
    specs: [{ label: "Build volume", value: "256 mm" }],
    materials: ["PLA"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: "Staff only",
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [{ title: "Wiki", url: "https://wiki.bambulab.com/en/x2d", type: "Other" }],
    droppedLinks: ["old link — 404"],
    sourceUrls,
    evidence,
    confidence: scoreConfidence(evidence, { sourceUrls }),
    images: {
      candidates: [
        {
          url: "https://store.bambulab.com/x2d.jpg",
          pageUrl: "https://store.bambulab.com/products/x2d",
          source: "og",
          width: 1200,
          height: 1200,
          contentType: "image/jpeg",
          rank: 1,
          reason: "front",
        },
      ],
      cleaned: { attachmentId: "att-old", fromUrl: "https://store.bambulab.com/x2d.jpg" },
    },
    imageError: null,
    reviewerNote: "the old note",
    researchedAs: { ...SAVED },
    redoRequest: { requestId: "req-2", requestedAt: AT, focus: ["specs"] },
  };
}

function next(): ResearchResult {
  const evidence = {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: true,
    specsFromSource: true,
    categoryOnly: false,
  };
  const sourceUrls = ["https://bambulab.com/en/x2d/specs"];
  return {
    canonicalName: "Bambu Lab X2D Combo",
    description: "A new, longer paragraph about the X2D.",
    specs: [
      { label: "Build volume", value: "256 × 256 × 256 mm³" },
      { label: "Nozzles", value: "2" },
    ],
    materials: ["PLA", "PETG", "ABS"],
    ppeRequired: [],
    tags: ["printer"],
    trainingRequired: false,
    useRestrictions: null,
    category: { name: "Printers", group: null, existingId: null },
    resources: [{ title: "X2D manual", url: "https://bambulab.com/x2d-manual.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls,
    evidence,
    confidence: scoreConfidence(evidence, { sourceUrls }),
    images: { candidates: [], cleaned: null },
    imageError: null,
    reviewerNote: "use the spec table",
    searchTextSources: ["https://bambulab.com/en/x2d/specs"],
  };
}

function merge(focus: Parameters<typeof mergeResearch>[0]["focus"], saved = SAVED, prev: ResearchResult | null = previous()) {
  return mergeResearch({ previous: prev, next: next(), focus, saved, at: AT });
}

/** Every key of `a` except `except`, as JSON — what "byte-identical" means for a stored jsonb value. */
function rest(result: ResearchResult, except: readonly string[]): string {
  const copy: Record<string, unknown> = { ...result };
  for (const key of except) delete copy[key];
  return JSON.stringify(copy);
}

/** Bookkeeping every merge writes: what changed, the focus, the saved name, the note, the marker. */
const BOOKKEEPING = ["updated", "researchFocus", "researchedAs", "reviewerNote", "redoRequest"];

describe("mergeResearch — a scoped redo", () => {
  it("description: takes the description and keeps every other field byte-identical, evidence and grade included", () => {
    const merged = merge(["description"]);
    expect(merged.description).toBe(next().description);
    expect(rest(merged, ["description", ...BOOKKEEPING])).toBe(rest(previous(), ["description", ...BOOKKEEPING]));
    expect(JSON.stringify(merged.confidence)).toBe(JSON.stringify(previous().confidence));
    expect(merged.images).toEqual(previous().images);
    expect(merged.researchFocus).toEqual(["description"]);
    expect(merged.updated).toEqual({ at: AT, sections: ["description"] });
  });

  it("specs: takes the specs and their evidence flag, adds the pages read, and regrades", () => {
    const merged = merge(["specs"]);
    expect(merged.specs).toEqual(next().specs);
    expect(merged.evidence.specsFromSource).toBe(true);
    expect(merged.evidence.manufacturerPageFound).toBe(true);
    // The manual flag is about links, which were not redone.
    expect(merged.evidence.manualFound).toBe(false);
    expect(merged.sourceUrls).toEqual([...previous().sourceUrls, ...next().sourceUrls]);
    expect(merged.searchTextSources).toEqual(["https://bambulab.com/en/x2d/specs"]);
    expect(merged.confidence).toEqual(scoreConfidence(merged.evidence, { sourceUrls: merged.sourceUrls }));
    const untouched = ["specs", "evidence", "sourceUrls", "searchTextSources", "confidence", ...BOOKKEEPING];
    expect(rest(merged, untouched)).toBe(rest(previous(), untouched));
  });

  it("links: takes the resources, the dropped links and the manual flag", () => {
    const merged = merge(["links"]);
    expect(merged.resources).toEqual(next().resources);
    expect(merged.droppedLinks).toEqual([]);
    expect(merged.evidence.manualFound).toBe(true);
    expect(merged.evidence.specsFromSource).toBe(false);
    expect(merged.specs).toEqual(previous().specs);
    expect(merged.description).toBe(previous().description);
    expect(merged.images).toEqual(previous().images);
    expect(merged.updated?.sections).toEqual(["links"]);
  });

  it("image: takes the images and drops the old image search, leaving the text alone", () => {
    const prev = { ...previous(), imageRetry: { requestId: "r", requestedAt: AT, status: "done" as const, note: null, error: null } };
    const merged = mergeResearch({ previous: prev, next: next(), focus: ["specs", "image"], saved: SAVED, at: AT });
    expect(merged.images).toEqual(next().images);
    expect("imageRetry" in merged).toBe(false);
    expect(merged.description).toBe(prev.description);
    expect(merged.updated?.sections).toEqual(["specs", "image"]);
  });

  it("keeps the old name — unless the reviewer saved a different one since", () => {
    expect(merge(["specs"]).canonicalName).toBe("Bambu Lab X2D");
    expect(merge(["specs"], { name: "Bambu Lab X2D Combo (renamed)", brand: "Bambu Lab" }).canonicalName).toBe(
      "Bambu Lab X2D Combo (renamed)"
    );
    // A row from before the saved name was recorded: nothing to compare, the old name stays.
    const legacy = previous();
    delete legacy.researchedAs;
    expect(merge(["specs"], { name: "Something else", brand: null }, legacy).canonicalName).toBe("Bambu Lab X2D");
    expect(merge(["specs"], { name: "Something else", brand: null }).researchedAs).toEqual({ name: "Something else", brand: null });
  });

  it("records the redo's own note, drops the old one when it had none, and always drops the marker", () => {
    expect(merge(["description"]).reviewerNote).toBe("use the spec table");
    const withoutNote = mergeResearch({
      previous: previous(),
      next: { ...next(), reviewerNote: undefined },
      focus: ["description"],
      saved: SAVED,
      at: AT,
    });
    expect("reviewerNote" in withoutNote).toBe(false);
    expect("redoRequest" in withoutNote).toBe(false);
  });

  it("lists only the sections that actually read differently", () => {
    const same = mergeResearch({
      previous: previous(),
      next: { ...next(), description: previous().description },
      focus: ["description", "links"],
      saved: SAVED,
      at: AT,
    });
    expect(same.updated?.sections).toEqual(["links"]);
  });
});

describe("mergeResearch — everything, and a first research", () => {
  it("everything replaces the result whole, with what changed and the saved name", () => {
    const merged = merge(null);
    const { updated, researchedAs, ...restOfIt } = merged;
    expect(restOfIt).toEqual(next());
    expect(researchedAs).toEqual(SAVED);
    expect(updated).toEqual({ at: AT, sections: ["description", "specs", "links", "image"] });
    expect("redoRequest" in merged).toBe(false);
  });

  it("a first research is the result, with the saved name and nothing marked", () => {
    const merged = mergeResearch({ previous: null, next: next(), focus: null, saved: SAVED, at: AT });
    expect(merged).toEqual({ ...next(), researchedAs: SAVED });
  });

  it("changedSections compares all four for everything", () => {
    expect(changedSections(previous(), previous(), null)).toEqual([]);
    expect(changedSections(previous(), next(), ["specs"])).toEqual(["specs"]);
  });
});
