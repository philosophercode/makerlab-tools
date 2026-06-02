import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../catalog";
import { findTool, summarizeTool } from "./helpers";
import type {
  Capability,
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
  name: string;
  summary: string;
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
  async run({ category, location }) {
    let tools = await getCatalogTools();
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
        summary: summarizeTool(t),
      })),
    };
  },
};

const searchTools: CapabilityTool<SearchToolsInput, SearchToolsResult> = {
  name: "search_tools",
  description:
    "Keyword search across tool names, descriptions, materials, and tags. Returns matching tools with a short summary.",
  inputSchema: searchToolsInput,
  kind: "read",
  async run({ query }) {
    const q = query.toLowerCase();
    const tools = await getCatalogTools();
    const results = tools.filter((t) =>
      [t.name, t.description, t.shortDescription, ...t.materials, ...t.tags]
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
        summary: summarizeTool(t),
        short_description: t.shortDescription,
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
  async run({ id_or_name }) {
    const needle = id_or_name.trim();
    // Try a direct id/slug lookup first (cheaper, single record), then fall
    // back to a name search across the full catalog.
    let tool = await getCatalogTool(needle);
    if (!tool) {
      const tools = await getCatalogTools();
      tool = findTool(tools, needle);
    }
    if (!tool) {
      return { found: false, message: `Tool not found: ${id_or_name}` };
    }

    return {
      found: true,
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
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
    };
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

/**
 * Describe a single catalog tool in the compact bullet form the chat system
 * prompt uses (name + slug + category/location/training, then a units line).
 */
function describeCatalogEntry(tool: MakerLabTool): string {
  const head = `- **${tool.name}** — slug: \`${tool.slug}\` — ${tool.category}${
    tool.categorySub ? ` / ${tool.categorySub}` : ""
  } · ${tool.location}${tool.zone ? ` / ${tool.zone}` : ""} · ${tool.trainingLevel}`;
  if (!tool.units.length) return head;
  const units = tool.units
    .map((unit) => `${unit.name} [${unit.status}]`)
    .join(", ");
  return `${head}\n  units: ${units}`;
}

function promptFragment(env: PromptEnv): string {
  const { tools, focusedTool } = env;
  const sections: string[] = [];

  sections.push(
    `## Browsing the catalog\n\nUse the catalog tools to answer questions about what's in the lab:\n\n- \`list_tools\` — list everything, optionally filtered by category or location (partial match). Use this for "what do you have", "show me the 3D printers", "what's in the wood shop".\n- \`search_tools\` — keyword search across names, descriptions, materials, and tags. Use this when the student describes a need ("something to cut acrylic", "a tool for sanding") rather than naming a tool.\n- \`get_tool_details\` — full details for one tool by id, slug, or name. Use this when the student asks about a specific tool's specs, training, PPE, restrictions, units, or resources, before answering with anything beyond the summary already in the catalog list below.\n\nGround every answer in the catalog. If a student asks about a tool that isn't in the catalog, say so honestly rather than inventing one.`
  );

  sections.push(
    `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context). Do not invent slugs — only use slugs from the catalog list.`
  );

  if (focusedTool) {
    sections.push(
      `## Active tool context\n\nThe student is currently viewing the **${focusedTool.name}** detail page in the MakerLab catalog. If they use pronouns like "this", "it", "that tool", or "the machine", or ask things like "how do I use it" / "what can I make with this" without naming a tool, assume they are asking about the ${focusedTool.name}. Do not wrap "${focusedTool.name}" itself in a tool link — the student is already on its page.`
    );
  }

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
