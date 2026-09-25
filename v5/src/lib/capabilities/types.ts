import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import type { MakerLabTool } from "../../components/catalog-types";
// Type-only, deliberately: `auth/identity` is `server-only`, and this module is
// imported by client components (ConfidenceStrip, IntakeList). A `import type`
// is erased at emit, so no server module reaches the browser bundle.
import type { Identity } from "../auth/identity";
import type { Permission } from "../auth/permissions";

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
 * shape of `POST /api/uploads` (`{ attachmentId, previewUrl, name, ... }`) and
 * the client-side `PendingPhoto` tracked in `ChatFab`.
 *
 * **`attachmentId` is a Postgres uuid, not a Notion handle.** Until the data
 * platform spec moved uploads to Blob (§3.3) this field was a Notion
 * `file_upload_id` and `create_tool` re-used it to attach the same photo to the
 * Notion page it created. That is no longer possible: the id now addresses an
 * `attachments` row, and a write claims it (`data/attachments.ts`) rather than
 * forwarding it to Notion.
 *
 * `dataUrl` (optional) carries the image bytes so the model can actually see
 * the picture for identification (design spec §6.1).
 */
export interface UploadedImage {
  /** `attachments.id` — the uuid returned by `POST /api/uploads`. */
  attachmentId: string;
  /** Original filename. */
  name: string;
  /** MIME type, e.g. "image/png" / "image/jpeg". */
  contentType: string;
  /** Optional data: URL (or remote URL) of the bytes so the model can see it. */
  dataUrl?: string;
}

/** Zod schema for {@link UploadedImage}. */
export const uploadedImageSchema = z.object({
  attachmentId: z.string(),
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
  /** Chat only — write data parts (e.g. the intake table) to the UI stream. */
  writer?: UIMessageStreamWriter;
  /** Chat only — photos uploaded for this turn. */
  attachments?: UploadedImage[];
  /** Response/UI locale, e.g. "en" / "es". */
  locale?: string;
  /** Catalogue id (a Postgres uuid) of the tool the user is viewing, if any. */
  focusedToolId?: string;
  /**
   * Who is making this request, resolved **server-side** from the session
   * cookie (auth spec §3.4) — or, on MCP, from a personal access token or an
   * OAuth grant (MCP access spec §3.1). Absent for scheduled callers, and that is
   * normal — every tool must still work without it.
   *
   * This is the only trustworthy source of a caller's name and email. Tool
   * *input* is written by the model from whatever the conversation contained,
   * so a client can never assert its own identity through it.
   */
  identity?: Identity;
  /**
   * Chat only, admins only — the record a curation turn is about (refresh
   * research spec §12): the tool or pending item the page shows. Set by the
   * route only for a caller who may curate it; absent otherwise.
   */
  curation?: CurationContext;
  /** Chat only — the conversation's id, recorded on the proposals it produces. */
  chatId?: string;
}

/** The record a curation turn is about, as the tools and the prompt see it (§12.1). */
export interface CurationContext {
  kind: "tool" | "pending";
  id: string;
  name: string;
  /** The record's revision when the turn began. */
  revision: string;
  /** Its current values, by proposal field. */
  fields: Record<string, unknown>;
  /** The URLs its facts came from — `read_page` may open their hosts in this turn. */
  sources: string[];
}

// ── Capability + tool shapes ───────────────────────────────────────

/**
 * Read tools answer from the catalogue; write tools record something. Over MCP
 * a write tool needs a signed-in caller whose token is not read-only (MCP
 * access spec §3.2) — and every write is a draft, a report or a proposal a
 * person acts on, except `update_ticket` (§3.3).
 */
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
  /** "write" tools reach an MCP caller only when signed in and not read-only. */
  kind: CapabilityKind;
  /**
   * Optional. When true, the tool is exposed only on the chat surface and never
   * registered over MCP. Use for chat-orchestration tools that have no meaning
   * headlessly — e.g. tools that drive interactive cards or need the turn's
   * uploaded photos (intake's `identify_tools`).
   */
  chatOnly?: boolean;
  /**
   * Optional. The counterpart of {@link chatOnly}: when true, the tool is
   * registered over MCP and never handed to the chat model. Use for a write the
   * chat reaches another way — intake's `create_tool`, which an MCP client may
   * call directly, while the chat adds equipment through `identify_tools`, the
   * background research and a human approval (spec §3.6, §5.4).
   */
  mcpOnly?: boolean;
  /**
   * Optional. The permission a caller must hold to be offered this one tool,
   * on top of its capability's {@link Capability.requiredPermission}. Enforced
   * by `capabilitiesForIdentity` (chat) and `mcpToolAllowed` (MCP) — never
   * inside `run()`.
   */
  requiredPermission?: Permission;
  /**
   * Optional. The tool needs a signed-in person even though no permission
   * names it — `list_my_reports` has nobody to report on without one. Every
   * `kind: "write"` tool is treated this way over MCP (MCP access spec §3.2).
   */
  requiresSignIn?: boolean;
  /** Pure-ish: data in, structured data out. */
  run: (input: I, ctx: CapabilityCtx) => Promise<R>;
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
  /**
   * The focused tool's **searchable** manuals with their outlines (manual text
   * spec §3.6) — loaded by the surface (the chat route reads the database), so
   * the `manuals` fragment can list their contents without a query of its own.
   */
  manualOutlines?: ManualOutlineForPrompt[];
  /** The record being curated, for the fenced "Curating" block (refresh research spec §12.1). */
  curation?: CurationContext;
}

