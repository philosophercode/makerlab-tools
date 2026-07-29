import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import type { MakerLabTool } from "../../components/catalog-types";
// Type-only, deliberately: `auth/identity` is `server-only`, and this module is
// imported by client components (ChatFab, IdentificationCard). A `import type`
// is erased at emit, so no server module reaches the browser bundle.
import type { Identity } from "../auth/identity";

/**
 * Shared contract for the capability-registry architecture (design spec §3,
 * §4.2, §5). A *capability* groups related tools plus a system-prompt fragment.
 * Each tool is defined once as plain data + a `run()` function, then exposed by
 * two thin adapters: the chat adapter (AI SDK tools) and the MCP adapter.
 *
 * This module is pure type/shape declarations and small Zod schemas. It pulls in
 * no server-only modules so it can be imported from either adapter, the
 * capabilities, or tests without side effects.
 */

// ── Uploaded images ────────────────────────────────────────────────

/**
 * A photo the user attached to the current chat turn. Mirrors the response
 * shape of `/api/upload-notion` (`{ file_upload_id, name, contentType, size }`)
 * and the client-side `PendingPhoto` tracked in `ChatFab`. The `file_upload_id`
 * is what `create_tool` re-uses to attach the same photo to the new Notion page
 * without re-uploading; `dataUrl` (optional) carries the image bytes so the
 * model can actually see the picture for identification (design spec §6.1).
 */
export interface UploadedImage {
  /** Notion file_upload id returned by `/api/upload-notion`. */
  file_upload_id: string;
  /** Original filename. */
  name: string;
  /** MIME type, e.g. "image/png" / "image/jpeg". */
  contentType: string;
  /** Optional data: URL (or remote URL) of the bytes so the model can see it. */
  dataUrl?: string;
}

/** Zod schema for {@link UploadedImage}. */
export const uploadedImageSchema = z.object({
  file_upload_id: z.string(),
  name: z.string(),
  contentType: z.string(),
  dataUrl: z.string().optional(),
});

// ── Capability context ─────────────────────────────────────────────

/**
 * Surface-agnostic services a tool's `run()` may use. The *chat* adapter
 * populates `writer` / `attachments` / `locale` / `focusedToolId`. The *MCP*
 * adapter populates only what it can (no writer, no attachments). Tools must
 * treat every field as optional and degrade gracefully when absent.
 */
export interface CapabilityCtx {
  /** Chat only — write data parts (e.g. identification cards) to the UI stream. */
  writer?: UIMessageStreamWriter;
  /** Chat only — photos uploaded for this turn. */
  attachments?: UploadedImage[];
  /** Response/UI locale, e.g. "en" / "es". */
  locale?: string;
  /** Notion page id of the tool the user is currently viewing, if any. */
  focusedToolId?: string;
  /**
   * Who is making this request, resolved **server-side** from the session
   * cookie (auth spec §3.4). Absent for MCP and scheduled callers, and that is
   * normal — every tool must still work without it.
   *
   * This is the only trustworthy source of a caller's name and email. Tool
   * *input* is written by the model from whatever the conversation contained,
   * so a client can never assert its own identity through it.
   */
  identity?: Identity;
}

// ── Capability + tool shapes ───────────────────────────────────────

/** Read tools are unrestricted; write tools are MCP-gated by `MCP_TOKEN`. */
export type CapabilityKind = "read" | "write";

/**
 * A single tool defined once as data + behavior.
 *
 * @typeParam I - validated input type (inferred from `inputSchema`).
 * @typeParam R - structured result type returned by `run()`.
 */
export interface CapabilityTool<I = unknown, R = unknown> {
  /** Stable tool name, e.g. "search_tools" | "report_issue" | "create_tool". */
  name: string;
  /** Natural-language description shown to the model / MCP client. */
  description: string;
  /** Zod schema validating the tool input. */
  inputSchema: z.ZodType<I>;
  /** "write" tools are only registered over MCP when `MCP_TOKEN` is set. */
  kind: CapabilityKind;
  /**
   * Optional. When true, the tool is exposed only on the chat surface and never
   * registered over MCP. Use for chat-orchestration tools that have no meaning
   * headlessly — e.g. tools that drive interactive cards or rely on the chat
   * model's native web tools (intake's `research_tool` / `propose_listing`).
   */
  chatOnly?: boolean;
  /** Pure-ish: data in, structured data out. */
  run: (input: I, ctx: CapabilityCtx) => Promise<R>;
  /**
   * Optional. How the chat surface renders the result as an interactive widget.
   * When present, the chat adapter emits a `data-card` part with this payload
   * after `run()` resolves, and returns a compact text result to the model.
   */
  card?: (result: R) => CardPayload;
}

