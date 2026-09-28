import { answerDeclaresAbsence } from "./absence";
import { audienceFor, usageLocale } from "./events";
import { fromTurn, type TurnInput } from "./from-turn";
import { classifyQuestion } from "./question-kind";

const FORM4 = "11111111-1111-4111-8111-111111111111";
const TROTEC = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const URL12 = "https://blob.example/form4.pdf#page=12";

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
        passages: new Map([[URL12, { documentId: DOC, toolId: FORM4, page: 12 }]]),
        scopedToolIds: [FORM4],
      })
    );
    expect(events.map((e) => e.kind)).toEqual(["chat_turn", "tool_asked", "manual_cited"]);
    expect(events[0]).toMatchObject({ surface: "chat", audience: "anonymous", questionKind: "operate" });
    expect(events[2]).toMatchObject({ manualDocumentId: DOC, page: 12, toolId: FORM4 });
    expect(gap).toBeNull();
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
        passages: new Map([[URL12, { documentId: DOC, toolId: FORM4, page: 12 }]]),
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
