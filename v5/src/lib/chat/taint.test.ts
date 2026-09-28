import { z } from "zod";
import { toAiTools } from "../capabilities/chat-adapter";
import type { Capability } from "../capabilities/types";
import { markOutsideReads, newTurnState, OUTSIDE_CONTENT_TOOLS, readsOutsideContent } from "./taint";

/**
 * Taint (assistant–GUI parity spec §8.4): a turn that called a tool returning
 * text from outside the lab's staff is marked, by the adapter as the tool
 * starts and by the route's step hook for the Gateway's own `exa_search`.
 */

const capability = (name: string): Capability => ({
  id: "t",
  promptFragment: () => "",
  tools: [{ name, description: "d", inputSchema: z.object({}), kind: "read", run: async () => "ok" }],
});

it("names the spec's outside-content tools", () => {
  for (const name of ["read_page", "exa_search", "search_manual", "list_open_tickets", "list_corrections", "list_project_queue", "list_imports"]) {
    expect(OUTSIDE_CONTENT_TOOLS).toContain(name);
  }
  expect(readsOutsideContent("find_people")).toBe(false);
});

it("marks the turn when an outside-content tool starts, and not for any other", async () => {
  const turn = newTurnState();
  const clean = toAiTools([capability("find_people")], { turn });
  await clean.find_people.execute!({}, { toolCallId: "1", messages: [] });
  expect(turn.readOutside).toBe(false);
  const reading = toAiTools([capability("list_corrections")], { turn });
  await reading.list_corrections.execute!({}, { toolCallId: "2", messages: [] });
  expect(turn.readOutside).toBe(true);
});

it("marks the turn from a finished step that called exa_search", () => {
  const turn = newTurnState();
  markOutsideReads(turn, { toolCalls: [{ toolName: "search_tools" }] });
  expect(turn.readOutside).toBe(false);
  markOutsideReads(turn, { toolCalls: [{ toolName: "exa_search" }] });
  expect(turn.readOutside).toBe(true);
  expect(() => markOutsideReads(undefined, { toolCalls: [{ toolName: "exa_search" }] })).not.toThrow();
});
