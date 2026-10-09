// @vitest-environment node
import type { UIMessage } from "ai";
import {
  ANONYMOUS_HISTORY_BUDGET,
  SIGNED_IN_HISTORY_BUDGET,
  boundChatHistory,
  historyBudgetFor,
} from "./bound-history";

/** Security fix 2026-10-05: one chat request's history, bounded on the server. */

let n = 0;
function text(role: UIMessage["role"], body: string): UIMessage {
  return { id: `m${n++}`, role, parts: [{ type: "text", text: body }] };
}

function photo(url: string, mediaType = "image/jpeg") {
  return { type: "file" as const, mediaType, url, filename: "p.jpg" };
}

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

function ok(result: ReturnType<typeof boundChatHistory>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe("boundChatHistory", () => {
  it("passes an ordinary conversation through untouched", () => {
    const messages = [text("user", "hi"), text("assistant", "hello"), text("user", "how do I level the bed?")];
    expect(ok(boundChatHistory(messages, ANONYMOUS_HISTORY_BUDGET))).toEqual({ ok: true, messages, dropped: 0 });
  });

  it("refuses a body that is not a list of messages", () => {
    expect(boundChatHistory(undefined, ANONYMOUS_HISTORY_BUDGET)).toEqual({ ok: false, reason: "invalid" });
    expect(boundChatHistory([{ role: "user" }], ANONYMOUS_HISTORY_BUDGET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("drops the oldest messages past the count, starting the kept history with the person", () => {
    const messages = Array.from({ length: 100 }, (_, i) => text(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    const result = ok(boundChatHistory(messages, ANONYMOUS_HISTORY_BUDGET));
    expect(result.messages.length).toBeLessThanOrEqual(ANONYMOUS_HISTORY_BUDGET.maxMessages);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(result.dropped).toBe(100 - result.messages.length);
  });

  it("drops the oldest messages past the character budget", () => {
    const big = "x".repeat(25_000);
    const messages = [text("user", big), text("assistant", big), text("user", big), text("assistant", "ok"), text("user", "and?")];
    const result = ok(boundChatHistory(messages, ANONYMOUS_HISTORY_BUDGET));
    const size = JSON.stringify(result.messages.map((m) => m.parts)).length;
    expect(size).toBeLessThanOrEqual(ANONYMOUS_HISTORY_BUDGET.maxChars + 100);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });

  it("refuses a latest message that alone is over budget, rather than cutting it", () => {
    const messages = [text("user", "x".repeat(ANONYMOUS_HISTORY_BUDGET.maxChars + 1))];
    expect(boundChatHistory(messages, ANONYMOUS_HISTORY_BUDGET)).toEqual({ ok: false, reason: "too_long" });
    expect(boundChatHistory(messages, SIGNED_IN_HISTORY_BUDGET).ok).toBe(true);
  });

  it("keeps only inline image parts: no remote URLs, no other files", () => {
    const message: UIMessage = {
      id: "u",
      role: "user",
      parts: [
        { type: "text", text: "what is this?" },
        photo(PIXEL, "image/png"),
        photo("https://example.com/huge.jpg"),
        photo("data:application/pdf;base64,JVBERi0=", "application/pdf"),
      ],
    };
    const [kept] = ok(boundChatHistory([message], ANONYMOUS_HISTORY_BUDGET)).messages;
    expect(kept.parts).toEqual([{ type: "text", text: "what is this?" }, photo(PIXEL, "image/png")]);
  });

  it("caps the photos on the latest message, and earlier ones at the browser's allowance", () => {
    const many = (count: number): UIMessage => ({
      id: `p${n++}`,
      role: "user",
      parts: [{ type: "text", text: "look" }, ...Array.from({ length: count }, () => photo(PIXEL, "image/png"))],
    });
    const result = ok(boundChatHistory([many(10), text("assistant", "ok"), many(20)], ANONYMOUS_HISTORY_BUDGET));
    const photos = (m: UIMessage) => m.parts.filter((p) => p.type === "file").length;
    expect(photos(result.messages.at(-1)!)).toBe(ANONYMOUS_HISTORY_BUDGET.maxLatestPhotos);
    expect(photos(result.messages[0])).toBe(4);
  });

  it("is tight for anonymous callers and generous once signed in", () => {
    expect(historyBudgetFor("anonymous")).toBe(ANONYMOUS_HISTORY_BUDGET);
    expect(historyBudgetFor("user")).toBe(SIGNED_IN_HISTORY_BUDGET);
    expect(historyBudgetFor("super_admin")).toBe(SIGNED_IN_HISTORY_BUDGET);
  });
});
