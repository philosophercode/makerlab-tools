import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpToolAllowed, type McpAccess } from "./mcp-access";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * MCP adapter (design spec §3.3): expose the capability registry through the
 * Model Context Protocol endpoint. Mirrors the chat adapter, but instead of AI
 * SDK tools it registers each {@link CapabilityTool} on an {@link McpServer}.
 *
 * Each tool's `run()` is wrapped in an MCP handler that returns the structured
 * result as pretty-printed JSON text, surfacing thrown errors via `isError`.
 *
 * **What is registered is what the caller may use** (MCP access spec §3.2):
 * `mcpToolsFor` / `mcpToolAllowed` in `mcp-access.ts` decide from the caller's
 * identity and whether their token is read-only. The route builds one server
 * per request, so the list always reflects the identity resolved for *this*
 * request; the handler asks `mcpToolAllowed` again before running anyway,
 * because "can() decides every call, even when the tool is listed" (§8).
 */

export interface RegisterAllOptions {
  /** Who is calling, and whether their credential is read-only. */
  access: McpAccess;
  /**
   * The context every tool's `run()` receives. MCP has no stream writer and no
   * attachments; `identity` is set from {@link access} when omitted.
   */
  ctx?: CapabilityCtx;
  /**
   * Checked before every `kind: "write"` call — the per-identity write ceiling
   * (§5.2). Answers a refusal message, or null to go ahead.
   */
  beforeWrite?: (tool: CapabilityTool<unknown, unknown>) => Promise<string | null>;
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

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Register a single capability tool on the MCP server. */
function registerTool(
  server: McpServer,
  capability: Capability,
  tool: CapabilityTool<unknown, unknown>,
  opts: RegisterAllOptions,
  ctx: CapabilityCtx
): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: toRawShape(tool.inputSchema),
    },
    async (input: unknown) => {
      if (!mcpToolAllowed(capability, tool, opts.access)) {
        return errorResult("Error: your account or token is not permitted to use this tool.");
      }
      if (tool.kind === "write" && opts.beforeWrite) {
        const refusal = await opts.beforeWrite(tool);
        if (refusal) return errorResult(`Error: ${refusal}`);
      }
      try {
        const result = await tool.run(input, ctx);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Error: ${message}`);
      }
    }
  );
}

/**
 * Register every tool the caller may use, in registry order. A tool the caller
 * may not use is not registered, so `tools/list` never offers it.
 */
export function registerAll(
  server: McpServer,
  capabilities: Capability[],
  opts: RegisterAllOptions
): void {
  const ctx: CapabilityCtx = { identity: opts.access.identity, ...opts.ctx };
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      if (!mcpToolAllowed(capability, tool, opts.access)) continue;
      registerTool(server, capability, tool, opts, ctx);
    }
  }
}
