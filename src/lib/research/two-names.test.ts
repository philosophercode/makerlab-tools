// @vitest-environment node
import type { CategoryOption } from "../data/taxonomy";
import { assembleResearchResult } from "./assemble";
import { mergeResearch } from "./focus-merge";
import { parseFetchDraft, parseSearchFindings } from "./model-output";
import { researchSystemPrompt } from "./prompt";
import { researchDisplayName, researchResultSchema, type ResearchResult } from "./result";

/**
 * A tool's two names in research (tool display names spec 2026-09-24, §5.2):
 * the read prompt asks for both, the parser reads both (and the old key), and
 * assembly keeps the display rules whatever the model answered.
 */

const CATEGORIES: CategoryOption[] = [{ id: "cat-fdm", name: "FDM", group: "3D Printing" }];
const MANUAL = { title: "Manual", url: "https://example.com/manual.pdf", type: "Manual" as const };

function assemble(answer: Record<string, unknown>, fallbackName = "Plunge base"): ResearchResult {
  return assembleResearchResult({
    draft: parseFetchDraft(
      JSON.stringify({
        description: "A plunge base.",
        sourceUrls: ["https://makitatools.com/196094-2"],
        evidence: { manufacturerPageFound: true, specsFromSource: true },
        ...answer,
      })
    ),
    verified: [MANUAL],
    dropped: [],
    categories: CATEGORIES,
    fallbackName,
  });
}

describe("the read prompt", () => {
  it("asks for an official name and a short display name, with the rules and the owner's examples", () => {
    const read = researchSystemPrompt("read");
    expect(read).toContain('"officialName"');
    expect(read).toContain('"displayName"');
    expect(read).toContain("Makita Plunge Base");
    expect(read).toContain("Drill Master Heat Gun");
    expect(read).toContain("No part or catalogue numbers");
    expect(read).toContain("never more than 40");
    expect(read).toContain("for each of `officialName`");
    expect(read).not.toContain('"canonicalName"');
  });

  it("leaves the display rules out of the search pass, which asks for the official name only", () => {
    const search = researchSystemPrompt("search");
    expect(search).toContain('"officialName"');
    expect(search).not.toContain('"displayName"');
  });
});

describe("parsing the model's answer", () => {
  it("reads officialName into canonicalName, and the display name as given", () => {
    const draft = parseFetchDraft(JSON.stringify({ officialName: "Formlabs Form 4", displayName: "  Formlabs   Form 4 " }));
    expect(draft.canonicalName).toBe("Formlabs Form 4");
    expect(draft.displayName).toBe("Formlabs Form 4");
  });

  it("still reads the old canonicalName key, and prefers it when both are there", () => {
    expect(parseFetchDraft(JSON.stringify({ canonicalName: "Original Prusa MK4S" })).canonicalName).toBe("Original Prusa MK4S");
    expect(parseFetchDraft(JSON.stringify({ canonicalName: "A", officialName: "B" })).canonicalName).toBe("A");
    expect(parseSearchFindings(JSON.stringify({ officialName: "Bambu Lab X2D" })).canonicalName).toBe("Bambu Lab X2D");
  });

  it("treats a missing or non-string display name as none", () => {
    expect(parseFetchDraft("{}").displayName).toBe("");
    expect(parseFetchDraft(JSON.stringify({ displayName: 42 })).displayName).toBe("");
  });

  it("files the official name's quote under the name citations", () => {
    const draft = parseFetchDraft(
      JSON.stringify({ officialName: "WEN DC3401", citations: { officialName: [{ quote: "WEN DC3401 air filter", url: "https://wenproducts.com" }] } })
    );
    expect(draft.citations.name).toEqual([{ quote: "WEN DC3401 air filter", url: "https://wenproducts.com" }]);
  });
});

describe("assembling the result", () => {
  it("stores the official name and the model's display name", () => {
    const result = assemble({ officialName: "Makita 196094-2 Compact Router Plunge Base", displayName: "Makita Plunge Base" });
    expect(result.canonicalName).toBe("Makita 196094-2 Compact Router Plunge Base");
    expect(result.displayName).toBe("Makita Plunge Base");
    expect(researchResultSchema.safeParse(result).success).toBe(true);
  });

  it("keeps a part number off the display name even when the model put one there", () => {
    const result = assemble({ officialName: "Makita 196094-2 Compact Router Plunge Base", displayName: "Makita 196094-2 Plunge Base" });
    expect(result.displayName).toBe("Makita Plunge Base");
  });

  it("derives the display name from the official name when the model gave none", () => {
    expect(assemble({ officialName: "Festool 575267 Dust Extractor CT Midi Hepa" }).displayName).toBe("Festool Dust Extractor CT Midi Hepa");
  });

  it("keeps a short model name the rules allow", () => {
    expect(assemble({ officialName: "Formlabs Form 4", displayName: "Formlabs Form 4" }).displayName).toBe("Formlabs Form 4");
    expect(assemble({ officialName: "Bambu Lab X2D", displayName: "Bambu Lab X2D" }).displayName).toBe("Bambu Lab X2D");
  });

  it("falls back to the item's name when research settled on none", () => {
    const result = assemble({}, "Trotec Speedy 400");
    expect(result.canonicalName).toBe("Trotec Speedy 400");
    expect(result.displayName).toBe("Trotec Speedy 400");
  });

  it("still parses a stored row researched before the two names, and derives its display name", () => {
    const old: Record<string, unknown> = { ...assemble({ officialName: "WEN DC3401 Air Filtration System" }) };
    delete old.displayName;
    const parsed = researchResultSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(researchDisplayName(parsed.data as ResearchResult, "WEN")).toBe("WEN Air Filtration System");
  });
});

describe("a Description redo (focus-merge)", () => {
  const at = "2026-09-24T12:00:00.000Z";

  it("keeps both names while the saved name is the one researched", () => {
    const previous = { ...assemble({ officialName: "Formlabs Form 4", displayName: "Formlabs Form 4" }), researchedAs: { name: "Form 4", brand: null } };
    const next = assemble({ officialName: "Formlabs Form 4 Resin Printer", displayName: "Form 4 Printer" });
    const merged = mergeResearch({ previous, next, focus: ["description"], saved: { name: "Form 4", brand: null }, at });
    expect(merged.canonicalName).toBe("Formlabs Form 4");
    expect(merged.displayName).toBe("Formlabs Form 4");
  });

  it("takes the redo's display name after the reviewer renamed the item", () => {
    const previous = { ...assemble({ officialName: "Formlabs Form 3", displayName: "Formlabs Form 3" }), researchedAs: { name: "Form 3", brand: null } };
    const next = assemble({ officialName: "Formlabs Form 4", displayName: "Formlabs Form 4" });
    const merged = mergeResearch({ previous, next, focus: ["description"], saved: { name: "Form 4", brand: null }, at });
    expect(merged.canonicalName).toBe("Form 4");
    expect(merged.displayName).toBe("Formlabs Form 4");
  });
});
