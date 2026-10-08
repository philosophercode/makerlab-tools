// @vitest-environment node
import { zodSchema } from "ai";
import { capabilitiesForIdentity } from "./access";
import { toAiTools } from "./chat-adapter";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import { suggestReplies, suggestedReplies } from "./suggest-replies";
import { readsOutsideContent } from "../chat/taint";

/**
 * `suggest_replies` (assistant–GUI parity spec, amendment 2026-10-07
 * "Suggested replies"): two or three short replies the chat draws as bubbles.
 * Display only — validated by its schema, returned as shown, offered to
 * everybody in the chat, never over MCP.
 */

const parse = (replies: unknown) => suggestReplies.inputSchema.safeParse({ replies });

describe("suggest_replies' input", () => {
  it("takes two or three replies, trimmed", () => {
    const two = parse(["  Acrylic sign ", "Engraved wood"]);
    expect(two.success && two.data.replies).toEqual(["Acrylic sign", "Engraved wood"]);
    expect(parse(["Acrylic sign", "Engraved wood", "Cardboard prototype"]).success).toBe(true);
  });

  it("refuses one reply, or more than three", () => {
    expect(parse(["Acrylic sign"]).success).toBe(false);
    expect(parse([]).success).toBe(false);
    expect(parse(["A", "B", "C", "D"]).success).toBe(false);
  });

  it("refuses an empty reply and one over 40 characters", () => {
    expect(parse(["   ", "Engraved wood"]).success).toBe(false);
    expect(parse(["x".repeat(41), "Engraved wood"]).success).toBe(false);
    expect(parse(["x".repeat(40), "Engraved wood"]).success).toBe(true);
  });

  it("refuses the same reply twice, ignoring case and spacing", () => {
    expect(parse(["Acrylic sign", "acrylic  SIGN"]).success).toBe(false);
  });

  it("refuses anything but a list of strings", () => {
    expect(parse("Acrylic sign, Engraved wood").success).toBe(false);
    expect(parse([1, 2]).success).toBe(false);
    expect(suggestReplies.inputSchema.safeParse({}).success).toBe(false);
  });

  it("tells the model its limits in the JSON Schema it is sent", async () => {
    const schema = (await zodSchema(suggestReplies.inputSchema as never).jsonSchema) as {
      properties: { replies: { minItems: number; maxItems: number; items: { minLength: number; maxLength: number } } };
    };
    expect(schema.properties.replies).toMatchObject({ minItems: 2, maxItems: 3, items: { minLength: 1, maxLength: 40 } });
  });
});

describe("suggest_replies' run", () => {
  it("returns the replies as the chat will show them, and nothing else", async () => {
    expect(await suggestReplies.run({ replies: ["Acrylic  sign", "Engraved\nwood"] }, {})).toEqual({
      ok: true,
      replies: ["Acrylic sign", "Engraved wood"],
    });
  });

  it("drops invisible characters, and offers nothing when too few are left", async () => {
    expect(await suggestReplies.run({ replies: ["Acrylic‮ sign", "​"] }, {})).toEqual({ ok: false, replies: [] });
  });

  it("writes nothing to the chat stream", async () => {
    const write = vi.fn();
    await suggestReplies.run({ replies: ["Acrylic sign", "Engraved wood"] }, { writer: { write } as never });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("who is offered suggest_replies", () => {
  it("is offered to anonymous visitors in the chat, and never over MCP", () => {
    const chatTools = toAiTools(capabilitiesForIdentity(CAPABILITIES, { role: "anonymous" }), {});
    expect(Object.keys(chatTools)).toContain("suggest_replies");
    const mcp = mcpToolsFor(CAPABILITIES, { identity: { role: "super_admin" } as never, readOnly: false });
    expect(mcp.map(({ tool }) => tool.name)).not.toContain("suggest_replies");
  });

  it("is a read that does not taint the turn", () => {
    expect(suggestReplies.kind).toBe("read");
    expect(suggestReplies.chatOnly).toBe(true);
    expect(readsOutsideContent("suggest_replies")).toBe(false);
  });

  it("asks for it sparingly, for two or three easy choices, and never about safety", () => {
    const prompt = suggestedReplies.promptFragment({ tools: [] });
    expect(prompt).toMatch(/^## Suggested replies/);
    expect(prompt).toMatch(/sparingly; most turns should not/);
    expect(prompt).toMatch(/two or three clear, easy options/);
    expect(prompt).toMatch(/Not for next steps, open-ended questions or factual answers/);
    expect(prompt).toMatch(/never for safety, training or permission/);
  });
});
