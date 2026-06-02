import { z } from "zod";
import { getCatalogTools } from "../catalog";
import {
  createResource,
  createTool,
  createUnit,
  findOrCreateCategory,
  findOrCreateLocation,
} from "../notion";
import type { MakerLabTool } from "../../components/catalog-types";
import { findTool } from "./helpers";
import {
  toolCandidateSchema,
  type Capability,
  type CapabilityCtx,
  type CapabilityTool,
  type CardAction,
  type CardAlsoCreating,
  type CardResource,
  type CardSpecLine,
  type IdentificationCardPayload,
  type PromptEnv,
  type ToolCandidate,
} from "./types";

/**
 * The `intake` capability (design spec §4): a low-barrier path for cataloging
 * equipment from messy multimodal input. Three tools cooperate —
 *
 *  1. `research_tool` (read)    — normalize a free-text hint / product URLs into a
 *                                 structured {@link ToolCandidate} and run a catalog
 *                                 search for duplicate detection.
 *  2. `propose_listing` (read)  — emit an identification card per candidate so the
 *                                 user can confirm before anything is written.
 *  3. `create_tool` (write)     — perform the draft-by-default Notion writes in the
 *                                 spec §5 order with partial-failure reporting.
 *
 * Web research itself is done by the provider-native `web_search` / `web_fetch`
 * tools (added by the chat adapter, not here); the prompt fragment instructs the
 * model to use them before calling `research_tool`.
 */

// ── Candidate ids ──────────────────────────────────────────────────

/**
 * Derive a stable-ish candidate id from a name. Used to correlate a card with a
 * ToolCandidate across the propose → confirm → create handshake, and to seed the
 * `confirm add: <id>` follow-up message the card's button sends.
 */
function candidateId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "candidate";
}

// ── Duplicate detection ────────────────────────────────────────────

/**
 * Keyword-match a candidate against the published catalog (mirrors the MCP
 * `search_tools` heuristic) and return the strongest match, if any. Returns null
 * on any failure so research never hard-fails on a catalog read.
 */
async function detectDuplicate(
  name: string
): Promise<{ id: string; name: string } | null> {
  let tools: MakerLabTool[];
  try {
    tools = await getCatalogTools();
  } catch {
    return null;
  }
  // Exact / partial name resolution first.
  const byName = findTool(tools, name);
  if (byName) return { id: byName.id, name: byName.name };

  // Fall back to a keyword search across searchable fields.
  const q = name.toLowerCase().trim();
  if (!q) return null;
  const match = tools.find((t) =>
    [t.name, t.description, t.shortDescription, ...t.materials, ...t.tags]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
  return match ? { id: match.id, name: match.name } : null;
}

// ── Link verification ──────────────────────────────────────────────

const VERIFY_UA = "Mozilla/5.0 (compatible; MakerLabBot/1.0)";
const VERIFY_TIMEOUT_MS = 8000;

function isYouTubeHost(host: string): boolean {
  const h = host.replace(/^www\./, "");
  return (
    h === "youtube.com" ||
    h === "m.youtube.com" ||
    h === "youtu.be" ||
    h.endsWith(".youtube.com")
  );
}

/**
 * Verify a single resource URL actually resolves to a real page/video, to catch
 * the model fabricating plausible-looking URLs (e.g. invented YouTube video ids).
 *
 * - YouTube: the oEmbed endpoint is authoritative — it returns 404 for a video
 *   id that does not exist (a normal `watch?v=` page returns HTTP 200 even for
 *   dead videos, so a status check alone is not enough).
 * - Everything else: a GET that only treats definitive "not found" signals
 *   (404/410, DNS/network failure, malformed URL) as invalid. 401/403/429/5xx
 *   are kept — they mean the resource exists but is gated or transiently
 *   erroring, and we'd rather not drop a real manual on a bot block.
 */
async function verifyUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "not an http(s) URL" };
  }

  if (isYouTubeHost(parsed.hostname)) {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) }
      );
      if (res.status === 200) return { ok: true };
      if (res.status === 404 || res.status === 401)
        return { ok: false, reason: "video does not exist" };
      return { ok: true }; // transient/unknown — don't false-drop
    } catch {
      return { ok: false, reason: "video lookup failed" };
    }
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": VERIFY_UA },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Verify every resource link, preserving order. Returns the verified resources
 * (safe to surface/write) and a human-readable note for each dropped link so the
 * agent can tell the user instead of silently omitting it.
 */
