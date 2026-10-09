import { answerDeclaresAbsence } from "./absence";
import { audienceFor, usageLocale } from "./events";
import { fromTurn, type TurnInput } from "./from-turn";
import { classifyQuestion } from "./question-kind";
import { citationRef } from "../manuals/citation-ref";
import { logManualPassages, turnUsage } from "./turn-log";

const FORM4 = "11111111-1111-4111-8111-111111111111";
const TROTEC = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const URL12 = "https://blob.example/form4.pdf#page=12";
const REF12 = citationRef(DOC, 12);

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    steps: [],
    text: "",
    lastUserText: "How do I replace the resin tank?",
    passages: new Map(),
    scopedToolIds: [],
    audience: "anonymous",
    locale: "en",
    ...overrides,
  };
}

const result = (toolName: string, output: unknown) => ({ toolResults: [{ toolName, output }] });

describe("fromTurn", () => {
  it("writes chat_turn, tool_asked and manual_cited (page 12) for a Form 4 turn that cites page 12", () => {
    const { events, gap } = fromTurn(
      turn({
        focusedToolId: FORM4,
        steps: [result("search_manual", { status: "ok", passages: [{ url: URL12 }] })],
        text: `Lift it straight up ([Resin tank (Form 4 Manual, p. 12)](${URL12})).`,
        passages: new Map([[URL12, { documentId: DOC, toolId: FORM4, page: 12, ref: REF12 }]]),
        scopedToolIds: [FORM4],
      })
    );
    expect(events.map((e) => e.kind)).toEqual(["chat_turn", "tool_asked", "manual_cited"]);
    expect(events[0]).toMatchObject({ surface: "chat", audience: "anonymous", questionKind: "operate" });
    expect(events[2]).toMatchObject({ manualDocumentId: DOC, page: 12, toolId: FORM4 });
    expect(gap).toBeNull();
  });

  it("records a citation of another machine's document as cross_tool, and none in a lab-wide comparison (amendment 2026-10-06)", () => {
    const PRUSA_DOC = "66666666-6666-4666-8666-666666666666";
    const PRUSA = "77777777-7777-4777-8777-777777777777";
    const URL25 = "https://blob.example/prusa.pdf#page=25";
    const passages = new Map([
      [URL12, { documentId: DOC, toolId: FORM4, page: 12, ref: REF12 }],
      [URL25, { documentId: PRUSA_DOC, toolId: PRUSA, page: 25, ref: citationRef(PRUSA_DOC, 25) }],
    ]);
    const text = `Lift it ([a](#cite-${REF12})) and load it ([b](#cite-${citationRef(PRUSA_DOC, 25)})).`;

    const scoped = fromTurn(turn({ focusedToolId: FORM4, text, passages, scopedToolIds: [FORM4] })).events.filter((e) => e.kind === "manual_cited");
    expect(scoped.map((e) => [e.manualDocumentId, e.source ?? null])).toEqual([
      [DOC, null],
      [PRUSA_DOC, "cross_tool"],
    ]);

    const offPage = fromTurn(turn({ text, passages, scopedToolIds: [PRUSA] })).events.filter((e) => e.kind === "manual_cited");
    expect(offPage.map((e) => e.source ?? null)).toEqual(["cross_tool", null]);

    const wide = fromTurn(turn({ text, passages, scopedToolIds: [], wideSearch: true })).events.filter((e) => e.kind === "manual_cited");
    expect(wide.map((e) => e.source ?? null)).toEqual([null, null]);
  });

  // Regression (production, 2026-09-30): the chat prompt has the model cite a
  // passage as `#cite-<ref>` and never write its URL (manual text spec
  // amendment 2026-09-28), so a recorder that matched only `](url)` counted no
  // citations at all while the chat drew them as "N MANUAL PAGES".
  it("counts a passage the answer cites by its #cite-<ref>, as the chat prompt asks", () => {
    const shopbot = "44444444-4444-4444-8444-444444444444";
    const shaper = "55555555-5555-4555-8555-555555555555";
    const turnState = {};
    logManualPassages(turnState, [
      { documentId: shopbot, toolId: TROTEC, pageStart: 74, pdfUrl: "https://blob.example/shopbot.pdf#page=74" },
      { documentId: shopbot, toolId: TROTEC, pageStart: 5, pdfUrl: "https://blob.example/shopbot.pdf#page=5" },
      { documentId: shaper, toolId: FORM4, pageStart: 14, pdfUrl: "https://blob.example/shaper.pdf#page=14" },
      { documentId: shaper, toolId: FORM4, pageStart: 30, pdfUrl: "https://blob.example/shaper.pdf#page=30" },
    ]);
    const log = turnUsage(turnState);
    const { events, gap } = fromTurn(
      turn({
        lastUserText: "I want to CNC a chair with laser-cut inlays. Can you help me plan?",
        steps: [result("search_manual", { status: "ok" })],
        text: [
          `Zero the bit first ([Zeroing (ShopBot User Guide, p. 74)](#cite-${citationRef(shopbot, 74)})).`,
          `Check the table ([Setup (ShopBot User Guide, p. 5)](#cite-${citationRef(shopbot, 5).toUpperCase()})).`,
          `Then inlay ([Offset cuts (Shaper Origin Product Manual, pp. 14–15)](#cite-${citationRef(shaper, 14)})),`,
          `again ([see above](#cite-${citationRef(shaper, 14)})).`,
          `A garbled ref is not a citation ([x](#cite-${citationRef(shaper, 31)})).`,
        ].join("\n"),
        passages: log.passages,
        scopedToolIds: log.scopedToolIds,
      })
    );
    expect(events.filter((e) => e.kind === "manual_cited").map((e) => [e.manualDocumentId, e.page])).toEqual([
      [shopbot, 74],
      [shopbot, 5],
      [shaper, 14],
    ]);
    expect(gap).toBeNull();
  });

  it("counts a passage once when the answer links it by both its ref and its URL", () => {
    const { events } = fromTurn(
      turn({
        text: `[a](#cite-${REF12}) and [b](${URL12})`,
        passages: new Map([[URL12, { documentId: DOC, toolId: FORM4, page: 12, ref: REF12 }]]),
      })
    );
    expect(events.filter((e) => e.kind === "manual_cited")).toHaveLength(1);
  });

  it("counts each tool once however many ways the turn reached it", () => {
    const { events } = fromTurn(
      turn({
        focusedToolId: FORM4,
        steps: [result("get_tool_details", { found: true, id: FORM4 }), result("get_tool_details", { found: true, id: TROTEC })],
        scopedToolIds: [FORM4],
      })
    );
    expect(events.filter((e) => e.kind === "tool_asked").map((e) => e.toolId)).toEqual([FORM4, TROTEC]);
  });

  it("counts a passage only when the answer linked to it", () => {
    const { events } = fromTurn(
      turn({
        steps: [result("search_manual", { status: "ok" })],
        text: "The manual covers it on page 12.",
        passages: new Map([[URL12, { documentId: DOC, toolId: FORM4, page: 12, ref: REF12 }]]),
      })
    );
    expect(events.some((e) => e.kind === "manual_cited")).toBe(false);
  });

  it("is a not_in_catalog gap when get_tool_details found nothing and nothing else resolved", () => {
    const { events, gap } = fromTurn(turn({ lastUserText: "Do you have a waterjet?", steps: [result("get_tool_details", { found: false })] }));
    expect(gap).toMatchObject({ kind: "not_in_catalog", question: "Do you have a waterjet?", toolId: null });
    expect(events.find((e) => e.kind === "gap")).toMatchObject({ source: "not_in_catalog" });
  });

  it("is no gap when another lookup in the turn found the tool", () => {
    const { gap } = fromTurn(turn({ steps: [result("get_tool_details", { found: false }), result("get_tool_details", { found: true, id: TROTEC })] }));
    expect(gap).toBeNull();
  });

  it("is a no_search_results gap when every search came back empty", () => {
    expect(fromTurn(turn({ steps: [result("search_tools", { count: 0 })] })).gap?.kind).toBe("no_search_results");
    expect(fromTurn(turn({ steps: [result("search_tools", { count: 0 }), result("search_tools", { count: 2 })] })).gap).toBeNull();
  });

  it("is a no_manual_passage gap when the manual had nothing and nothing was cited, on the viewed tool", () => {
    const { gap } = fromTurn(turn({ focusedToolId: FORM4, steps: [result("search_manual", { status: "no_results" })] }));
    expect(gap).toMatchObject({ kind: "no_manual_passage", toolId: FORM4 });
  });

  it("is an honest_absence gap when the answer says the lab does not have it", () => {
    expect(fromTurn(turn({ text: "Sorry — the lab doesn't have a waterjet cutter." })).gap?.kind).toBe("honest_absence");
    expect(fromTurn(turn({ text: "Wear safety glasses and you don't have to book it." })).gap).toBeNull();
  });

  it("scrubs the question before it leaves this function", () => {
    const { gap } = fromTurn(turn({ lastUserText: "I'm abc123, do you have a waterjet? casey@cornell.edu", steps: [result("get_tool_details", { found: false })] }));
    expect(gap!.question).not.toMatch(/abc123|casey@/);
  });
});

