// @vitest-environment node
import type { StepLike } from "@/lib/ai/tool-caps";
import { CHAT_TOOL_CAPS, chatPrepareStep } from "./prepare-step";

/**
 * The chat's per-turn web caps (gateway spec §3.2: "A unit test pins both
 * caps"). Pure: steps in, `activeTools` out.
 */

const TOOLS = ["get_unit_details", "report_issue", "read_page", "exa_search"] as const;

/** A step in which the model called each of `names` once. */
function step(...names: string[]): StepLike {
  return { toolCalls: names.map((toolName) => ({ toolName })) };
}

function active(steps: StepLike[]): string[] {
  return chatPrepareStep(TOOLS)({ steps }).activeTools;
}

describe("chatPrepareStep", () => {
  it("pins the caps at five Exa searches, five page reads, two tickets, one row of tool cards and one illustration per turn", () => {
    expect(CHAT_TOOL_CAPS).toEqual({ exa_search: 5, read_page: 5, report_issue: 2, show_tool: 1, make_illustration: 1 });
  });

  it("withdraws show_tool and make_illustration after their one call (amendment 2026-10-07)", () => {
    const tools = ["get_tool_details", "show_tool", "make_illustration"];
    expect(chatPrepareStep(tools)({ steps: [] }).activeTools).toEqual(tools);
    expect(chatPrepareStep(tools)({ steps: [step("show_tool"), step("make_illustration")] }).activeTools).toEqual(["get_tool_details"]);
  });

  it("offers every tool before anything has been called", () => {
    expect(active([])).toEqual([...TOOLS]);
  });

  it("keeps exa_search through the fourth search and drops it at the fifth", () => {
    const four = Array.from({ length: 4 }, () => step("exa_search"));
    expect(active(four)).toContain("exa_search");
    expect(active([...four, step("exa_search")])).toEqual(["get_unit_details", "report_issue", "read_page"]);
  });

  it("counts several Exa searches the Gateway ran inside one step", () => {
    // Provider-executed: one of our steps can carry more than one call.
    expect(active([step("exa_search", "exa_search", "exa_search"), step("exa_search", "exa_search")])).not.toContain(
      "exa_search"
    );
  });

  it("drops read_page at its fifth call, independently of search", () => {
    const five = Array.from({ length: 5 }, () => step("read_page"));
    expect(active(five)).toEqual(["get_unit_details", "report_issue", "exa_search"]);
  });

  it("never caps the read-only capability tools", () => {
    const busy = Array.from({ length: 9 }, () => step("get_unit_details"));
    expect(active(busy)).toEqual([...TOOLS]);
  });

  it("drops report_issue once two tickets were filed this turn (security fix 2026-10-05)", () => {
    expect(active([step("report_issue")])).toContain("report_issue");
    expect(active([step("report_issue"), step("report_issue")])).toEqual(["get_unit_details", "read_page", "exa_search"]);
  });

  it("drops both web tools once both are spent, keeping the order of the rest", () => {
    const spent = Array.from({ length: 5 }, () => step("exa_search", "read_page"));
    expect(active(spent)).toEqual(["get_unit_details", "report_issue"]);
  });
});
