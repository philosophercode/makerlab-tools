import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../catalog";
import { can } from "../auth/permissions";
import { listCatalogTools, listToolStates, type CatalogToolState } from "../data/catalog";
import { findTool, summarizeTool } from "./helpers";
import { officialNameShown } from "../tool-names";
import { mapFactsFor, type ToolMapFacts } from "../map/locate";
import { canSeeMap } from "../map/access";
import type {
  Capability,
  CapabilityCtx,
  CapabilityTool,
  PromptEnv,
} from "./types";
import type { MakerLabTool } from "../../components/catalog-types";

/**
 * The `catalog` capability: read-only discovery of the MakerLab catalog.
 *
 * Ports the catalog reads that previously lived in two places — the MCP route's
 * `list_tools` / `search_tools` / `get_tool_details` and the chat route's
 * `get_tool_details` tool — into a single set of capability tools. Each `run()`
 * returns plain structured data; the adapters (chat / MCP) are responsible for
 * wrapping that data into AI SDK or MCP tool-result shapes.
 *
 * The `promptFragment` carries the catalog listing plus the tool-linking rules
 * and active-tool context from the current chat system prompt.
 */

// ── Tool result shapes ─────────────────────────────────────────────

/** A compact tool entry returned by `list_tools` / `search_tools`. */
interface ToolListEntry {
  id: string;
  slug: string;
  /** The display name. */
  name: string;
  /** The full product name with model or part number, when recorded and different (tool display names spec §5.6). */
  official_name?: string;
  summary: string;
  /** Only for a caller holding `tools.edit`, who also sees drafts and archived tools. */
  state?: CatalogToolState;
}

interface ListToolsResult {
  count: number;
  tools: ToolListEntry[];
}

interface SearchToolsResult {
  query: string;
  count: number;
  tools: Array<ToolListEntry & { short_description: string }>;
}

/** Full tool details returned by `get_tool_details`. */
interface ToolDetailsResult {
  found: boolean;
  message?: string;
  id?: string;
  slug?: string;
  name?: string;
  /** The official name, or null when none is recorded. */
  official_name?: string | null;
  category?: string;
  category_sub?: string;
  location?: string;
  zone?: string;
  training_level?: MakerLabTool["trainingLevel"];
  training_label?: string;
  status?: MakerLabTool["status"];
  description?: string;
  short_description?: string;
  materials?: string[];
  ppe?: string[];
  tags?: string[];
  use_restrictions?: string | null;
  emergency_stop?: string | null;
  notes?: string | null;
  links?: MakerLabTool["links"];
  units?: MakerLabTool["units"];
  detail_page?: string;
  /**
   * Where the tool stands on the lab's floor map, with a `/map?highlight=`
   * link (floor map spec §5.4); null when its location is not on the map.
   * Absent entirely for a caller who is not signed in (`canSeeMap`).
   */
  map?: ToolMapFacts | null;
  /** Only for a caller holding `tools.edit`: published, draft or archived. */
  state?: CatalogToolState;
}

// ── Whose catalogue ────────────────────────────────────────────────

/** The tools a caller may browse, and — for staff — each one's state. */
interface CatalogView {
  tools: MakerLabTool[];
  /** Null for everyone but staff, who alone see drafts and archived tools. */
  states: Map<string, CatalogToolState> | null;
}

/**
 * The published catalogue for everybody; for a caller holding `tools.edit`,
 * every tool including drafts and archived ones, each marked with its state
 * (MCP access spec §3.2). Staff read it uncached: it is the review view, and a
 * draft someone just created should be there on the next call.
 */
async function catalogFor(ctx: CapabilityCtx): Promise<CatalogView> {
  if (!can(ctx.identity, "tools.edit")) return { tools: await getCatalogTools(), states: null };
  const [tools, states] = await Promise.all([
    listCatalogTools({ includeDrafts: true, includeArchived: true }),
    listToolStates(),
  ]);
  return { tools, states };
}

/** `official_name` for a list entry, only when it says more than the display name. */
function officialOf(tool: MakerLabTool): { official_name?: string } {
  const official = officialNameShown(tool);
  return official ? { official_name: official } : {};
}

/**
 * What a list or a search offers by default (taxonomy v2 spec §4.9): for
 * everybody but staff, tools whose category the gallery hides by default
 * (Shop Infrastructure & Supplies) are left out — unless the caller asked for
 * that category by name, as the gallery's facet does. Staff see everything.
 * `get_tool_details` still answers for any published tool: its page is public.
 */
