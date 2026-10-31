import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { turnHasOutput, turnNeedsStatus } from "./chat-text";

function assistant(parts: unknown[]): UIMessage {
  return { id: "a1", role: "assistant", parts: parts as UIMessage["parts"] };
}

describe("turnNeedsStatus", () => {
  it("is needed before the assistant has a message", () => {
    expect(turnNeedsStatus(undefined)).toBe(true);
    expect(turnNeedsStatus({ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] })).toBe(true);
  });

  it("is needed while the message holds only parts that draw nothing", () => {
    expect(turnNeedsStatus(assistant([{ type: "data-manual-links", data: { kind: "manual-links", links: [] } }]))).toBe(true);
    expect(turnNeedsStatus(assistant([{ type: "step-start" }]))).toBe(true);
    expect(turnNeedsStatus(assistant([{ type: "text", text: "  " }]))).toBe(true);
  });

  it("is not needed while a tool's own status line runs", () => {
    expect(turnNeedsStatus(assistant([{ type: "step-start" }, { type: "tool-search_manual", state: "input-available" }]))).toBe(false);
  });

  it("comes back between steps, after a tool finished and before the answer", () => {
    expect(
      turnNeedsStatus(assistant([{ type: "tool-search_manual", state: "output-available" }, { type: "step-start" }]))
    ).toBe(true);
  });

  it("is not needed once prose is arriving, nor while suggested replies are chosen after it", () => {
    expect(turnNeedsStatus(assistant([{ type: "text", text: "The Form 4…" }]))).toBe(false);
    expect(
      turnNeedsStatus(assistant([{ type: "text", text: "Done." }, { type: "step-start" }, { type: "tool-suggest_replies", state: "input-streaming" }]))
    ).toBe(false);
  });
});

describe("turnHasOutput", () => {
  it("counts prose and tool calls, not data parts", () => {
    expect(turnHasOutput(assistant([{ type: "data-manual-links", data: {} }]))).toBe(false);
    expect(turnHasOutput(assistant([{ type: "tool-search_manual", state: "input-available" }]))).toBe(true);
    expect(turnHasOutput(assistant([{ type: "text", text: "Hi" }]))).toBe(true);
  });
});