async function verifyResourceLinks(
  resources: ToolCandidate["resources"]
): Promise<{ verified: ToolCandidate["resources"]; dropped: string[] }> {
  const checked = await Promise.all(
    resources.map(async (r) => ({ resource: r, result: await verifyUrl(r.url) }))
  );
  const verified: ToolCandidate["resources"] = [];
  const dropped: string[] = [];
  for (const { resource, result } of checked) {
    if (result.ok) {
      verified.push(resource);
    } else {
      dropped.push(
        `${resource.type} "${resource.title}" (${resource.url}) — ${result.reason}`
      );
    }
  }
  return { verified, dropped };
}

// ── research_tool ──────────────────────────────────────────────────

const researchInputSchema = z.object({
  candidate: toolCandidateSchema.describe(
    "The best-effort structured candidate you assembled from the user's description, attached photos, and any web_search/web_fetch you already ran. Leave duplicate_of unset — research_tool fills it in."
  ),
});
type ResearchInput = z.infer<typeof researchInputSchema>;

interface ResearchResult {
  candidate: ToolCandidate;
  duplicate: { id: string; name: string } | null;
  /**
   * Resource links that failed verification and were removed from the candidate
   * (e.g. a fabricated YouTube URL). Tell the user these could not be verified
   * and were left out — do NOT invent replacements.
   */
  dropped_links: string[];
}

const researchTool: CapabilityTool<ResearchInput, ResearchResult> = {
  name: "research_tool",
  description:
    "Normalize a researched equipment candidate and check the catalog for duplicates. BEFORE calling this, use the native web_search / web_fetch tools (and any attached photos) to gather the canonical name, manufacturer, specs, materials, PPE, a manual PDF URL, and a setup video URL. Pass your best-effort ToolCandidate; this tool runs a catalog search on the name and returns the candidate annotated with duplicate_of when a strong existing match is found. Read-only — it writes nothing.",
  inputSchema: researchInputSchema,
  kind: "read",
  // Relies on the chat model's native web_search/web_fetch + attached photos;
  // has no meaning as a standalone headless MCP tool.
  chatOnly: true,
  run: async ({ candidate }, ctx: CapabilityCtx): Promise<ResearchResult> => {
    // Carry through any image uploads attached to this chat turn so the eventual
    // create_tool can re-attach the same photos without re-uploading.
    const attachmentIds = (ctx.attachments || []).map((a) => a.file_upload_id);
    const mergedImageIds = Array.from(
      new Set([...(candidate.image_upload_ids || []), ...attachmentIds])
    );

    const duplicate = await detectDuplicate(candidate.name);

    // Verify every resource link actually resolves, dropping fabricated or dead
    // URLs (e.g. an invented YouTube video id) so they never reach the card.
    const { verified, dropped } = await verifyResourceLinks(
      candidate.resources || []
    );

    const normalized: ToolCandidate = {
      ...candidate,
      materials: candidate.materials || [],
      ppe_required: candidate.ppe_required || [],
      tags: candidate.tags || [],
      units: candidate.units || [],
      resources: verified,
      image_upload_ids: mergedImageIds,
      source_urls: candidate.source_urls || [],
      duplicate_of: duplicate,
    };

    return { candidate: normalized, duplicate, dropped_links: dropped };
  },
};

// ── propose_listing ────────────────────────────────────────────────

