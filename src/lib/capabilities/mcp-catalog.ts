import { z } from "zod";
import type { Identity } from "../auth/identity";
import type { Role } from "../auth/roles";
import { mcpToolAllowed } from "./mcp-access";
import type { Capability, CapabilityKind, CapabilityTool } from "./types";

/**
 * What the MCP server offers, as data for the public `/mcp` page (MCP access
 * spec, amendment 2026-09-25).
 *
 * **Generated from the registry, never hand-written.** It walks the same
 * `CAPABILITIES` array the route registers and asks the same `mcpToolAllowed`
 * the route asks, so a capability added to the registry appears on the page,
 * and a tool's audience is whatever the route would actually do.
 *
 * Pure: no database, no `server-only`. The page imports it with the registry.
 */

/** Who a tool is offered to over MCP, least-privileged first. */
export type McpAudience = "anyone" | "signed_in" | "staff";

export const MCP_AUDIENCES: McpAudience[] = ["anyone", "signed_in", "staff"];

/** One input field, summarised from the tool's input schema. */
export interface McpToolField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "object" | "unknown";
  required: boolean;
  description?: string;
  /** Allowed values, for an enum field. */
  enumValues?: string[];
}

export interface McpToolSummary {
  name: string;
  description: string;
  kind: CapabilityKind;
  audience: McpAudience;
  /** The capability it belongs to, e.g. "catalog". */
  capabilityId: string;
  fields: McpToolField[];
}

/**
 * The roles probed for a tool's audience, least-privileged first, with the
 * audience each one stands for. `super_admin` is staff too: a tool only a
 * director holds is still a staff tool.
 */
const AUDIENCE_PROBES: { role: Role; audience: McpAudience }[] = [
  { role: "anonymous", audience: "anyone" },
  { role: "user", audience: "signed_in" },
  { role: "admin", audience: "staff" },
  { role: "super_admin", audience: "staff" },
];

/** A stand-in caller holding `role` — only its role and sign-in state matter to `mcpToolAllowed`. */
export function probeIdentity(role: Role): Identity {
  if (role === "anonymous") {
    return { role, userId: null, email: null, name: null, rateLimitKey: "probe" };
  }
  return { role, userId: `probe-${role}`, email: null, name: null, rateLimitKey: "probe" };
}

/** The least-privileged audience `tool` is offered to, or null when no role reaches it. */
export function audienceOf(capability: Capability, tool: CapabilityTool<unknown, unknown>): McpAudience | null {
  for (const probe of AUDIENCE_PROBES) {
    if (mcpToolAllowed(capability, tool, { identity: probeIdentity(probe.role), readOnly: false })) {
      return probe.audience;
    }
  }
  return null;
}

/** Every tool the MCP server can offer anybody, in registry order. */
export function describeMcpTools(capabilities: Capability[]): McpToolSummary[] {
  const out: McpToolSummary[] = [];
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      const audience = audienceOf(capability, tool);
      if (!audience) continue;
      out.push({
        name: tool.name,
        description: tool.description,
        kind: tool.kind,
        audience,
        capabilityId: capability.id,
        fields: summariseInput(tool.inputSchema),
      });
    }
  }
  return out;
}

/**
 * The names of the tools `role` would be offered over MCP with a full-access
 * connection — what the page marks "You can use this".
 */
export function mcpToolNamesForRole(capabilities: Capability[], role: Role): Set<string> {
  const access = { identity: probeIdentity(role), readOnly: false };
  const names = new Set<string>();
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      if (mcpToolAllowed(capability, tool, access)) names.add(tool.name);
    }
  }
  return names;
}

/**
 * The tools the page may run: `read` tools offered to an anonymous caller.
 * Derived, so a new public read becomes runnable and a write never does.
 */
export function tryItToolNames(capabilities: Capability[]): Set<string> {
  const anonymous = { identity: probeIdentity("anonymous"), readOnly: true };
  const names = new Set<string>();
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      if (tool.kind === "read" && mcpToolAllowed(capability, tool, anonymous)) names.add(tool.name);
    }
  }
  return names;
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  anyOf?: JsonSchemaProperty[];
}

const FIELD_TYPES = new Set<McpToolField["type"]>(["string", "number", "integer", "boolean", "array", "object"]);

/** Input fields from a tool's Zod schema, through Zod's own JSON Schema output. */
export function summariseInput(schema: CapabilityTool["inputSchema"]): McpToolField[] {
  let json: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }) as typeof json;
  } catch {
    return [];
  }
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const resolved = property.anyOf?.find((option) => option.type !== "null") ?? property;
    const enumValues = resolved.enum?.filter((value): value is string => typeof value === "string");
    const rawType = Array.isArray(resolved.type) ? resolved.type.find((t) => t !== "null") : resolved.type;
    const type = rawType && FIELD_TYPES.has(rawType as McpToolField["type"]) ? (rawType as McpToolField["type"]) : "unknown";
    const description = property.description ?? resolved.description;
    return {
      name,
      type,
      required: required.has(name),
      ...(description ? { description } : {}),
      ...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
    };
  });
}
