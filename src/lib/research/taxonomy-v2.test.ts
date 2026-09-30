import type { CategoryOption } from "../data/taxonomy";
import { categoryProposalOf, initialDraft, toFields } from "../intake/approval-draft";
import { assembleResearchResult } from "./assemble";
import { parseFetchDraft, parseSearchFindings } from "./model-output";
import { buildReadPrompt, categoryBlock, researchSystemPrompt } from "./prompt";
import { parseResearchResult, type ResearchResult } from "./result";
import { matchCategory } from "./taxonomy-match";

/**
 * Research decides the category (taxonomy v2 spec §4.2–§4.4): the prompt lists
 * every category as `slug — Parent › Name: description`, the answer is one
 * required slug plus an optional proposal, matching is by exact slug, and a
 * proposal never becomes a category on its own.
 */

const CATEGORIES: CategoryOption[] = [
  { id: "c-power", name: "Power Tools", group: null, slug: "power-tools", description: "Motor-driven tools." },
  { id: "c-sanders", name: "Sanders", group: "Power Tools", slug: "sanders", description: "Orbital and belt sanders. Not sanding sheets." },
  { id: "c-saws", name: "Hand Saws", group: "Hand Tools", slug: "hand-saws", description: null },
];

describe("the prompt", () => {
  it("lists every category, uncapped, as slug — Parent › Name: description", () => {
    const many: CategoryOption[] = Array.from({ length: 120 }, (_, n) => ({ id: `c${n}`, name: `Cat ${n}`, group: null, slug: `cat-${n}`, description: null }));
    const block = categoryBlock(many);
    expect(block).toContain("- cat-0 — Cat 0");
    expect(block).toContain("- cat-119 — Cat 119");
    expect(categoryBlock(CATEGORIES)).toContain("- sanders — Power Tools › Sanders: Orbital and belt sanders. Not sanding sheets.");
  });

  it("asks for one slug always and a proposal only when none fits", () => {
    expect(researchSystemPrompt("search")).toMatch(/exactly one slug/);
    const system = researchSystemPrompt("read");
    expect(system).toMatch(/exactly one slug/);
    expect(system).toMatch(/categoryProposal/);
    expect(system).toMatch(/never invent a slug/);
    const read = buildReadPrompt({ name: "Multi-tool", brand: null, categoryHint: null, locationHint: null }, parseSearchFindings("{}"), { pages: [], pdfs: [], failures: [] }, CATEGORIES);
    expect(read).toContain("- hand-saws — Hand Tools › Hand Saws");
  });
});

describe("parsing the answer", () => {
  it("reads a slug, its confidence and a proposal, leniently", () => {
    const draft = parseFetchDraft(
      JSON.stringify({
        category: { slug: " Sanders ", confidence: "HIGH" },
        categoryProposal: { name: "Oscillating Tools", parentSlug: "Power-Tools", description: "Multi-tools.", reason: "No fit." },
      })
    );
    expect(draft.category).toEqual({ name: "", group: null, slug: "sanders", confidence: "high" });
    expect(draft.categoryProposal).toEqual({ name: "Oscillating Tools", parentSlug: "power-tools", description: "Multi-tools.", reason: "No fit." });
  });

  it("drops a confidence it does not know and a proposal with no name", () => {
    const draft = parseFetchDraft(JSON.stringify({ category: { slug: "sanders", confidence: "certain" }, categoryProposal: { reason: "x" } }));
    expect(draft.category).toEqual({ name: "", group: null, slug: "sanders" });
    expect(draft.categoryProposal).toBeNull();
    expect(parseFetchDraft("{}").categoryProposal).toBeNull();
  });
});

describe("matchCategory", () => {
  it("matches an exact slug, answering the stored name and heading", () => {
    expect(matchCategory({ name: "", group: null, slug: "SANDERS" }, CATEGORIES)).toEqual({ name: "Sanders", group: "Power Tools", existingId: "c-sanders", slug: "sanders" });
  });

  it("never guesses: an unknown slug is no match, even when a name would fit", () => {
    expect(matchCategory({ name: "Sanders", group: "Power Tools", slug: "sander" }, CATEGORIES)).toEqual({ name: "Sanders", group: "Power Tools", existingId: null, slug: "sander" });
  });

  it("still reads a pre-v2 answer by name", () => {
    expect(matchCategory({ name: "hand saws", group: null }, CATEGORIES)).toMatchObject({ existingId: "c-saws" });
  });
});

/** A stored result with `category` as given. */
function result(category: ResearchResult["category"]): ResearchResult {
  const base = assembleResearchResult({
    draft: { ...parseFetchDraft("{}"), canonicalName: "Multi-Tool X" },
    verified: [],
    dropped: [],
    categories: CATEGORIES,
    fallbackName: "Multi-Tool X",
  });
  return { ...base, category };
}

describe("assembly and approval", () => {
  it("stores the matched slug, confidence and proposal, and a stored result still parses", () => {
    const assembled = assembleResearchResult({
      draft: parseFetchDraft(
        JSON.stringify({
          officialName: "Multi-Tool X",
          category: { slug: "sanders", confidence: "low" },
          categoryProposal: { name: "Oscillating Tools", parentSlug: "power-tools", description: "Multi-tools.", reason: "No fit." },
        })
      ),
      verified: [],
      dropped: [],
      categories: CATEGORIES,
      fallbackName: "Multi-Tool X",
    });
    expect(assembled.category).toEqual({
      name: "Sanders",
      group: "Power Tools",
      existingId: "c-sanders",
      slug: "sanders",
      confidence: "low",
      proposal: { name: "Oscillating Tools", parentSlug: "power-tools", description: "Multi-tools.", reason: "No fit." },
    });
    expect(parseResearchResult(JSON.parse(JSON.stringify(assembled)))?.category.slug).toBe("sanders");
    // A row researched before v2 (no slug) still parses.
    expect(parseResearchResult({ ...assembled, category: { name: "FDM", group: "3D Printing", existingId: null } })).not.toBeNull();
  });

  it("preselects the matched category and ticks the proposal; approval sends the proposal, never a new category", () => {
    const research = result({
      name: "Sanders",
      group: "Power Tools",
      existingId: "c-sanders",
      slug: "sanders",
      proposal: { name: "Oscillating Tools", parentSlug: "power-tools", description: null, reason: "No fit." },
    });
    const draft = initialDraft({ name: "Multi-Tool X", locationHint: null, serialNumber: null }, research, CATEGORIES, []);
    expect(draft.category).toBe("c-sanders");
    expect(draft.proposeCategory).toBe(true);
    const fields = toFields(draft, research, { choice: "none" });
    expect(fields.categoryId).toBe("c-sanders");
    expect(fields.categoryProposal).toEqual({ name: "Oscillating Tools", parentSlug: "power-tools", description: null, reason: "No fit." });
    expect(fields).not.toHaveProperty("newCategory");
    // Unticked, nothing is proposed.
    expect(toFields({ ...draft, proposeCategory: false }, research, { choice: "none" }).categoryProposal).toBeNull();
  });

  it("proposes nothing for an unknown slug with no proposal (the reviewer chooses)", () => {
    const research = result({ name: "sander", group: null, existingId: null, slug: "sander" });
    expect(categoryProposalOf(research)).toBeNull();
    const draft = initialDraft({ name: "X", locationHint: null, serialNumber: null }, research, CATEGORIES, []);
    expect(draft.category).toBe("");
    expect(draft.proposeCategory).toBe(false);
  });
});