describe("classifyQuestion", () => {
  it.each([
    ["The Form 4 shows error E-302", "debug"],
    ["my print failed halfway, how do I fix it?", "debug"],
    ["I want to make a wooden box for a class project", "create"],
    ["Which machine should I use to engrave glass?", "create"],
    ["How do I change the resin tank?", "operate"],
    ["What power setting for 3mm acrylic?", "operate"],
    ["hi!", "other"],
    ["", "other"],
  ] as const)("%s → %s", (text, kind) => {
    expect(classifyQuestion(text)).toBe(kind);
  });
});

describe("answerDeclaresAbsence", () => {
  it.each([
    ["That tool isn't in the catalog.", true],
    ["The manual doesn't cover cutting glass.", true],
    ["I couldn't find any information about that.", true],
    ["Set the power to 40% and the speed to 20 mm/s.", false],
  ] as const)("%s → %s", (text, expected) => {
    expect(answerDeclaresAbsence(text)).toBe(expected);
  });
});

describe("audienceFor", () => {
  it("maps each role to its bucket and nothing else", () => {
    expect(audienceFor("anonymous")).toBe("anonymous");
    expect(audienceFor(undefined)).toBe("anonymous");
    expect(audienceFor("user")).toBe("member");
    expect(audienceFor("admin")).toBe("staff");
    expect(audienceFor("super_admin")).toBe("staff");
  });
});

describe("usageLocale", () => {
  it("keeps locale codes and drops anything else", () => {
    expect(usageLocale("pt-BR")).toBe("pt-BR");
    expect(usageLocale("en")).toBe("en");
    expect(usageLocale("casey@cornell.edu")).toBeNull();
    expect(usageLocale(42)).toBeNull();
  });
});
