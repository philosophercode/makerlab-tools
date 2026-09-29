import { CACHED_TURN_SOURCE, starterChipUsageEvents } from "./starter-chip";

const TOOL = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";

describe("starterChipUsageEvents", () => {
  it("is a cached chat turn plus the answer's own tool and citation events, in the clicker's audience", () => {
    const events = starterChipUsageEvents({
      question: "The printer shows an error — what should I check?",
      stored: [
        { kind: "tool_asked", toolId: TOOL, manualDocumentId: null, page: null },
        { kind: "manual_cited", toolId: TOOL, manualDocumentId: DOC, page: 42 },
      ],
      role: "user",
      locale: "en",
    });
    expect(events).toEqual([
      { kind: "chat_turn", surface: "chat", audience: "member", locale: "en", source: CACHED_TURN_SOURCE, questionKind: "debug" },
      { kind: "tool_asked", surface: "chat", audience: "member", locale: "en", toolId: TOOL },
      { kind: "manual_cited", surface: "chat", audience: "member", locale: "en", toolId: TOOL, manualDocumentId: DOC, page: 42 },
    ]);
  });

  it("drops anything stored that is not a well-formed event — never a gap", () => {
    const events = starterChipUsageEvents({
      question: "Q?",
      stored: [{ kind: "gap", toolId: TOOL }, { kind: "tool_asked", toolId: "not-a-uuid" }, { kind: "manual_cited", manualDocumentId: DOC, page: -1 }, "junk"],
      role: null,
      locale: "not a locale!",
    });
    expect(events.map((e) => e.kind)).toEqual(["chat_turn", "manual_cited"]);
    expect(events[0]).toMatchObject({ audience: "anonymous", locale: null });
    expect(events[1]).toMatchObject({ page: null, toolId: null });
  });
});
