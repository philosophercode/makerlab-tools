import { skillSectionsSchema, skillSourcesSchema, SKILL_SECTION_MAX } from "./format";
import { parseSkillDraft } from "./parse";

/**
 * Reading the writer's answer (tool skills spec 2026-10-07 §5.2): one JSON
 * object, read item by item — a bad item is dropped, the rest kept — and an
 * answer with no section lists is unreadable.
 */

describe("parseSkillDraft", () => {
  it("reads every section, trims text, normalises cites and drops ids that are not source ids", () => {
    const parsed = parseSkillDraft(
      JSON.stringify({
        quickFacts: [{ text: "  An enclosed\nlaser cutter ", cites: ["m1", "M1", "T1", "made-up"] }],
        operatingProcedure: [{ text: "Load the file", cites: [] }],
        troubleshooting: [{ symptom: "No cut", check: "Focus", fix: "Refocus", cites: ["M2"] }],
        notInSources: ["Maximum thickness", "Maximum thickness", ""],
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.draft.quickFacts).toEqual([{ text: "An enclosed laser cutter", cites: ["M1", "T1"] }]);
    expect(parsed!.draft.operatingProcedure).toEqual([{ text: "Load the file", cites: [] }]);
    expect(parsed!.draft.troubleshooting).toEqual([{ symptom: "No cut", check: "Focus", fix: "Refocus", cites: ["M2"] }]);
    expect(parsed!.draft.notInSources).toEqual(["Maximum thickness"]);
    expect(parsed!.draft.safety).toEqual([]);
  });

  it("drops a malformed item and keeps the rest, cites defaulting to none", () => {
    const parsed = parseSkillDraft(
      JSON.stringify({ materials: [{ text: "" }, { text: 42 }, "Acrylic", { text: "Plywood" }, { text: "x".repeat(600) }] })
    );
    expect(parsed!.draft.materials).toEqual([{ text: "Plywood", cites: [] }]);
    expect(parsed!.malformed).toBe(4);
  });

  it("caps each list at its maximum", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `Step ${i}`, cites: ["M1"] }));
    const parsed = parseSkillDraft(JSON.stringify({ operatingProcedure: many }));
    expect(parsed!.draft.operatingProcedure).toHaveLength(SKILL_SECTION_MAX.operatingProcedure);
  });

  it("finds the object inside prose or a code fence", () => {
    const parsed = parseSkillDraft('Here is the skill:\n```json\n{"safety":[{"text":"Keep the lid closed","cites":["M1"]}]}\n```');
    expect(parsed!.draft.safety).toEqual([{ text: "Keep the lid closed", cites: ["M1"] }]);
  });

  it.each([
    ["no JSON", "I cannot write that."],
    ["an empty answer", ""],
    ["an object with no section lists", JSON.stringify({ guide: "…" })],
    ["a section that is not a list", JSON.stringify({ safety: "Keep the lid closed" })],
  ])("is unreadable for %s", (_name, text) => {
    expect(parseSkillDraft(text)).toBeNull();
  });
});

describe("the stored shapes", () => {
  it("validates stored sections and sources, and refuses anything else", () => {
    const sections = {
      format: 1,
      quickFacts: [{ text: "Category: Lasers", cites: ["T1"], origin: "lab" }],
      beforeYouStart: [],
      operatingProcedure: [],
      settingsAndLimits: [],
      materials: [],
      troubleshooting: [],
      safety: [],
      whenToGetStaff: [],
      notInSources: [],
      removed: [{ section: "safety", text: "x", reason: "uncited_claim" }],
      unknownCites: [],
    };
    expect(skillSectionsSchema.safeParse(sections).success).toBe(true);
    expect(skillSectionsSchema.safeParse({ ...sections, format: 2 }).success).toBe(false);
    expect(skillSourcesSchema.safeParse([{ id: "M1", kind: "manual", documentId: "d", title: "Manual", pageStart: 3, pageEnd: 4, section: [] }]).success).toBe(true);
    expect(skillSourcesSchema.safeParse([{ id: "M1", kind: "manual", url: "https://blob/x.pdf" }]).success).toBe(false);
  });
});
