// @vitest-environment node
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Identity } from "../auth/identity";
import { toAiTools } from "./chat-adapter";
import { registerAll } from "./mcp-adapter";
import type { Capability, CapabilityCtx } from "./types";

const writeTicket = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("../admin/ticket-write", () => ({ writeTicket }));

import { staff } from "./staff";

/**
 * Which surface a tool runs on is stamped by the adapter, never inferred from
 * request data (assistant–GUI parity spec §3.2; stage 1 review). The audit
 * trail's `surface` column (phase 2) reads it, so a chat turn the client sent
 * without an `id` must still be "chat", and nothing in an MCP ctx may say
 * otherwise.
 */

const admin: Identity = { role: "admin", userId: "u-admin", email: "a@cornell.edu", name: "Niti Parikh", rateLimitKey: "u-admin" };

function recorder() {
  const seen: CapabilityCtx[] = [];
  const capability: Capability = {
    id: "probe",
    promptFragment: () => "",
    tools: [
      {
        name: "probe",
        description: "Records its ctx.",
        kind: "read",
        inputSchema: z.object({}),
        run: async (_input: unknown, ctx: CapabilityCtx) => {
          seen.push(ctx);
          return {};
        },
      },
    ],
  };
  return { seen, capability };
}

it("the chat adapter stamps \"chat\", whatever the caller's ctx says", async () => {
  const { seen, capability } = recorder();
  const tools = toAiTools([capability], { identity: admin, surface: "mcp" });
  await (tools.probe as unknown as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, { toolCallId: "1", messages: [] });
  expect(seen[0].surface).toBe("chat");
});

it("the MCP adapter stamps \"mcp\", whatever the caller's ctx says", async () => {
  const { seen, capability } = recorder();
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const server = { registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => handlers.set(name, handler) };
  registerAll(server as unknown as McpServer, [capability], { access: { identity: admin, readOnly: false }, ctx: { surface: "chat" } });
  await handlers.get("probe")!({});
  expect(seen[0].surface).toBe("mcp");
});

describe("update_ticket's surface", () => {
  const updateTicket = staff.tools.find((t) => t.name === "update_ticket")!;

  beforeEach(() => writeTicket.mockClear());

  it("is \"assistant\" in the chat even when the client sent no chat id", async () => {
    await updateTicket.run({ ticket_id: "t-1", status: "resolved" }, { identity: admin, surface: "chat" });
    expect(writeTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ surface: "assistant" }));
  });

  it("is \"mcp\" over MCP even when a chat id is present", async () => {
    await updateTicket.run({ ticket_id: "t-1", status: "resolved" }, { identity: admin, surface: "mcp", chatId: "c-1" });
    expect(writeTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ surface: "mcp" }));
  });
});
