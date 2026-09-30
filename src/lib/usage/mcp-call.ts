import type { Role } from "../auth/roles.ts";
import { isUuid } from "../data/uuid.ts";
import { audienceFor, type UsageEvent } from "./events.ts";

/**
 * One MCP tool call → its usage events (usage insight spec §3.3): an
 * `mcp_call` naming the tool, and a `tool_asked` when the call resolved one
 * catalogue tool (`get_tool_details` found it). The caller's token, grant and
 * user are never read — only the role, for the audience bucket. Pure.
 */
export function mcpCallUsage(toolName: string, result: unknown, role: Role | null | undefined): UsageEvent[] {
  const base = { surface: "mcp" as const, audience: audienceFor(role) };
  const events: UsageEvent[] = [{ ...base, kind: "mcp_call", source: toolName }];
  const output = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  if (toolName === "get_tool_details" && output?.found === true && typeof output.id === "string" && isUuid(output.id)) {
    events.push({ ...base, kind: "tool_asked", toolId: output.id });
  }
  return events;
}