const proposeInputSchema = z.object({
  candidates: z
    .array(toolCandidateSchema)
    .min(1)
    .describe(
      "One or more researched candidates to confirm with the user. Pass several at once when the user described a batch — each gets its own independently-confirmable card."
    ),
});
type ProposeInput = z.infer<typeof proposeInputSchema>;

interface ProposeResult {
  candidates: ToolCandidate[];
}

/** Build the "also creating" rows (taxonomy + units + resources) for a card. */
function buildAlsoCreating(c: ToolCandidate): CardAlsoCreating[] {
  const rows: CardAlsoCreating[] = [];
  if (c.category) {
    rows.push({
      label: `Category: ${c.category.group} / ${c.category.name}`,
      entity: "category",
      isNew: c.category.isNew,
    });
  }
  if (c.location) {
    rows.push({
      label: `Location: ${c.location.room} / ${c.location.zone}`,
      entity: "location",
      isNew: c.location.isNew,
    });
  }
  for (const unit of c.units) {
    rows.push({
      label: `Unit: ${unit.label}`,
      entity: "unit",
      isNew: true,
    });
  }
  for (const resource of c.resources) {
    rows.push({
      label: `${resource.type}: ${resource.title}`,
      entity: "resource",
      isNew: true,
    });
  }
  return rows;
}

/** Build the spec lines (materials, PPE, training, restrictions) for a card. */
function buildSpecLines(c: ToolCandidate): CardSpecLine[] {
  const lines: CardSpecLine[] = [];
  if (c.materials.length) {
    lines.push({ label: "Materials", value: c.materials.join(", ") });
  }
  if (c.ppe_required.length) {
    lines.push({ label: "PPE", value: c.ppe_required.join(", ") });
  }
  if (c.tags.length) {
    lines.push({ label: "Tags", value: c.tags.join(", ") });
  }
  if (typeof c.training_required === "boolean") {
    lines.push({
      label: "Training",
      value: c.training_required ? "Required" : "Not required",
    });
  }
  if (c.use_restrictions) {
    lines.push({ label: "Restrictions", value: c.use_restrictions });
  }
  return lines;
}

function toFoundResources(c: ToolCandidate): CardResource[] {
  return c.resources.map((r) => ({
    title: r.title,
    url: r.url,
    type: r.type,
  }));
}

/** Action buttons for a proposed (or duplicate) candidate card. */
function buildActions(c: ToolCandidate): CardAction[] {
  const id = candidateId(c.name);
  if (c.duplicate_of) {
    return [
      {
        id: "add-unit",
        label: "Add a unit to the existing tool",
        seedMessage: `add unit to existing: ${c.duplicate_of.id}`,
        variant: "primary",
      },
      {
        id: "create-anyway",
        label: "No, create a new tool",
        seedMessage: `create new tool anyway: ${id}`,
        variant: "secondary",
      },
      {
        id: "discard",
        label: "Discard",
        seedMessage: `discard: ${id}`,
        variant: "danger",
      },
    ];
  }
  return [
    {
      id: "confirm",
      label: "Looks right — add it",
      seedMessage: `confirm add: ${id}`,
      variant: "primary",
    },
    {
      id: "edit",
      label: "Edit",
      seedMessage: `edit: ${id}`,
      variant: "secondary",
    },
    {
      id: "discard",
      label: "Discard",
      seedMessage: `discard: ${id}`,
      variant: "danger",
    },
  ];
}

/** Map a single candidate to its identification card payload. */
function candidateToCard(c: ToolCandidate): IdentificationCardPayload {
  const isDuplicate = Boolean(c.duplicate_of);
  return {
    kind: "identification",
    candidateId: candidateId(c.name),
    state: isDuplicate ? "duplicate" : "proposed",
    name: c.name,
    photoUrls: [],
    category: c.category
      ? `${c.category.group} / ${c.category.name}`
      : undefined,
    location: c.location
      ? `${c.location.room} / ${c.location.zone}`
      : undefined,
    specLines: buildSpecLines(c),
    foundResources: toFoundResources(c),
    alsoCreating: buildAlsoCreating(c),
    actions: buildActions(c),
    duplicateOf: c.duplicate_of ?? undefined,
  };
}

