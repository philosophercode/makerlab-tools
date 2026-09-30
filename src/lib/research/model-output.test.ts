import {
  ModelOutputError,
  extractJsonObject,
  parseFetchDraft,
  parseSearchFindings,
} from "./model-output";

/**
 * Reading the model's answer (spec §3.7). Tolerant of the ways a model wraps
 * JSON and of lists it left out; never tolerant of an answer that is not an
 * object at all. What gets stored is checked again, strictly, in `assemble.ts`.
 */

describe("extractJsonObject", () => {
  it("reads bare JSON", () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it("reads JSON inside a code fence, after prose", () => {
    const text = 'Here is what I found:\n```json\n{"canonicalName": "Prusa MK4S"}\n```\nLet me know!';
    expect(extractJsonObject(text)).toEqual({ canonicalName: "Prusa MK4S" });
  });

  it("takes the last object — the one written after the searches ran", () => {
    const text = 'Searching for {"q": "prusa"} now.\n\n{"canonicalName": "Original Prusa MK4S"}';
    expect(extractJsonObject(text)).toEqual({ canonicalName: "Original Prusa MK4S" });
  });

  it("is not cut short by braces inside strings, or thrown by a stray one in prose", () => {
    const text = 'A { stray brace. {"description": "Uses {curly} braces and \\"quotes\\"", "n": {"x": 1}}';
    expect(extractJsonObject(text)).toEqual({
      description: 'Uses {curly} braces and "quotes"',
      n: { x: 1 },
    });
  });

  it("refuses text with no object, and an array", () => {
    expect(() => extractJsonObject("")).toThrow(ModelOutputError);
    expect(() => extractJsonObject("I could not find anything.")).toThrow(ModelOutputError);
    expect(() => extractJsonObject("[1, 2, 3]")).toThrow(ModelOutputError);
    expect(() => extractJsonObject('{"unterminated": ')).toThrow(ModelOutputError);
  });
});

describe("parseSearchFindings", () => {
  it("fills what the model left out with empty values", () => {
    expect(parseSearchFindings("{}")).toEqual({
      canonicalName: "",
      description: "",
      category: null,
      candidateLinks: [],
      sourceUrls: [],
      evidence: {},
    });
  });

  it("drops keys it does not know — a claimed confidence is never read", () => {
    const findings = parseSearchFindings(
      JSON.stringify({ canonicalName: "X", confidence: { level: "high" }, evidence: { grade: "A" } })
    );
    expect(findings).not.toHaveProperty("confidence");
    expect(findings.evidence).toEqual({});
  });

  it("normalises link types and leaves out entries that are not links", () => {
    const findings = parseSearchFindings(
      JSON.stringify({
        candidateLinks: [
          { title: "User manual (PDF)", url: "https://example.com/m.pdf", type: "PDF manual" },
          { title: "Setup", url: "https://youtu.be/abc", type: "video" },
          { title: "", url: "https://example.com/p", type: "product page" },
          { title: "No url", url: "", type: "Manual" },
          "https://example.com/bare-string",
        ],
      })
    );
    expect(findings.candidateLinks).toEqual([
      { title: "User manual (PDF)", url: "https://example.com/m.pdf", type: "Manual" },
      { title: "Setup", url: "https://youtu.be/abc", type: "Video" },
      { title: "https://example.com/p", url: "https://example.com/p", type: "Other" },
    ]);
  });

  it("shortens an over-long answer rather than refusing it", () => {
    const findings = parseSearchFindings(JSON.stringify({ description: "x".repeat(10_000) }));
    expect(findings.description).toHaveLength(4000);
  });

  it("refuses a wrongly typed field with a message naming it", () => {
    expect(() => parseSearchFindings('{"canonicalName": 42}')).toThrow(/canonicalName/);
    expect(() => parseSearchFindings('{"evidence": {"manualFound": "yes"}}')).toThrow(ModelOutputError);
  });

  it("returns plain JSON — a step's return value is persisted", () => {
    const findings = parseSearchFindings(
      JSON.stringify({ canonicalName: "X", candidateLinks: [{ title: "t", url: "https://a.b", type: "Other" }] })
    );
    expect(JSON.parse(JSON.stringify(findings))).toEqual(findings);
  });
});

describe("parseFetchDraft", () => {
  it("reads a full draft and drops half-filled spec rows", () => {
    const draft = parseFetchDraft(
      JSON.stringify({
        canonicalName: "Original Prusa MK4S",
        description: "An FDM printer.",
        specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }, { label: "Nozzle" }],
        materials: ["PLA"],
        ppeRequired: [],
        tags: ["FDM"],
        trainingRequired: true,
        useRestrictions: null,
        category: { name: "FDM", group: "3D Printing" },
        resources: [{ title: "Manual", url: "https://prusa3d.com/manual.pdf", type: "Manual" }],
        sourceUrls: ["https://prusa3d.com/mk4s"],
        evidence: { manufacturerPageFound: true },
      })
    );
    expect(draft.specs).toEqual([{ label: "Build volume", value: "250 × 210 × 220 mm" }]);
    expect(draft.category).toEqual({ name: "FDM", group: "3D Printing" });
    expect(draft.trainingRequired).toBe(true);
    expect(draft.evidence).toEqual({ manufacturerPageFound: true });
  });

  it("defaults the category group and the unknowns", () => {
    const draft = parseFetchDraft('{"category": {"name": "Resin"}}');
    expect(draft.category).toEqual({ name: "Resin", group: null });
    expect(draft.trainingRequired).toBeNull();
    expect(draft.useRestrictions).toBeNull();
  });
});

describe('parseFetchDraft — starter questions (amendment "Tool-specific starter questions")', () => {
  it("reads them leniently: trimmed, blanks, repeats and statements dropped, over-long ones dropped, three at most", () => {
    const draft = parseFetchDraft(
      JSON.stringify({
        starterQuestions: [
          "  What resins can I print with?  ",
          "",
          "what resins can I print with?",
          "Always wear gloves.",
          `${"Very long ".repeat(10)}?`,
          "How do I wash and cure a print?",
          "How big can a part be?",
          "What does the Form Wash do?",
        ],
      })
    );
    expect(draft.starterQuestions).toEqual([
      "What resins can I print with?",
      "How do I wash and cure a print?",
      "How big can a part be?",
    ]);
  });

  it("is no questions when the key is missing or not a list — never a refusal", () => {
    expect(parseFetchDraft("{}").starterQuestions).toEqual([]);
    expect(parseFetchDraft('{"starterQuestions": "What is it?"}').starterQuestions).toEqual([]);
    expect(parseFetchDraft('{"starterQuestions": [1, null, {"q": "x"}]}').starterQuestions).toEqual([]);
  });
});
