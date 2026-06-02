import { catalog } from "./catalog";
import { units } from "./units";
import { maintenance } from "./maintenance";
import { intake } from "./intake";
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
 *  - `maintenance` — file maintenance tickets (write).
 *  - `intake`      — research / propose / create catalog listings (read+write).
 *
 * This module is the canonical import for everything in the capabilities layer:
 * the registry itself, the two adapters, and the shared contract types.
 */
export const CAPABILITIES: Capability[] = [catalog, units, maintenance, intake];

// Re-export the individual capabilities for direct/selective use and testing.
export { catalog, units, maintenance, intake };

// Re-export the surface adapters so consumers import from one place.
export {
  toAiTools,
  buildSystemPrompt,
  composeChat,
} from "./chat-adapter";
export { registerAll, type RegisterAllOptions } from "./mcp-adapter";

// Re-export the contract types most consumers need.
export type {
  Capability,
  CapabilityCtx,
  CapabilityKind,
  CapabilityTool,
  PromptEnv,
  UploadedImage,
  ToolCandidate,
  CardPayload,
  CardState,
  CardAction,
  CardResource,
  CardSpecLine,
  CardAlsoCreating,
  IdentificationCardPayload,
} from "./types";
export { uploadedImageSchema, toolCandidateSchema } from "./types";