function shownByDefault(view: CatalogView, tools: MakerLabTool[], askedCategory?: string): MakerLabTool[] {
  if (view.states) return tools;
  const asked = askedCategory?.toLowerCase();
  return tools.filter(
    (t) => !t.galleryHidden || (asked !== undefined && (t.category.toLowerCase().includes(asked) || t.categorySub.toLowerCase().includes(asked)))
  );
}

function stateOf(view: CatalogView, id: string): { state?: CatalogToolState } {
  const state = view.states?.get(id);
  return state ? { state } : {};
}

// ── Inputs ─────────────────────────────────────────────────────────

const listToolsInput = z.object({
  category: z
    .string()
    .optional()
    .describe("Filter by category (partial match)"),
  location: z
    .string()
    .optional()
    .describe("Filter by location (partial match)"),
});
type ListToolsInput = z.infer<typeof listToolsInput>;

const searchToolsInput = z.object({
  query: z.string().describe("Search keyword or phrase"),
});
type SearchToolsInput = z.infer<typeof searchToolsInput>;

const getToolDetailsInput = z.object({
  id_or_name: z.string().describe("Tool id, slug, or name"),
});
type GetToolDetailsInput = z.infer<typeof getToolDetailsInput>;

// ── Tools ──────────────────────────────────────────────────────────

const listTools: CapabilityTool<ListToolsInput, ListToolsResult> = {
  name: "list_tools",
  description:
    "List all tools in the MakerLab catalog. Returns name, id, category, location, training level, and status. Optionally filter by category or location (partial match).",
  inputSchema: listToolsInput,
  kind: "read",
  async run({ category, location }, ctx) {
    const view = await catalogFor(ctx);
    let tools = shownByDefault(view, view.tools, category);
    if (category) {
      const cat = category.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.category.toLowerCase().includes(cat) ||
          t.categorySub.toLowerCase().includes(cat)
      );
    }
    if (location) {
      const loc = location.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.location.toLowerCase().includes(loc) ||
          t.zone.toLowerCase().includes(loc)
      );
    }
    return {
      count: tools.length,
      tools: tools.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        ...officialOf(t),
        summary: summarizeTool(t),
        ...stateOf(view, t.id),
      })),
    };
  },
};

const searchTools: CapabilityTool<SearchToolsInput, SearchToolsResult> = {
  name: "search_tools",
  description:
    "Keyword search across tool names (the display name and the official product name with its model or part number), descriptions, materials, and tags. Returns matching tools with a short summary.",
  inputSchema: searchToolsInput,
  kind: "read",
  async run({ query }, ctx) {
    const q = query.toLowerCase();
    const view = await catalogFor(ctx);
    const tools = shownByDefault(view, view.tools);
    const results = tools.filter((t) =>
      [t.name, t.officialName ?? "", t.description, t.shortDescription, ...t.materials, ...t.tags]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    return {
      query,
      count: results.length,
      tools: results.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        ...officialOf(t),
        summary: summarizeTool(t),
        short_description: t.shortDescription,
        ...stateOf(view, t.id),
      })),
    };
  },
};