/**
 * Environment passed to each capability's `promptFragment`. Carries everything
 * the system-prompt fragments need; mirrors the inputs of the current
 * `buildSystemPrompt` in the chat route (catalog list, focused tool, locale).
 */
export interface PromptEnv {
  /** The full resolved catalog the assistant can reference. */
  tools: MakerLabTool[];
  /** The tool whose detail page the user is viewing, if any. */
  focusedTool?: MakerLabTool | null;
  /** Response locale, e.g. "en". */
  locale?: string;
  /**
   * The caller, when the surface resolved one. Fragments use it to stop asking
   * for something already known — a signed-in student should not be asked their
   * name. Anything derived from it that reaches the prompt is escaped and
   * length-capped by the fragment, and an email address never goes in at all
   * (auth spec §8).
   */
  identity?: Identity;
}

/**
 * A capability: an ordered group of tools plus a shared prompt fragment.
 * The registry (`capabilities/index.ts`) exports an ordered array of these.
 */
export interface Capability {
  /** Stable id, e.g. "catalog" | "units" | "maintenance" | "intake". */
  id: string;
  /** Instructions appended to the system prompt for this capability. */
  promptFragment: (env: PromptEnv) => string;
  /** The tools this capability contributes. */
  // Heterogeneous tools live together, so the element type is intentionally loose.
  tools: CapabilityTool<unknown, unknown>[];
}

// ── Intake evidence + confidence (confidence spec §3.1) ────────────

/**
 * What the research step either found or did not find. Every field is a
 * *observation*, not a judgement: the model is reliable at reporting what it
 * read, and unreliable at grading itself. The grade is computed from these
 * fields by {@link ../capabilities/confidence.scoreConfidence}.
 */
export interface IntakeEvidence {
  /** User typed an explicit make/model, e.g. "Bambu Lab X1-Carbon". */
  userStatedModel: boolean;
  /** A model/serial plate was legible in an attached photo. */
  modelPlateRead: string | null;
  /** A manufacturer or retailer page was fetched for this exact model. */
  manufacturerPageFound: boolean;
  /** A manual PDF was located. */
  manualFound: boolean;
  /** Specs came from a fetched source rather than the model's own knowledge. */
  specsFromSource: boolean;
  /** Only the category was inferable — "some kind of 3D printer". */
  categoryOnly: boolean;
}

/** The three grades a proposal can carry (confidence spec §3.1). */
export type IntakeConfidenceLevel = "high" | "medium" | "low";

/**
 * The derived grade. **Never asked of the model** — self-reported confidence is
 * highest exactly when the model is fluently wrong, and a fetched manufacturer
 * page must not be able to talk its own score up (confidence spec §3.1, §8).
 * `basis` / `unknowns` are the English, model-facing rendering of the same
 * evidence; the card localizes its own copy from {@link IntakeEvidence}.
 */
export interface IntakeConfidence {
  level: IntakeConfidenceLevel;
  /** Human-readable: what we actually have. */
  basis: string[];
  /** What is missing, phrased as the question that would resolve it. */
  unknowns: string[];
}

/** Zod schema for {@link IntakeEvidence}. */
export const intakeEvidenceSchema: z.ZodType<IntakeEvidence> = z.object({
  userStatedModel: z.boolean(),
  modelPlateRead: z.string().nullable(),
  manufacturerPageFound: z.boolean(),
  manualFound: z.boolean(),
  specsFromSource: z.boolean(),
  categoryOnly: z.boolean(),
});

/** Zod schema for {@link IntakeConfidence}. */
export const intakeConfidenceSchema: z.ZodType<IntakeConfidence> = z.object({
  level: z.enum(["high", "medium", "low"]),
  basis: z.array(z.string()),
  unknowns: z.array(z.string()),
});

// ── Card payloads (chat widgets) ───────────────────────────────────

/** Lifecycle state of an identification card (design spec §4.1 / §6.3). */
export type CardState = "proposed" | "success" | "duplicate" | "error";

/** A single line of spec text rendered on a card (e.g. "Bed: 256mm"). */
export interface CardSpecLine {
  label: string;
  value: string;
}

/** A found manual / video / other resource surfaced on a card. */
export interface CardResource {
  title: string;
  url: string;
  type: "Manual" | "Video" | "Other";
}

/**
 * A taxonomy / unit row the create step will also create, with a flag for
 * whether it is new (gets a "(new)" badge) vs. matched to an existing record.
 */
export interface CardAlsoCreating {
  /** Human label, e.g. "Category: 3D Printing / FDM" or "Unit: Prusa #3". */
  label: string;
  /** What kind of side-entity this row represents. */
  entity: "category" | "location" | "unit" | "resource";
  /** True when this entity will be newly created in Notion. */
  isNew: boolean;
}

