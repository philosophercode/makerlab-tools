// @vitest-environment node
import { STARTER_QUESTIONS_MAX } from "../starter-questions";
import { buildRefinePrompt, MAX_REFINE_ROUNDS, parseRefineAnswer, refineChips, type EvaluatedGrade } from "./refine";

type Grade = EvaluatedGrade;

const pass = (score = 9): Grade => ({ accepted: true, score, disqualified: false, failures: [] });
const fail = (score = 4, disqualified = false): Grade => ({ accepted: false, score, disqualified, failures: ["not grounded"] });
const failed = (): Grade => ({ accepted: false, score: 0, disqualified: false, failures: ["the run failed"], errored: true });

function deps(grades: Record<string, Grade>, proposals: string[][] = []) {
  const propose = vi.fn(async ({ need }: { need: number }) => (proposals.shift() ?? []).slice(0, need + 2));
  const evaluate = vi.fn(async (question: string) => {
    const grade = grades[question];
    if (!grade) throw new Error(`unexpected question ${question}`);
    if (grade.errored) throw new Error("gateway down");
    return grade;
  });
  return { evaluate, propose, failedGrade: () => failed() };
}

describe("refineChips", () => {
  it("keeps the originals and writes nothing when every one is accepted", async () => {
    const d = deps({ "A?": pass(), "B?": pass(), "C?": pass() });
    const outcome = await refineChips(["A?", "B?", "C?"], d);
    expect(outcome.questions).toEqual(["A?", "B?", "C?"]);
    expect(outcome.changed).toBe(false);
    expect(outcome.rounds).toBe(0);
    expect(d.propose).not.toHaveBeenCalled();
  });

  it("replaces a weak question with an accepted one, originals keeping their place", async () => {
    const d = deps({ "A?": pass(), "B?": fail(), "C?": pass(), "D?": pass() }, [["D?"]]);
    const outcome = await refineChips(["A?", "B?", "C?"], d);
    expect(outcome.questions).toEqual(["A?", "C?", "D?"]);
    expect(outcome.changed).toBe(true);
    expect(d.propose).toHaveBeenCalledWith(expect.objectContaining({ need: 1, round: 1 }));
  });

  it(`stops after ${MAX_REFINE_ROUNDS} rounds, and tops up with the best harmless original`, async () => {
    const d = deps({ "A?": pass(), "B?": fail(5), "C?": fail(6), "X?": fail(), "Y?": fail(), "Z?": fail() }, [["X?", "Y?"], ["Z?"], ["never?"]]);
    const outcome = await refineChips(["A?", "B?", "C?"], d);
    expect(outcome.rounds).toBe(MAX_REFINE_ROUNDS);
    expect(d.propose).toHaveBeenCalledTimes(MAX_REFINE_ROUNDS);
    expect(outcome.questions).toHaveLength(STARTER_QUESTIONS_MAX);
    expect(outcome.questions).toEqual(["A?", "B?", "C?"]);
    expect(outcome.evaluated.map((e) => e.question)).not.toContain("never?");
  });

  it("never keeps a disqualified question, even as a live chip", async () => {
    const d = deps({ "A?": pass(), "Hours?": fail(8, true), "C?": pass() }, [[], []]);
    const outcome = await refineChips(["A?", "Hours?", "C?"], d);
    expect(outcome.questions).toEqual(["A?", "C?"]);
  });

  it("holds an original whose run errored in place, without replacing it", async () => {
    const d = deps({ "A?": pass(), "B?": failed(), "C?": pass() });
    const outcome = await refineChips(["A?", "B?", "C?"], d);
    expect(outcome.questions).toEqual(["A?", "B?", "C?"]);
    expect(d.propose).not.toHaveBeenCalled();
  });

  it("never asks the same question twice, and never keeps more than the maximum", async () => {
    const d = deps({ "A?": fail(), "B?": fail(), "C?": fail(), "D?": pass(), "E?": pass(), "F?": pass(), "G?": pass() }, [["a?", "D?", "E?", "F?", "G?"]]);
    d.evaluate.mockImplementation(async (question: string) => ({ "D?": pass(), "E?": pass(), "F?": pass(), "G?": pass() })[question] ?? fail());
    const outcome = await refineChips(["A?", "B?", "C?"], d);
    const asked = outcome.evaluated.map((e) => e.question.toLowerCase());
    expect(new Set(asked).size).toBe(asked.length);
    expect(outcome.questions).toHaveLength(STARTER_QUESTIONS_MAX);
  });

  it("proposes without refining when told not to (rounds 0)", async () => {
    const d = deps({ "A?": fail() });
    const outcome = await refineChips(["A?"], d, { refine: false });
    expect(d.propose).not.toHaveBeenCalled();
    expect(outcome.questions).toEqual(["A?"]);
  });
});

describe("the question writer's prompt and answer", () => {
  it("fences the record and the coverage, and lists what failed and why", () => {
    const prompt = buildRefinePrompt({
      toolName: "Form 4",
      record: "Name: Form 4",
      coverage: "## Form 4 Manual\nContents: Replacing the tank (p. 42)",
      need: 2,
      kept: [{ question: "How do I start?" }],
      rejected: [{ question: "Is it free now?", failures: ["not stable"] }],
    });
    expect(prompt).toContain("Write 2 new starter question(s) for: Form 4");
    expect(prompt).toContain("Replacing the tank (p. 42)");
    expect(prompt).toContain("Is it free now? — not stable");
    expect(prompt.match(/untrusted-page/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps clean questions only, at most the number asked for", () => {
    expect(parseRefineAnswer('{"questions": ["What does the jig do?", "Wear gloves.", "What does the jig do?", "How do I clean the tank?"]}', 1)).toEqual([
      "What does the jig do?",
    ]);
    expect(parseRefineAnswer("no json", 2)).toEqual([]);
  });
});
