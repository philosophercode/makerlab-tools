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
  it("pins the caps at five Exa searches and five page reads per turn", () => {
    expect(CHAT_TOOL_CAPS).toEqual({ exa_search: 5, read_page: 5 });
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

  it("never caps the capability tools", () => {
    const busy = Array.from({ length: 9 }, () => step("get_unit_details", "report_issue"));
    expect(active(busy)).toEqual([...TOOLS]);
  });

  it("drops both web tools once both are spent, keeping the order of the rest", () => {
    const spent = Array.from({ length: 5 }, () => step("exa_search", "read_page"));
    expect(active(spent)).toEqual(["get_unit_details", "report_issue"]);
  });
});