/** An action button rendered on a card; clicking seeds a follow-up message. */
export interface CardAction {
  /** Stable id, e.g. "confirm" | "edit" | "discard" | "add-unit" | "add-all". */
  id: string;
  /** Button label, e.g. "Looks right — add it". */
  label: string;
  /** Text seeded into the chat input / send path when clicked. */
  seedMessage: string;
  /** Visual emphasis hint for the renderer. */
  variant?: "primary" | "secondary" | "danger";
}

/**
 * The identification card (design spec §4.1, §6.3). One card per candidate;
 * `candidateId` lets confirm/edit/discard target the right item in a batch.
 */
export interface IdentificationCardPayload {
  kind: "identification";
  /** Correlates the card with a ToolCandidate for confirm/edit/discard. */
  candidateId: string;
  /** Card lifecycle state. */
  state: CardState;
  /** Proposed (or saved) tool name. */
  name: string;
  /** One or more photo URLs to show on the card. */
  photoUrls: string[];
  /** Resolved category label, e.g. "3D Printing / FDM". */
  category?: string;
  /** Resolved location label, e.g. "Main Lab / Print Zone". */
  location?: string;
  /** Spec lines (materials, build volume, power, etc.). */
  specLines: CardSpecLine[];
  /** Manuals / videos / other resources found during research. */
  foundResources: CardResource[];
  /** Side-entities the create step will also create, with `(new)` flags. */
  alsoCreating: CardAlsoCreating[];
  /** Action buttons (confirm / edit / discard / add-unit / add-all). */
  actions: CardAction[];
  /** Derived grade for this proposal — drives the confidence strip's heading. */
  confidence?: IntakeConfidence;
  /**
   * The evidence the grade was computed from. The card renders its own
   * localized basis / unknown lines from this rather than from
   * `confidence.basis`, which is English (confidence spec §6).
   */
  evidence?: IntakeEvidence;
  /** Provenance: the URLs the agent read, rendered as links. */
  sourceUrls?: string[];
  /** Populated on `state: "success"` — link to the created draft page. */
  draftUrl?: string;
  /** Populated on `state: "duplicate"` — the existing catalog match. */
  duplicateOf?: { id: string; name: string };
}

/**
 * Discriminated union of every card payload the chat can render. New card kinds
 * (future capabilities) extend this union; renderers switch on `kind`.
 */
export type CardPayload = IdentificationCardPayload;

// ── ToolCandidate (design spec §4.2) ───────────────────────────────

/**
 * A normalized, researched equipment listing produced by `research_tool`,
 * shown by `propose_listing`, and written by `create_tool`. Exactly the shape
 * in design spec §4.2.
 */
export interface ToolCandidate {
  name: string;
  description: string;
  category?: { name: string; group: string; isNew: boolean };
  location?: { room: string; zone: string; isNew: boolean };
  materials: string[];
  ppe_required: string[];
  tags: string[];
  training_required?: boolean;
  use_restrictions?: string;
  units: { label: string; status?: string; condition?: string; serial?: string }[];
  resources: { title: string; url: string; type: "Manual" | "Video" | "Other" }[];
  /** Notion file_upload ids from `/api/upload-notion`. */
  image_upload_ids: string[];
  /** Provenance: URLs the agent read. */
  source_urls: string[];
  /** Catalog match, if any (drives the "add a unit instead" path). */
  duplicate_of?: { id: string; name: string } | null;
  /**
   * What research found — reported by the model, which is what it is good at.
   * Optional on the wire: an omitted field is treated as "not found", which
   * grades *down*, so under-reporting can only produce a question.
   */
  evidence?: IntakeEvidence;
  /**
   * Derived from {@link evidence} in code. Never taken from model input — the
   * intake tools recompute it on every call, so nothing the model (or a page it
   * read) says can raise the grade.
   */
  confidence?: IntakeConfidence;
}

/** Zod schema for {@link ToolCandidate}, for tool input validation. */
export const toolCandidateSchema: z.ZodType<ToolCandidate> = z.object({
  name: z.string(),
  description: z.string(),
  category: z
    .object({ name: z.string(), group: z.string(), isNew: z.boolean() })
    .optional(),
  location: z
    .object({ room: z.string(), zone: z.string(), isNew: z.boolean() })
    .optional(),
  materials: z.array(z.string()),
  ppe_required: z.array(z.string()),
  tags: z.array(z.string()),
  training_required: z.boolean().optional(),
  use_restrictions: z.string().optional(),
  units: z.array(
    z.object({
      label: z.string(),
      status: z.string().optional(),
      condition: z.string().optional(),
      serial: z.string().optional(),
    })
  ),
  resources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      type: z.enum(["Manual", "Video", "Other"]),
    })
  ),
  image_upload_ids: z.array(z.string()),
  source_urls: z.array(z.string()),
  duplicate_of: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .optional(),
  evidence: intakeEvidenceSchema.optional(),
  confidence: intakeConfidenceSchema.optional(),
});