const proposeListing: CapabilityTool<ProposeInput, ProposeResult> = {
  name: "propose_listing",
  description:
    "Show the user an identification card for each researched candidate so they can confirm before anything is written. This is the mandatory confirmation gate: ALWAYS call propose_listing and wait for an explicit user confirmation before create_tool. Pass multiple candidates to confirm a batch — each renders an independent card. When a candidate has a duplicate_of match, its card offers 'Add a unit to the existing tool' instead of creating a new tool. Read-only.",
  inputSchema: proposeInputSchema,
  kind: "read",
  // Drives interactive identification cards in the chat UI; not an MCP tool.
  chatOnly: true,
  run: async ({ candidates }): Promise<ProposeResult> => {
    return { candidates };
  },
  // The chat adapter emits one data-card per candidate; for a single result we
  // surface the first candidate's card here (the adapter handles the batch).
  card: (result: ProposeResult): IdentificationCardPayload =>
    candidateToCard(result.candidates[0]),
};

// ── create_tool ────────────────────────────────────────────────────

const createInputSchema = z.object({
  candidate: toolCandidateSchema.describe(
    "The single, user-confirmed candidate to write to Notion. Only call this AFTER propose_listing and an explicit user confirmation. For a batch, call create_tool once per confirmed candidate."
  ),
});
type CreateInput = z.infer<typeof createInputSchema>;

interface CreateResult {
  success: boolean;
  /** Notion page id of the created tool, when it landed. */
  tool_id: string | null;
  /** Notion page ids of the created units. */
  unit_ids: string[];
  /** Notion page url of the created tool draft, when it landed. */
  draft_url: string | null;
  /** The candidate name (for card rendering on partial failure). */
  name: string;
  created: {
    tool: boolean;
    category: { id: string; isNew: boolean } | null;
    location: { id: string; isNew: boolean } | null;
    units: number;
    resources: number;
  };
  /** Human-readable notes about steps that did not land (no silent failures). */
  warnings: string[];
}

/** Build a Notion page URL from a page id (dashes stripped, as Notion expects). */
function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

