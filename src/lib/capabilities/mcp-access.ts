import type { Identity } from "../auth/identity";
import { meetsRequiredPermission } from "./access";
import type { Capability, CapabilityTool } from "./types";

/**
 * Which capability tools an MCP caller is offered (MCP access spec §3.2).
 *
 * The same declarations the chat composes from — a capability's
 * `requiredPermission`, a tool's own, both asked through `can()` — plus MCP's
 * two rules:
 *
 * 1. **A write needs a person.** Anonymous callers (and the retired shared
 *    `MCP_TOKEN`) get the public reads and nothing else: a ticket filed over
 *    MCP carries the verified name of whoever filed it, or is not filed.
 * 2. **A read-only token gets no writes**, whatever its owner's role.
 *
 * `chatOnly` tools are never offered: they depend on uploaded photos, the
 * focused page or proposal cards in the chat UI.
 *
 * A tool the caller may not use is **not listed at all**, so a model is never
 * offered a tool that will refuse. The adapter asks again on every call (§8):
 * the route builds one server per request from a freshly resolved identity, so
 * a demotion or a revoked token lands on the next request either way.
 */

export interface McpAccess {
  identity: Identity;
  readOnly: boolean;
}

/** True when `access` may list and call `tool` of `capability` over MCP. */
export function mcpToolAllowed(
  capability: Capability,
  tool: CapabilityTool<unknown, unknown>,
  access: McpAccess
): boolean {
  if (tool.chatOnly) return false;
  if (!meetsRequiredPermission(access.identity, capability.requiredPermission)) return false;
  if (!meetsRequiredPermission(access.identity, tool.requiredPermission)) return false;

  const signedIn = access.identity.role !== "anonymous" && Boolean(access.identity.userId);
  if ((tool.kind === "write" || tool.requiresSignIn) && !signedIn) return false;
  if (tool.kind === "write" && access.readOnly) return false;
  return true;
}

/** Every tool `access` may use over MCP, in registry order. */
export function mcpToolsFor(
  capabilities: Capability[],
  access: McpAccess
): { capability: Capability; tool: CapabilityTool<unknown, unknown> }[] {
  return capabilities.flatMap((capability) =>
    capability.tools
      .filter((tool) => mcpToolAllowed(capability, tool, access))
      .map((tool) => ({ capability, tool }))
  );
}
