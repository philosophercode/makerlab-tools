import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Capability, CapabilityTool } from "./types";

/**
 * MCP adapter (design spec §3.3): expose the capability registry through the
 * Model Context Protocol endpoint. Mirrors the chat adapter, but instead of AI
 * SDK tools it registers each {@link CapabilityTool} on an {@link McpServer}.
 *
 * Each tool's `run()` is wrapped in an MCP handler that returns the structured
 * result as pretty-printed JSON text, surfacing thrown errors via `isError`.
 *
 * Write gating (design spec §3.3 / §8): `kind: "write"` tools are registered
 * **only** when `opts.allowWrites` is true. The MCP route passes `true` only
 * when `MCP_TOKEN` is configured (which token-gates the whole endpoint). With no
 * token set, the MCP surface stays read-only and write tools are omitted.
 */

export interface RegisterAllOptions {
  /** Register `kind: "write"` tools. True only when MCP_TOKEN is configured. */
  allowWrites: boolean;
}

/**
 * `McpServer.registerTool` expects a `ZodRawShape` (a plain object of Zod
 * fields), not a `ZodObject`. Our capability tools carry a `z.ZodType<I>` that
 * is, in practice, always built from `z.object({...})`. Pull the underlying
 * shape back out so MCP can build its JSON-Schema, falling back to an empty
 * shape for the (degenerate) non-object case.
 */
function toRawShape(schema: CapabilityTool["inputSchema"]): z.ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return (schema as z.ZodObject<z.ZodRawShape>).shape;
  }
  return {};
}

/** Register a single capability tool on the MCP server. */
function registerTool(server: McpServer, tool: CapabilityTool<unknown, unknown>): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: toRawShape(tool.inputSchema),
    },
    async (input: unknown) => {
      try {
        const result = await tool.run(input, {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Register every tool from every capability on the MCP server, honoring the
 * write gate. `read` tools are always registered; `write` tools are registered
 * only when `opts.allowWrites` is true.
 */
export function registerAll(
  server: McpServer,
  capabilities: Capability[],
  opts: RegisterAllOptions
): void {
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      if (tool.kind === "write" && !opts.allowWrites) continue;
      registerTool(server, tool);
    }
  }
}
