import {
  cleanStarterQuestions,
  STARTER_QUESTION_MAX_CHARS,
  STARTER_QUESTIONS_MAX,
  starterQuestionsFromEditor,
} from "./starter-questions";

/**
 * A tool's assistant starter questions (spec amendment "Tool-specific starter
 * questions"): the model's are read leniently, staff's are refused rather than
 * cut.
 */

describe("cleanStarterQuestions (a model's answer)", () => {
  it("keeps three trimmed questions, on one line each", () => {
    expect(
      cleanStarterQuestions(["  What resins can I print with? ", "How do I wash\n and cure a print?", "How big can a part be?"])
    ).toEqual(["What resins can I print with?", "How do I wash and cure a print?", "How big can a part be?"]);
  });

  it("caps the list at three", () => {
    const five = ["A?", "B?", "C?", "D?", "E?"];
    expect(cleanStarterQuestions(five)).toEqual(["A?", "B?", "C?"]);
    expect(STARTER_QUESTIONS_MAX).toBe(3);
  });

  it("drops empties, non-strings and repeats (ignoring case)", () => {
    expect(cleanStarterQuestions(["", "   ", 42, null, "What is it for?", "what is it FOR?", "Can I cut acrylic?"])).toEqual([
      "What is it for?",
      "Can I cut acrylic?",
    ]);
  });

  it("drops an over-long question rather than cutting it", () => {
    const long = `${"Why ".repeat(20)}?`;
    expect(long.length).toBeGreaterThan(STARTER_QUESTION_MAX_CHARS);
    expect(cleanStarterQuestions([long, "How fast does it cut?"])).toEqual(["How fast does it cut?"]);
    const exact = `${"x".repeat(STARTER_QUESTION_MAX_CHARS - 1)}?`;
    expect(cleanStarterQuestions([exact])).toEqual([exact]);
  });

  it("drops statements — a safety claim is not a question to offer", () => {
    expect(
      cleanStarterQuestions(["Always wear nitrile gloves when handling resin.", "Resin types", "What resins can I print with?"])
    ).toEqual(["What resins can I print with?"]);
  });

  it("strips list markers and quotes the model wrapped a question in", () => {
    expect(cleanStarterQuestions(["1. What is the bed size?", "- Can it print TPU?", '"How loud is it?"'])).toEqual([
      "What is the bed size?",
      "Can it print TPU?",
      "How loud is it?",
    ]);
  });

  it("reads anything that is not a list as no questions", () => {
    expect(cleanStarterQuestions(undefined)).toEqual([]);
    expect(cleanStarterQuestions("What is it?")).toEqual([]);
    expect(cleanStarterQuestions({ 0: "What is it?" })).toEqual([]);
  });
});

describe("starterQuestionsFromEditor (what staff typed)", () => {
  it("tidies the lines, drops blanks and repeats, and needs no question mark", () => {
    expect(starterQuestionsFromEditor(["  Show me the SOP ", "", "show me the sop", "What can it cut?"])).toEqual([
      "Show me the SOP",
      "What can it cut?",
    ]);
  });

  it("accepts none, which is the generic chips", () => {
    expect(starterQuestionsFromEditor([])).toEqual([]);
    expect(starterQuestionsFromEditor(["", " "])).toEqual([]);
  });

  it("refuses more than three, an over-long one, and anything that is not a list of strings", () => {
    expect(starterQuestionsFromEditor(["A?", "B?", "C?", "D?"])).toBeNull();
    expect(starterQuestionsFromEditor(["x".repeat(STARTER_QUESTION_MAX_CHARS + 1)])).toBeNull();
    expect(starterQuestionsFromEditor(["A?", 3])).toBeNull();
    expect(starterQuestionsFromEditor("A?")).toBeNull();
  });
});
