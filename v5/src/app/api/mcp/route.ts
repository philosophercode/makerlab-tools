import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import { fetchMaintenanceLogsByUnit } from "../../../lib/notion";
import type { MakerLabTool, MakerLabUnit } from "../../../components/catalog-types";
import { getClientIp, rateLimitAsync } from "../../../lib/rate-limit";

// ── Helpers ────────────────────────────────────────────────────────

interface UnitLookupEntry {
  id: string;
  label: string;
  toolName: string;
  toolSlug: string;
  status: MakerLabUnit["status"];
  condition: MakerLabUnit["condition"];
  location: string;
  serial: string;
  dateAcquired: string | null;
}

// Flatten the catalog's units into a lookup so we can resolve a unit by its
// label the same way the chat route's get_unit_details tool does.
function buildUnitLookup(tools: MakerLabTool[]): UnitLookupEntry[] {
  return tools.flatMap((tool) =>
    tool.units.map((unit) => ({
      id: unit.id,
      label: unit.name,
      toolName: tool.name,
      toolSlug: tool.slug,
      status: unit.status,
      condition: unit.condition,
      location: unit.location,
      serial: unit.serial,
      dateAcquired: unit.dateAcquired,
    }))
  );
}

function findUnit(units: UnitLookupEntry[], label: string): UnitLookupEntry | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  return (
    units.find((u) => u.label.toLowerCase() === needle) ||
    units.find((u) => u.label.toLowerCase().includes(needle)) ||
    null
  );
}

// Resolve a tool by Notion page id or (partial) name.
function findTool(tools: MakerLabTool[], idOrName: string): MakerLabTool | null {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) return null;
  return (
    tools.find((t) => t.id.toLowerCase() === needle || t.slug.toLowerCase() === needle) ||
    tools.find((t) => t.name.toLowerCase() === needle) ||
    tools.find((t) => t.name.toLowerCase().includes(needle)) ||
    null
  );
}

function summarizeTool(tool: MakerLabTool): string {
  return [
    tool.name,
    `id: ${tool.id}`,
    `${tool.category}${tool.categorySub ? ` > ${tool.categorySub}` : ""}`,
    `${tool.location}${tool.zone ? ` / ${tool.zone}` : ""}`,
    `training: ${tool.trainingLevel}`,
    `status: ${tool.status}`,
  ].join(" | ");
}

function recentMaintenance(unitId: string) {
  return fetchMaintenanceLogsByUnit(unitId)
    .catch(() => [])
    .then((logs) =>
      logs.slice(0, 10).map((log) => ({
        title: log.fields.title,
        type: log.fields.type || "",
        priority: log.fields.priority || "",
        status: log.fields.status || "",
        date_reported: log.fields.date_reported || "",
        description: log.fields.description || "",
      }))
    );
}

