import { catalog } from "./catalog";
import { units } from "./units";
import { web } from "./web";
import { manuals } from "./manuals";
import { maintenance } from "./maintenance";
import { intake } from "./intake";
import { flags } from "./flags";
import { reports } from "./reports";
import { staff } from "./staff";
import type { Capability } from "./types";

/**
 * The capability registry (design spec §3.2). A single ordered source of truth
 * for the assistant's abilities: each {@link Capability} bundles a group of
 * tools with a system-prompt fragment. Both surfaces consume this same array —
 * the chat adapter (`toAiTools` / `buildSystemPrompt` / `composeChat`) and the
 * MCP adapter (`registerAll`) — so chat and MCP stay in lockstep.
 *
 * Order matters: it determines the order tools are registered and the order
 * each capability's prompt fragment appears in the composed system prompt.
 *  - `catalog`     — read-only discovery (list / search / details).
 *  - `units`       — per-unit status + maintenance history (read).
 *  - `web`         — `read_page` on the focused tool's resource links (chat
 *                    only), and the prompt for web search (`exa_search`,
 *                    which the chat route adds beside the registry). Placed
 *                    before intake, whose prompt limits that search.
 *  - `manuals`     — `search_manual`: hybrid search over processed manual
 *                    passages, with page citations (manual text spec §3.6);
 *                    on MCP too, public manuals only.
 *  - `maintenance` — file maintenance tickets (write).
 *  - `intake`      — `identify_tools` records equipment as pending rows (chat
 *                    only; research and approval happen off the chat), and
 *                    `create_tool` writes a draft tool (MCP only).
 *  - `flags`       — file catalog corrections (write).
 *  - `reports`     — `list_my_reports`, a signed-in caller's own reports (MCP only).
 *  - `staff`       — the intake queue, the maintenance queue and `update_ticket`,
 *                    and `propose_change` (MCP only, each gated by its own
 *                    permission — MCP access spec §3.2).
 *
 * Not every tool reaches both surfaces: `chatOnly` tools are never registered
 * over MCP, and `mcpOnly` tools are never handed to the chat model.
 *
 * This module is the canonical import for everything in the capabilities layer:
 * the registry itself, the two adapters, and the shared contract types.
 */
export const CAPABILITIES: Capability[] = [catalog, units, web, manuals, maintenance, intake, flags, reports, staff];

// Re-export the individual capabilities for direct/selective use and testing.
export { catalog, units, web, manuals, maintenance, intake, flags, reports, staff };

// Re-export the surface adapters so consumers import from one place.
export {
  toAiTools,
  buildSystemPrompt,
  composeChat,
} from "./chat-adapter";
export { registerAll, type RegisterAllOptions } from "./mcp-adapter";
export { mcpToolAllowed, mcpToolsFor, type McpAccess } from "./mcp-access";
export {
  describeMcpTools,
  mcpToolNamesForRole,
  tryItToolNames,
  type McpAudience,
  type McpToolField,
  type McpToolSummary,
} from "./mcp-catalog";

// Who may use which capability on a session surface (spec §3.5). Client
// components import `./access` directly instead, so the header never pulls the
// registry into the browser bundle.
export {
  INTAKE_PERMISSION,
  canAddEquipment,
  capabilitiesForIdentity,
  meetsRequiredPermission,
  type AccessSubject,
} from "./access";

// Re-export the contract types most consumers need.
export type {
  Capability,
  CapabilityCtx,
  CapabilityKind,
  CapabilityTool,
  PromptEnv,
  UploadedImage,
  ToolCandidate,
} from "./types";
export { uploadedImageSchema, toolCandidateSchema } from "./types";
