import { CHAT_MAX_EXA_SEARCHES, CHAT_MAX_PAGE_READS, RESEARCH_MAX_WEB_SEARCHES } from "../intake/limits";
import { EXA_SEARCH_TOOL } from "./exa";
import { activeToolsWithinCaps, countToolCalls, type StepLike } from "./tool-caps";

/**
 * Our own per-turn caps (gateway spec §3.2, §10 "Unit": "The Exa call cap in
 * `prepareStep`, for chat (5) and research (4)").
 */

function stepWith(...toolNames: string[]): StepLike {
  return { toolCalls: toolNames.map((toolName) => ({ toolName })) };
}

function exaSteps(n: number): StepLike[] {
  return Array.from({ length: n }, () => stepWith(EXA_SEARCH_TOOL));
}

describe("countToolCalls", () => {
  it("counts calls to one tool across steps, several per step included", () => {
    const steps = [stepWith("exa_search", "read_page"), stepWith("exa_search", "exa_search"), stepWith()];
    expect(countToolCalls(steps, "exa_search")).toBe(3);
    expect(countToolCalls(steps, "read_page")).toBe(1);
    expect(countToolCalls(steps, "report_issue")).toBe(0);
  });

  it("counts provider-executed calls like any other", () => {
    const steps: StepLike[] = [
      { toolCalls: [{ toolName: "exa_search", providerExecuted: true } as { toolName: string }] },
    ];
    expect(countToolCalls(steps, "exa_search")).toBe(1);
  });

  it("falls back to the step's content parts when it carries no toolCalls", () => {
    const steps: StepLike[] = [
      {
        content: [
          { type: "tool-call", toolName: "exa_search", providerExecuted: true },
          { type: "tool-result", toolName: "exa_search" },
          { type: "text", text: "done" },
        ],
      },
    ];
    expect(countToolCalls(steps, "exa_search")).toBe(1);
  });
});

describe("activeToolsWithinCaps", () => {
  const CHAT_TOOLS = ["get_unit_details", EXA_SEARCH_TOOL, "read_page"] as const;
  const chatCaps = { [EXA_SEARCH_TOOL]: CHAT_MAX_EXA_SEARCHES, read_page: CHAT_MAX_PAGE_READS };

  it("pins chat's Exa cap at 5", () => {
    expect(CHAT_MAX_EXA_SEARCHES).toBe(5);
  });

  it("pins research's Exa budget at 4 (advisory — research/steps.ts logs an overshoot)", () => {
    expect(RESEARCH_MAX_WEB_SEARCHES).toBe(4);
  });

  it("keeps exa_search active in chat through the fourth search, and drops it after the fifth", () => {
    expect(activeToolsWithinCaps(CHAT_TOOLS, exaSteps(4), chatCaps)).toContain(EXA_SEARCH_TOOL);

    const after = activeToolsWithinCaps(CHAT_TOOLS, exaSteps(5), chatCaps);
    expect(after).not.toContain(EXA_SEARCH_TOOL);
    // Everything else stays, in order.
    expect(after).toEqual(["get_unit_details", "read_page"]);
  });

  it("counts several searches made inside one Gateway step toward the cap", () => {
    const steps = [stepWith(EXA_SEARCH_TOOL, EXA_SEARCH_TOOL, EXA_SEARCH_TOOL), stepWith(EXA_SEARCH_TOOL, EXA_SEARCH_TOOL)];
    expect(activeToolsWithinCaps(CHAT_TOOLS, steps, chatCaps)).not.toContain(EXA_SEARCH_TOOL);
  });

  it("caps each tool independently, and leaves uncapped tools alone", () => {
    const steps = Array.from({ length: 5 }, () => stepWith("read_page", "get_unit_details"));
    expect(activeToolsWithinCaps(CHAT_TOOLS, steps, chatCaps)).toEqual(["get_unit_details", EXA_SEARCH_TOOL]);
  });

  it("offers everything before the first step", () => {
    expect(activeToolsWithinCaps(CHAT_TOOLS, [], chatCaps)).toEqual([...CHAT_TOOLS]);
  });
});
