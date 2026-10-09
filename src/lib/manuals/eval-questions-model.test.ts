// @vitest-environment node
import { buildQuestionPrompt, chooseQuestions, parseQuestions, passageLabel } from "./eval-questions-model";
import type { PassageForQuestions } from "./eval-questions-pick";

/**
 * The model's half of eval question generation: the prompt fences each
 * passage, and only plain student questions answerable from their passage
 * survive (manual text spec amendment 2026-10-07).
 */

const passages: PassageForQuestions[] = [
  { ordinal: 3, sectionPath: ["Printing", "Changing the resin cartridge"], pageStart: 30, pageEnd: 30, content: "Open the cover. Close the valve cap…" },
  { ordinal: 7, sectionPath: ["Maintenance", "Replacing the resin tank"], pageStart: 42, pageEnd: 43, content: "Wear gloves. Lift the tank…" },
  { ordinal: 9, sectionPath: ["Maintenance", "Cleaning"], pageStart: 45, pageEnd: 45, content: "Wipe the platform…" },
];

const q = (passage: string, question: string, extra: Record<string, unknown> = {}) => ({
  passage,
  question,
  answer: "From the passage.",
  answerable_from_passage: true,
  ...extra,
});

describe("buildQuestionPrompt", () => {
  it("labels each passage P1…, fences it as data, and names its pages and section", () => {
    const prompt = buildQuestionPrompt({ toolName: "Form 4", documentTitle: "Form 4 Manual", passages, wanted: 2 });
    expect(passageLabel(0)).toBe("P1");
    expect(prompt).toContain("Machine: Form 4");
    expect(prompt).toContain("Write up to 2 questions");
    expect(prompt).toMatch(/<untrusted-page id="[0-9a-f]+" source="P2 - Maintenance \/ Replacing the resin tank - pages 42-43">/);
    expect(prompt).toContain('source="P1 - Printing / Changing the resin cartridge - page 30"');
  });
});

describe("parseQuestions", () => {
  it("keeps plain questions tied to their passage", () => {
    const parsed = parseQuestions(JSON.stringify({ questions: [q("P2", "How do I swap the resin tank?"), q("p1", "How do I put in a new cartridge?")] }), passages);
    expect(parsed.questions?.map((x) => [x.passage.ordinal, x.question])).toEqual([
      [7, "How do I swap the resin tank?"],
      [3, "How do I put in a new cartridge?"],
    ]);
    expect(parsed.rejected).toEqual([]);
  });

  it("drops page and section numbers, talk of the passage, unanswerable, unknown, repeated and second questions on one passage", () => {
    const parsed = parseQuestions(
      JSON.stringify({
        questions: [
          q("P1", "What does page 30 say about the cartridge?"),
          q("P1", "What is in section 4.2 about cartridges?"),
          q("P2", "What does the passage say about gloves?"),
          q("P2", "Why is the sky blue on the moon?", { answerable_from_passage: false }),
          q("P9", "How do I clean the tank?"),
          q("P3", "Short?"),
          q("P3", "How do I clean the platform?", { answer: "" }),
          q("P1", "How do I change the cartridge?"),
          q("P2", "how do i change the cartridge"),
          q("P1", "Do I shake a new cartridge first?"),
        ],
      }),
      passages
    );
    expect(parsed.questions?.map((x) => x.question)).toEqual(["How do I change the cartridge?"]);
    expect(parsed.rejected.map((r) => r.reason)).toEqual([
      "cites_numbers",
      "cites_numbers",
      "mentions_passage",
      "not_answerable",
      "unknown_passage",
      "length",
      "no_answer",
      "duplicate",
      "passage_used",
    ]);
  });

  it("reads JSON wrapped in prose, and says when there is none", () => {
    const wrapped = `Here you go:\n${JSON.stringify({ questions: [q("P3", "How should I clean the platform?")] })}`;
    expect(parseQuestions(wrapped, passages).questions).toHaveLength(1);
    expect(parseQuestions("I cannot help with that.", passages).questions).toBeNull();
    expect(parseQuestions(JSON.stringify({ items: [] }), passages).questions).toBeNull();
  });
});

describe("chooseQuestions", () => {
  it("prefers one per top-level section, then fills, in document order", () => {
    const parsed = parseQuestions(
      JSON.stringify({ questions: [q("P2", "How do I swap the resin tank?"), q("P3", "How should I clean the platform?"), q("P1", "How do I put in a new cartridge?")] }),
      passages
    ).questions!;
    expect(chooseQuestions(parsed, 2).map((x) => x.passage.ordinal)).toEqual([3, 7]);
    expect(chooseQuestions(parsed, 5).map((x) => x.passage.ordinal)).toEqual([3, 7, 9]);
    expect(chooseQuestions(parsed, 0)).toEqual([]);
  });
});