// ── Server factory ─────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({ name: "makerlab", version: "1.0.0" });

  server.registerTool(
    "list_tools",
    {
      description:
        "List all tools in the MakerLab catalog. Returns name, id, category, location, training level, and status. Optionally filter by category or location (partial match).",
      inputSchema: {
        category: z.string().optional().describe("Filter by category (partial match)"),
        location: z.string().optional().describe("Filter by location (partial match)"),
      },
    },
    async ({ category, location }) => {
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
      const lines = tools.map(summarizeTool);
      return {
        content: [
          { type: "text", text: `Found ${tools.length} tools:\n\n${lines.join("\n")}` },
        ],
      };
    }
  );

  server.registerTool(
    "search_tools",
    {
      description:
        "Keyword search across tool names, descriptions, materials, and tags. Returns matching tools with a short summary.",
      inputSchema: { query: z.string().describe("Search keyword or phrase") },
    },
    async ({ query }) => {
      const q = query.toLowerCase();
      const tools = await getCatalogTools();
      const results = tools.filter((t) =>
        [t.name, t.description, t.shortDescription, ...t.materials, ...t.tags]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No tools found matching "${query}"` }] };
      }
      const summary = results
        .map(
          (t) =>
            `- ${t.name} (id: ${t.id}): ${t.shortDescription.slice(0, 120)}${t.shortDescription.length > 120 ? "…" : ""}`
        )
        .join("\n");
      return {
        content: [{ type: "text", text: `Found ${results.length} tools:\n\n${summary}` }],
      };
    }
  );

  server.registerTool(
    "get_tool_details",
    {
      description:
        "Get full details for a tool by id, slug, or name. Includes description, materials, PPE, training, use restrictions, emergency stop, units, and resource links (SOPs, safety docs, manuals).",
      inputSchema: {
        id_or_name: z.string().describe("Tool id, slug, or name"),
      },
    },
    async ({ id_or_name }) => {
      const needle = id_or_name.trim();
      // Try a direct id/slug lookup first (cheaper, single record), then fall
      // back to a name search across the full catalog.
      let tool = await getCatalogTool(needle);
      if (!tool) {
        const tools = await getCatalogTools();
        tool = findTool(tools, needle);
      }
      if (!tool) {
        return {
          content: [{ type: "text", text: `Tool not found: ${id_or_name}` }],
          isError: true,
        };
      }

      const result = {
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
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_unit_details",
    {
      description:
        "Fetch details for a specific physical unit by its label (e.g. 'Prusa #1', 'Form 2 #2'), including status, condition, location, and recent maintenance history.",
      inputSchema: {
        unit_label: z.string().describe("The unit label, e.g. 'Prusa #1' or 'Form 2 #1'"),
      },
    },
    async ({ unit_label }) => {
      const tools = await getCatalogTools();
      const lookup = buildUnitLookup(tools);
      const match = findUnit(lookup, unit_label);
      if (!match) {
        const sample = lookup
          .slice(0, 8)
          .map((u) => u.label)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: `No unit found matching "${unit_label}". Some known units: ${sample}${lookup.length > 8 ? "…" : ""}`,
            },
          ],
        };
      }

      const result = {
        unit_id: match.id,
        unit_label: match.label,
        tool_name: match.toolName,
        tool_slug: match.toolSlug,
        status: match.status,
        condition: match.condition,
        location: match.location,
        serial: match.serial,
        date_acquired: match.dateAcquired,
        detail_page: `/tools/${match.toolSlug}`,
        maintenance_logs: await recentMaintenance(match.id),
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_maintenance_history",
    {
      description:
        "Get recent maintenance logs for a unit by its label (e.g. 'Prusa #1'). Returns the most recent entries with type, priority, status, date, and description.",
      inputSchema: {
        unit_label: z.string().describe("The unit label to fetch maintenance history for"),
      },
    },
    async ({ unit_label }) => {
      const tools = await getCatalogTools();
      const lookup = buildUnitLookup(tools);
      const match = findUnit(lookup, unit_label);
      if (!match) {
        return {
          content: [{ type: "text", text: `No unit found matching "${unit_label}".` }],
          isError: true,
        };
      }
      const logs = await recentMaintenance(match.id);
      if (logs.length === 0) {
        return {
          content: [
            { type: "text", text: `No maintenance history for ${match.label}.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { unit_label: match.label, unit_id: match.id, maintenance_logs: logs },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

// ── Route handler ──────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  // Optional bearer-token auth: if MCP_TOKEN is set, require it. If unset, the
  // endpoint is open so it works out of the box but can be locked down later.
  const expectedToken = process.env.MCP_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (bearer !== expectedToken) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
        { status: 401 }
      );
    }
  }

  // Always rate-limit by IP.
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`mcp:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many requests. Please wait a moment." },
        id: null,
      },
      { status: 429 }
    );
  }

  // GET is used for SSE streams — not supported in stateless serverless mode.
  if (req.method === "GET") {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "SSE not supported in serverless mode" }, id: null },
      { status: 405 }
    );
  }

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Return JSON instead of SSE — required for serverless
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 }
    );
  }
}

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
