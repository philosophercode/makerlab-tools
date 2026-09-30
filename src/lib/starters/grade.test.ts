// @vitest-environment node
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, setLanguageModel, textModel } from "../../../test/ai/models-stub";
import { answerChecks, checkFailures, combineGrade, gradeStarterAnswer, parseJudgeVerdict, PASSING_SCORE, type JudgeVerdict } from "./grade";
import type { StarterToolCall } from "./answer";

const PASSAGE_URL = "https://blob.example/form4.pdf#page=42";
const searchCall: StarterToolCall = {
  name: "search_manual",
  input: { query: "replace the tank" },
  output: {
    status: "ok",
    passages: [{ ref: "3f2a9c10-42", citation: "Form 4 Manual, p. 42", url: PASSAGE_URL, text: "<untrusted-page>Lift the tank straight up.</untrusted-page>" }],
  },
};

const good: JudgeVerdict = { answered: true, grounded: true, specific: true, safe: true, stable: true, score: 8, reasons: [] };

function run(text: string, toolCalls: StarterToolCall[] = [searchCall], extra: { gap?: string | null; resourceUrls?: string[] } = {}) {
  return { text, toolCalls, gap: extra.gap ?? null, resourceUrls: extra.resourceUrls ?? [] };
}

afterEach(resetModelStubs);

describe("answerChecks", () => {
  it("counts a citation that is a passage the turn's search returned", () => {
    const checks = answerChecks(run("Lift it out [Replacing the tank (Form 4 Manual, p. 42)](#cite-3f2a9c10-42)."));
    expect(checks.citedPassages.map((p) => p.citation)).toEqual(["Form 4 Manual, p. 42"]);
    expect(checks.unverifiedCitations).toEqual([]);
    expect(checkFailures(checks)).toEqual([]);
  });

  it("fails a manual link no search returned — an invented page or a PDF address", () => {
    const checks = answerChecks(run("See [p. 43](#cite-3f2a9c10-43) and [the manual](https://example.com/manual.pdf)."));
    expect(checks.unverifiedCitations).toEqual(["#cite-3f2a9c10-43", "https://example.com/manual.pdf"]);
    expect(checkFailures(checks)[0]).toMatch(/not backed by a search_manual passage/);
  });

  it("lets a link to one of the tool's own listed resources through", () => {
    const checks = answerChecks(run("See the [Form 4 SOP](https://example.com/sop.pdf).", [], { resourceUrls: ["https://example.com/sop.pdf"] }));
    expect(checks.unverifiedCitations).toEqual([]);
    expect(checks.resourceLinks).toEqual(["https://example.com/sop.pdf"]);
  });

  it("fails a write or page-read stub, live state, the floor map, a gap and an empty answer", () => {
    const stubbed = answerChecks(run("Filed.", [{ name: "report_issue", input: {}, output: { stubbed: true } }]));
    expect(stubbed.stubbedCalls).toEqual(["report_issue"]);
    const live = answerChecks(run("Unit A is free.", [{ name: "get_unit_details", input: {}, output: { found: true } }]));
    expect(live.liveStateCalls).toEqual(["get_unit_details"]);
    const map = answerChecks(run("It is in [zone 4A](/map?highlight=4A).", []));
    expect(map.mapLinks).toEqual(["/map?highlight=4A"]);
    const gap = answerChecks(run("The manual doesn't cover that.", [], { gap: "honest_absence" }));
    const empty = answerChecks(run("  ", []));
    for (const checks of [stubbed, live, map, gap, empty]) expect(checkFailures(checks).length).toBeGreaterThan(0);
  });
});

describe("parseJudgeVerdict", () => {
  it("reads the JSON object, clamps the score and caps the reasons", () => {
    const verdict = parseJudgeVerdict('```json\n{"answered": true, "grounded": true, "specific": true, "safe": true, "stable": false, "score": 12.4, "reasons": ["mentions today\'s hours", 3, "a", "b", "c"]}\n```');
    expect(verdict).toEqual({ answered: true, grounded: true, specific: true, safe: true, stable: false, score: 10, reasons: ["mentions today's hours", "a", "b"] });
  });

  it("reads a missing flag as false, and no JSON or no score as unreadable", () => {
    expect(parseJudgeVerdict('{"answered": true, "score": 9}')?.grounded).toBe(false);
    expect(parseJudgeVerdict("Looks good to me!")).toBeNull();
    expect(parseJudgeVerdict('{"answered": true}')).toBeNull();
  });
});

describe("combineGrade", () => {
  const checks = answerChecks(run("Lift it [x (Form 4 Manual, p. 42)](#cite-3f2a9c10-42)."));

  it("accepts only with every property true and a passing score", () => {
    expect(combineGrade(checks, good).accepted).toBe(true);
    expect(combineGrade(checks, { ...good, score: PASSING_SCORE - 1 }).accepted).toBe(false);
    expect(combineGrade(checks, { ...good, answered: false }).failures).toContain("did not answer (deflected or said it does not know)");
  });

  it("disqualifies an unsafe or unstable answer, not a merely weak one", () => {
    expect(combineGrade(checks, { ...good, safe: false }).disqualified).toBe(true);
    expect(combineGrade(checks, { ...good, stable: false }).disqualified).toBe(true);
    expect(combineGrade(checks, { ...good, grounded: false }).disqualified).toBe(false);
  });

  it("fails an unreadable judge, and marks it worth one more try", () => {
    const grade = combineGrade(checks, null);
    expect(grade.accepted).toBe(false);
    expect(grade.retryable).toBe(true);
    expect(combineGrade(checks, { ...good, grounded: false }).retryable).toBe(false);
  });
});

describe("gradeStarterAnswer", () => {
  it("asks the starterGrade job with the question, record, passages and answer fenced as data", async () => {
    const judge = textModel(JSON.stringify(good));
    setLanguageModel("starterGrade", judge);
    const grade = await gradeStarterAnswer({
      question: "How do I replace the tank?",
      toolName: "Form 4",
      record: "**Form 4**\n- Training: Required",
      run: run("Lift it [x (Form 4 Manual, p. 42)](#cite-3f2a9c10-42)."),
    });
    expect(grade.accepted).toBe(true);
    const [call] = recordedCalls(judge);
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain("untrusted-page");
    expect(prompt).toContain("Lift the tank straight up.");
    expect(prompt).toContain("How do I replace the tank?");
    expect(call.providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
  });

  it("does not ask the judge when a check already failed the answer", async () => {
    const judge = textModel(JSON.stringify(good));
    setLanguageModel("starterGrade", judge);
    const grade = await gradeStarterAnswer({ question: "Q?", toolName: null, record: "", run: run("[p. 9](#cite-3f2a9c10-9)") });
    expect(grade.accepted).toBe(false);
    expect(grade.retryable).toBe(true);
    expect(recordedCalls(judge)).toHaveLength(0);
  });
});

describe("gaps", () => {
  it("fails an answer that declares the thing absent, but leaves an empty search to the judge", () => {
    expect(checkFailures(answerChecks(run("We don't have that.", [], { gap: "honest_absence" })))).toHaveLength(1);
    expect(checkFailures(answerChecks(run("The laser cutters can make signs.", [], { gap: "no_search_results" })))).toEqual([]);
  });
});