const getToolDetails: CapabilityTool<GetToolDetailsInput, ToolDetailsResult> = {
  name: "get_tool_details",
  description:
    "Get full details for a tool by id, slug, or name. Includes description, materials, PPE, training, use restrictions, emergency stop, units, and resource links (SOPs, safety docs, manuals).",
  inputSchema: getToolDetailsInput,
  kind: "read",
  async run({ id_or_name }, ctx) {
    const needle = id_or_name.trim();
    // Everybody but staff: a direct id/slug lookup first (cheaper, single
    // record), then a name search across the published catalogue. Staff search
    // every tool, drafts and archived ones included.
    let view: CatalogView | null = null;
    let tool = can(ctx.identity, "tools.edit") ? null : await getCatalogTool(needle);
    if (!tool) {
      view = await catalogFor(ctx);
      tool = findTool(view.tools, needle);
    }
    if (!tool) {
      return { found: false, message: `Tool not found: ${id_or_name}` };
    }

    return {
      found: true,
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      official_name: tool.officialName ?? null,
      category: tool.category,
      category_sub: tool.categorySub,
      location: tool.location,
      zone: tool.zone,
      training_level: tool.trainingLevel,
      training_label: tool.trainingLabel,
      status: tool.status,
      description: tool.description,
      short_description: tool.shortDescription,
      materials: tool.materials,
      ppe: tool.ppe,
      tags: tool.tags,
      use_restrictions: tool.useRestrictions,
      emergency_stop: tool.emergencyStop,
      notes: tool.notes,
      links: tool.links,
      units: tool.units,
      detail_page: `/tools/${tool.slug}`,
      ...(canSeeMap(ctx.identity) ? { map: mapFactsFor(tool) } : {}),
      ...(view ? stateOf(view, tool.id) : {}),
    };
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

/**
 * Describe a single catalog tool in the compact bullet form the chat system
 * prompt uses (name + slug + category/location/training, then a units line).
 */
function describeCatalogEntry(tool: MakerLabTool): string {
  const official = officialNameShown(tool);
  const head = `- **${tool.name}**${official ? ` (official: ${official})` : ""} — slug: \`${tool.slug}\` — ${tool.category}${
    tool.categorySub ? ` / ${tool.categorySub}` : ""
  } · ${tool.location}${tool.zone ? ` / ${tool.zone}` : ""} · ${tool.trainingLevel}`;
  if (!tool.units.length) return head;
  const units = tool.units
    .map((unit) => `${unit.name} [${unit.status}]`)
    .join(", ");
  return `${head}\n  units: ${units}`;
}

/**
 * The "Browsing the catalog" rules. The listing at the end of this fragment is
 * the whole catalog, so a "what do you have" question is answered from it
 * directly: telling the model to call `list_tools` for those cost a full extra
 * model step, about 1.5–2s before the first word (performance plan, quick
 * win 1).
 */
export const BROWSING_SECTION = `## Browsing the catalog\n\nThe **MakerLab catalog** list at the end of this section is complete: every tool in the lab, with its category, location and training level. **Answer from it directly** — without calling a tool — when the student asks what the lab has, which tools of a kind there are ("what 3D printers do you have?", "show me the laser cutters") or what is in a room ("what's in the wood shop?").\n\nCall a catalog tool only when the answer needs more than that list shows:\n\n- \`search_tools\` — keyword search across names, descriptions, materials, and tags. Use this when the student describes a need ("something to cut acrylic", "a tool for sanding") and the names alone do not settle it.\n- \`get_tool_details\` — full details for one tool by id, slug, or name. Use this when the student asks about a specific tool's specs, description, training, PPE, restrictions, units, or resources, before answering with anything beyond the summary in the catalog list.\n- \`list_tools\` — the catalog with each tool's description, optionally filtered by category or location (partial match). Use it only when you need the descriptions of many tools at once.\n\nGround every answer in the catalog. If a student asks about a tool that isn't in the catalog, say so honestly rather than inventing one.`;

function promptFragment(env: PromptEnv): string {
  const { tools } = env;
  const sections: string[] = [];

  sections.push(BROWSING_SECTION);

  sections.push(
    `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context under This conversation, when there is one). Do not invent slugs — only use slugs from the catalog list.`
  );

  // Only a signed-in caller gets `map` from get_tool_details (canSeeMap).
  if (canSeeMap(env.identity)) {
    sections.push(
      `## Where things are\n\nWhen a student asks where a tool is ("where is the laser cutter?"), call \`get_tool_details\` and answer from its \`map\` field: the zone (with its number), the room, and the station label when there is one, then link the floor map with the \`map_page\` path it gives: \`[See it on the floor map](/map?highlight=4A)\`. If \`map\` is null, say the tool's location is not on the map yet and give the location and zone the catalog has — never guess a zone.`
    );
  }

  // The focused tool ("Active tool context") is per-request: the chat adapter
  // puts it in the prompt's "This conversation" tail.

  sections.push(`## MakerLab catalog (${tools.length} tools)`);
  sections.push(tools.map(describeCatalogEntry).join("\n"));

  return sections.join("\n\n");
}

// ── Capability ─────────────────────────────────────────────────────

export const catalog: Capability = {
  id: "catalog",
  promptFragment,
  tools: [
    listTools as CapabilityTool<unknown, unknown>,
    searchTools as CapabilityTool<unknown, unknown>,
    getToolDetails as CapabilityTool<unknown, unknown>,
  ],
};