const createToolTool: CapabilityTool<CreateInput, CreateResult> = {
  name: "create_tool",
  description:
    "Create a draft catalog listing in Notion for a confirmed candidate: find-or-create its Category and Location, create the Tool (published=false), create each Unit linked to the tool, and create each manual/video Resource (published=false). NEVER call this without a prior propose_listing and an explicit user confirmation. Everything is created as a draft — staff publish it later in Notion. Returns the created ids and a draft link; on partial failure it reports exactly what landed so nothing is lost silently.",
  inputSchema: createInputSchema,
  kind: "write",
  run: async ({ candidate }, ctx: CapabilityCtx): Promise<CreateResult> => {
    const warnings: string[] = [];
    const created: CreateResult["created"] = {
      tool: false,
      category: null,
      location: null,
      units: 0,
      resources: 0,
    };

    // 1. Resolve / create category + location (best-effort — the tool can still
    //    be created without them; we just note it).
    let categoryId: string | null = null;
    if (candidate.category) {
      try {
        const cat = await findOrCreateCategory(
          candidate.category.name,
          candidate.category.group
        );
        categoryId = cat.id;
        created.category = cat;
      } catch (err) {
        warnings.push(
          `Could not resolve category "${candidate.category.name}": ${errMsg(err)}`
        );
      }
    }

    let locationId: string | null = null;
    if (candidate.location) {
      try {
        const loc = await findOrCreateLocation(
          candidate.location.room,
          candidate.location.zone
        );
        locationId = loc.id;
        created.location = loc;
      } catch (err) {
        warnings.push(
          `Could not resolve location "${candidate.location.room} / ${candidate.location.zone}": ${errMsg(err)}`
        );
      }
    }

    // 2. Create the tool (published=false). If this fails there is nothing to
    //    link units/resources to, so we bail with a clean failure.
    const attachmentNames = new Map(
      (ctx.attachments || []).map((a) => [a.file_upload_id, a.name])
    );
    const imageUploads = candidate.image_upload_ids.map((id) => ({
      id,
      name: attachmentNames.get(id) || "photo",
    }));

    let toolId: string;
    try {
      const toolRecord = await createTool({
        name: candidate.name,
        description: candidate.description,
        category: categoryId ? [categoryId] : undefined,
        location: locationId ? [locationId] : undefined,
        materials: candidate.materials,
        ppe_required: candidate.ppe_required,
        tags: candidate.tags,
        training_required: candidate.training_required,
        use_restrictions: candidate.use_restrictions,
        image_uploads: imageUploads.length ? imageUploads : undefined,
      });
      toolId = toolRecord.id;
      created.tool = true;
    } catch (err) {
      return {
        success: false,
        tool_id: null,
        unit_ids: [],
        draft_url: null,
        name: candidate.name,
        created,
        warnings: [...warnings, `Failed to create the tool: ${errMsg(err)}`],
      };
    }

    // 3. Create units linked to the tool (best-effort per unit).
    const unitIds: string[] = [];
    for (const unit of candidate.units) {
      try {
        const unitRecord = await createUnit({
          unit_label: unit.label,
          tool: [toolId],
          serial_number: unit.serial,
          status: unit.status as UnitStatusInput,
          condition: unit.condition as UnitConditionInput,
        });
        unitIds.push(unitRecord.id);
        created.units += 1;
      } catch (err) {
        warnings.push(`Could not create unit "${unit.label}": ${errMsg(err)}`);
      }
    }

    // 4. Create resources linked to the tool (best-effort per resource).
    //    Re-verify links here as a hard gate: even if research_tool already
    //    pruned fabricated URLs, the model could pass a fresh unverified link
    //    straight to create_tool. Dropped links are reported, never written.
    const { verified: verifiedResources, dropped: droppedResources } =
      await verifyResourceLinks(candidate.resources);
    for (const link of droppedResources) {
      warnings.push(`Skipped unverifiable link — ${link}`);
    }
    for (const resource of verifiedResources) {
      try {
        await createResource({
          title: resource.title,
          tool: [toolId],
          type: resource.type,
          url: resource.url,
        });
        created.resources += 1;
      } catch (err) {
        warnings.push(
          `Could not create resource "${resource.title}": ${errMsg(err)}`
        );
      }
    }

    return {
      success: true,
      tool_id: toolId,
      unit_ids: unitIds,
      draft_url: notionPageUrl(toolId),
      name: candidate.name,
      created,
      warnings,
    };
  },
  card: (result: CreateResult): IdentificationCardPayload => ({
    kind: "identification",
    candidateId: candidateId(result.name),
    state: "success",
    name: result.name,
    photoUrls: [],
    specLines: result.warnings.map((w) => ({ label: "Note", value: w })),
    foundResources: [],
    alsoCreating: [],
    actions: result.draft_url
      ? [
          {
            id: "open-draft",
            label: "Open draft in Notion",
            seedMessage: result.draft_url,
            variant: "secondary",
          },
        ]
      : [],
    draftUrl: result.draft_url ?? undefined,
  }),
};

// The Notion write layer narrows status/condition to its own enums; the
// candidate carries free-form strings, so we alias the accepted inputs to keep
// the call sites readable without re-importing the full union here.
type UnitStatusInput = Parameters<typeof createUnit>[0]["status"];
type UnitConditionInput = Parameters<typeof createUnit>[0]["condition"];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Prompt fragment ────────────────────────────────────────────────