/** One searchable manual of the focused tool, as the prompt lists it. */
export interface ManualOutlineForPrompt {
  title: string;
  pageCount: number | null;
  /** The stored PDF's public URL; null for a staff-only file. */
  pdfUrl: string | null;
  outline: { title: string; page: number; level: number }[];
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
  /**
   * Optional. The permission a caller must hold to use this capability on a
   * session surface (chat). Absent means everyone, anonymous visitors included.
   * Enforced once, by `capabilitiesForIdentity` in `access.ts` — never inside a
   * tool's `run()`.
   *
   * A permission rather than a role since Phase 4 (spec §3.5): the same
   * declaration gates the routes, the admin plugin and the chat, so a change to
   * who may add equipment is one line in `auth/permissions.ts`.
   */
  requiredPermission?: Permission;
  /**
   * Optional. Used in place of {@link promptFragment} when the caller does not
   * hold {@link requiredPermission}, so the assistant can explain the limit
   * instead of improvising around tools it cannot see.
   */
  lockedPromptFragment?: (env: PromptEnv) => string;
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
 * evidence; `ConfidenceStrip` localizes its own copy from {@link IntakeEvidence}.
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

// ── ToolCandidate (design spec §4.2) ───────────────────────────────

/**
 * A normalized, researched equipment listing, written by `create_tool` over MCP
 * as a Postgres draft. Exactly the shape in design spec §4.2.
 *
 * The chat no longer builds one: since Phase 6 of the data platform spec it
 * identifies items into `pending_tools` rows and research runs in the
 * background (§5.4), so this shape is what an MCP client sends.
 */
export interface ToolCandidate {
  /** The display name: short, no part numbers, ≤ 40 (tool display names spec §5.6). */
  name: string;
  /** The full product name with model or part number. Optional. */
  official_name?: string;
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
  /**
   * `attachments.id`s from `POST /api/uploads`, one per photo of this item.
   *
   * The field keeps its name because it is part of the candidate shape, but
   * the values are Postgres uuids, not Notion `file_upload_id`s. `create_tool`
   * runs over MCP, which carries no uploads and no session to have made them,
   * so it never claims these: any it is given come back as a warning that the
   * photos were not attached (see `intake.ts`). Photos reach a tool through
   * the chat's `identify_tools` and the approval that follows.
   */
  image_upload_ids: string[];
  /** Provenance: URLs the agent read. */
  source_urls: string[];
  /** Catalog match, if any (drives the card's "Already in catalog" state). */
  duplicate_of?: { id: string; name: string } | null;
  /**
   * The specific variants research could not choose between, e.g.
   * `["Prusa MK4", "Prusa MK4S"]`. Only meaningful at `medium` — it turns the
   * card's primary action into picking one, so the ambiguity is resolved by the
   * person rather than silently by the model (confidence spec §3.2, §6).
   */
  variants?: string[];
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
  name: z
    .string()
    .describe(
      "The short display name people say — brand and what it is, or the model people know (\"Makita Plunge Base\", \"Formlabs Form 4\"): at most 40 characters, no part numbers."
    ),
  official_name: z
    .string()
    .max(200)
    .optional()
    .describe("The full product name with its model or part number, as the manufacturer writes it."),
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
  training_required: z
    .boolean()
    .optional()
    .describe("Whether the lab requires training before use. Leave it out unless lab staff said so: the draft is then marked as requiring training until staff decide."),
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
  variants: z.array(z.string()).optional(),
  evidence: intakeEvidenceSchema.optional(),
  confidence: intakeConfidenceSchema.optional(),
});