function promptFragment(_env: PromptEnv): string {
  return [
    `## Adding equipment to the inventory (intake)`,
    `When someone wants to add a tool to the catalog — from a free-text description, dictated notes, attached photos, or pasted product/store/manual URLs — act as an intake agent and follow this flow.`,
    `**Keep your messages tight.** Do not narrate every \`web_fetch\`/\`web_search\` step in long paragraphs — a single short line like "Researching the Creality Ender-3 V3…" is enough while you work. Let the identification card carry the structured result; don't restate the whole card as prose. Use clean markdown (bold labels, tight bullet lists), never a wall of text.`,
    `1. **Research first.** Use the native \`web_search\` and \`web_fetch\` tools (and any attached photos) to identify the equipment: canonical name and manufacturer, a one-paragraph description, key specs, typical materials and required PPE, sensible tags, a manual PDF URL, and a setup/overview video URL. Read product pages and manuals before guessing. Track every URL you actually read so you can pass it as \`source_urls\` for provenance.`,
    `   **Never fabricate or guess a URL.** Only include a manual or video link that you actually opened with \`web_fetch\` and confirmed is the correct item — especially video URLs (never assemble a \`youtube.com/watch?v=…\` link from memory; you must have retrieved that exact video). If you can't find a real link, omit it rather than inventing one. \`research_tool\` and \`create_tool\` independently verify every link server-side (YouTube via oEmbed, others via an HTTP check) and drop any that don't resolve, returning them as \`dropped_links\` / \`warnings\`. When a link is dropped, tell the user it couldn't be verified and was left out — do not invent a replacement.`,
    `2. **Normalize.** Call \`research_tool\` with your best-effort \`ToolCandidate\`. It checks the catalog for duplicates and returns the candidate annotated with \`duplicate_of\` when a strong match already exists. Propose a \`category\` (with its group) and a \`location\` (room + zone), setting \`isNew\` to your best judgment; staff will confirm. Include at least one \`unit\` (e.g. "<Tool> #1") unless the user is clearly describing a consumable.`,
    `3. **Confirm — always.** Call \`propose_listing\` with the candidate(s). This renders an identification card. **Never call \`create_tool\` without first calling \`propose_listing\` and getting an explicit user confirmation** (a click on "Looks right — add it", or a typed "yes / add it"). Wait for that confirmation.`,
    `4. **Handle duplicates.** If \`research_tool\` reported a \`duplicate_of\`, the card surfaces "Already in catalog". Offer to **add a unit to the existing tool** rather than creating a new tool, unless the user explicitly wants a separate listing.`,
    `5. **Create on confirmation.** Once the user confirms, call \`create_tool\` with that single candidate. Everything is saved as a **draft** (\`published = false\`) — tell the user it's saved as a draft and that staff will publish it. If \`create_tool\` reports \`warnings\` (a partial write), relay exactly what landed and what to finish in Notion; never claim full success when steps failed.`,
    `**Batches:** when the user describes several items at once (a long list, or multiple photos), assemble one candidate per item and pass them all to a single \`propose_listing\` call so each gets its own card. Confirm and \`create_tool\` each item independently; if the user says "add all", create each confirmed candidate in turn.`,
    `Confirmation messages from card buttons arrive as short follow-ups like \`confirm add: <candidate-id>\`, \`add unit to existing: <tool-id>\`, \`edit: <candidate-id>\`, or \`discard: <candidate-id>\`. Resolve \`confirm add\` to a \`create_tool\` call for the matching candidate; on \`edit\`, ask what to change and re-run \`propose_listing\`; on \`discard\`, drop that candidate.`,
  ].join("\n\n");
}

// ── Capability ─────────────────────────────────────────────────────

export const intake: Capability = {
  id: "intake",
  promptFragment,
  // Heterogeneous tool input/output types are erased to the registry's loose
  // element type; the adapters re-validate each tool's input via its own schema.
  tools: [researchTool, proposeListing, createToolTool] as unknown as CapabilityTool<
    unknown,
    unknown
  >[],
};
