import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { fetchDocContent } from "@/lib/doc-fetcher";
import {
  fetchAllTools,
  fetchTool,
  fetchAllCategories,
  fetchAllLocations,
  fetchAllUnits,
  fetchUnit,
  fetchUnitsByTool,
  fetchMaintenanceLogsByUnit,
  createMaintenanceLog,
  resolveTools,
} from "@/lib/airtable";
import { evaluateImage, toolToImageInfo } from "@/lib/eval-images";
import type { ToolRecord, CategoryRecord, LocationRecord, ToolWithMeta } from "@/lib/types";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";

// ── Helpers ────────────────────────────────────────────────────────

let categoryCache: CategoryRecord[] | null = null;
let locationCache: LocationRecord[] | null = null;

async function getResolved(filters?: {
  category?: string;
  location?: string;
}): Promise<ToolWithMeta[]> {
  const [tools, categories, locations] = await Promise.all([
    fetchAllTools(),
    categoryCache ? Promise.resolve(categoryCache) : fetchAllCategories().then((c) => { categoryCache = c; return c; }),
    locationCache ? Promise.resolve(locationCache) : fetchAllLocations().then((l) => { locationCache = l; return l; }),
  ]);

  let resolved = resolveTools(tools, categories, locations);

  if (filters?.category) {
    const cat = filters.category.toLowerCase();
    resolved = resolved.filter(
      (t) =>
        t.category_group.toLowerCase().includes(cat) ||
        t.category_sub.toLowerCase().includes(cat)
    );
  }
  if (filters?.location) {
    const loc = filters.location.toLowerCase();
    resolved = resolved.filter(
      (t) =>
        t.location_room.toLowerCase().includes(loc) ||
        t.location_zone.toLowerCase().includes(loc)
    );
  }

  return resolved;
}

async function findToolByName(name: string): Promise<ToolRecord | null> {
  const tools = await fetchAllTools();
  return tools.find((t) => t.fields.name.toLowerCase() === name.toLowerCase()) || null;
}

// ── Server factory ─────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({ name: "makerlab", version: "1.0.0" });

  server.registerTool("list_tools", {
    description: "List all tools in the MakerLab inventory. Returns name, category, location, and whether the tool has an image.",
    inputSchema: {
      category: z.string().optional().describe("Filter by category (partial match)"),
      location: z.string().optional().describe("Filter by location (partial match)"),
    },
  }, async ({ category, location }) => {
    const tools = await getResolved({ category, location });
    const lines = tools.map(
      (t) => `${t.name} | ${t.category_group} > ${t.category_sub} | ${t.location_room} / ${t.location_zone} | image: ${t.image_url ? "yes" : "no"}`
    );
    return { content: [{ type: "text", text: `Found ${tools.length} tools:\n\n${lines.join("\n")}` }] };
  });

  server.registerTool("get_tool", {
    description: "Get full details for a tool by name or AirTable record ID.",
    inputSchema: {
      name_or_id: z.string().describe("Tool name or AirTable record ID (recXXX)"),
    },
  }, async ({ name_or_id }) => {
    let tool: ToolWithMeta | undefined;

    if (name_or_id.startsWith("rec")) {
      try {
        const record = await fetchTool(name_or_id);
        const resolved = await getResolved();
        tool = resolved.find((t) => t.id === record.id);
      } catch { /* fall through */ }
    }

    if (!tool) {
      const resolved = await getResolved();
      tool = resolved.find((t) => t.name.toLowerCase() === name_or_id.toLowerCase());
    }

    if (!tool) return { content: [{ type: "text", text: `Tool not found: ${name_or_id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(tool, null, 2) }] };
  });

  server.registerTool("search_tools", {
    description: "Keyword search across tool names, descriptions, materials, and tags.",
    inputSchema: { query: z.string().describe("Search keyword or phrase") },
  }, async ({ query }) => {
    const q = query.toLowerCase();
    const resolved = await getResolved();
    const results = resolved.filter((t) =>
      [t.name, t.description, ...t.materials, ...t.tags].join(" ").toLowerCase().includes(q)
    );
    if (results.length === 0) return { content: [{ type: "text", text: `No tools found matching "${query}"` }] };
    const summary = results.map((t) => `- ${t.name}: ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}`).join("\n");
    return { content: [{ type: "text", text: `Found ${results.length} tools:\n\n${summary}` }] };
  });

  server.registerTool("list_units", {
    description: "List all units with status and condition. Optionally filter by tool name.",
    inputSchema: { tool_name: z.string().optional().describe("Filter by tool name") },
  }, async ({ tool_name }) => {
    let units;
    if (tool_name) {
      const tool = await findToolByName(tool_name);
      if (!tool) return { content: [{ type: "text", text: `Tool not found: ${tool_name}` }] };
      units = await fetchUnitsByTool(tool.id);
    } else {
      units = await fetchAllUnits();
    }

    if (units.length === 0) return { content: [{ type: "text", text: tool_name ? `No units for "${tool_name}"` : "No units found" }] };

    const lines = units.map((u) =>
      `${u.fields.unit_label} | status: ${u.fields.status || "Unknown"} | condition: ${u.fields.condition || "Unknown"}`
    );
    return { content: [{ type: "text", text: `Found ${units.length} units:\n\n${lines.join("\n")}` }] };
  });

  server.registerTool("get_unit", {
    description: "Get full details for a unit by label or record ID. Includes maintenance history and parent tool's SOP, safety doc, and video URLs.",
    inputSchema: { label_or_id: z.string().describe("Unit label or AirTable record ID") },
  }, async ({ label_or_id }) => {
    let unit;
    if (label_or_id.startsWith("rec")) {
      try { unit = await fetchUnit(label_or_id); } catch { /* fall through */ }
    }
    if (!unit) {
      const all = await fetchAllUnits();
      unit = all.find((u) => u.fields.unit_label.toLowerCase() === label_or_id.toLowerCase());
    }
    if (!unit) return { content: [{ type: "text", text: `Unit not found: ${label_or_id}` }], isError: true };

    // Fetch parent tool for SOP/safety/video URLs
    const toolId = unit.fields.tool?.[0];
    let parentTool: ToolWithMeta | undefined;
    if (toolId) {
      const resolved = await getResolved();
      parentTool = resolved.find((t) => t.id === toolId);
    }

    const logs = await fetchMaintenanceLogsByUnit(unit.id);
    const result = {
      ...unit.fields,
      id: unit.id,
      tool_name: parentTool?.name || "Unknown",
      sop_url: parentTool?.sop_url || null,
      safety_doc_url: parentTool?.safety_doc_url || null,
      video_url: parentTool?.video_url || null,
      training_required: parentTool?.training_required || false,
      authorized_only: parentTool?.authorized_only || false,
      maintenance_logs: logs.map((l) => ({
        id: l.id,
        title: l.fields.title,
        type: l.fields.type || "",
        priority: l.fields.priority || "",
        status: l.fields.status || "",
        date_reported: l.fields.date_reported || "",
        description: l.fields.description || "",
      })),
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool("create_maintenance_log", {
    description: "Create a maintenance log entry for a unit.",
    inputSchema: {
      title: z.string().describe("Short title for the issue"),
      unit_label: z.string().describe("Unit label (e.g. 'Form 2 #1')"),
      type: z.enum(["Issue Report", "Preventive Maintenance", "Repair", "Inspection", "Calibration"]).optional(),
      priority: z.enum(["Critical", "High", "Medium", "Low"]).optional(),
      reported_by: z.string().optional(),
      description: z.string().optional(),
    },
  }, async (args) => {
    const all = await fetchAllUnits();
    const unit = all.find((u) => u.fields.unit_label.toLowerCase() === args.unit_label.toLowerCase());
    if (!unit) return { content: [{ type: "text", text: `Unit not found: ${args.unit_label}` }], isError: true };

    try {
      const record = await createMaintenanceLog({
        title: args.title,
        unit: [unit.id],
        type: args.type,
        priority: args.priority,
        status: "Open",
        reported_by: args.reported_by,
        description: args.description,
        date_reported: new Date().toISOString().split("T")[0],
      });
      return { content: [{ type: "text", text: `Maintenance log created:\n  ID: ${record.id}\n  Title: ${record.fields.title}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Failed: ${e}` }], isError: true };
    }
  });

  server.registerTool("get_tool_details", {
    description: "Get full tool details INCLUDING the text content of linked SOPs, safety documents, and manuals. Use this when you need the actual document content, not just URLs.",
    inputSchema: {
      name_or_id: z.string().describe("Tool name or AirTable record ID"),
    },
  }, async ({ name_or_id }) => {
    let tool: ToolWithMeta | undefined;

    if (name_or_id.startsWith("rec")) {
      try {
        const record = await fetchTool(name_or_id);
        const resolved = await getResolved();
        tool = resolved.find((t) => t.id === record.id);
      } catch { /* fall through */ }
    }

    if (!tool) {
      const resolved = await getResolved();
      tool = resolved.find((t) => t.name.toLowerCase() === name_or_id.toLowerCase())
        || resolved.find((t) => t.name.toLowerCase().includes(name_or_id.toLowerCase()));
    }

    if (!tool) return { content: [{ type: "text", text: `Tool not found: ${name_or_id}` }], isError: true };

    // Fetch actual document content from linked URLs
    const docSources = [
      { label: "Safety Document", url: tool.safety_doc_url },
      { label: "Operating Manual / SOP", url: tool.sop_url },
      { label: "Video Tutorial", url: tool.video_url },
    ].filter((d) => d.url) as { label: string; url: string }[];

    const docs = (await Promise.all(
      docSources.map(async (d) => {
        const text = await fetchDocContent(d.url);
        return text ? { label: d.label, url: d.url, excerpt: text.slice(0, 5000) } : null;
      })
    )).filter(Boolean);

    const result = {
      ...tool,
      sources: docs,
      detail_page: `/tools/${tool.id}`,
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool("evaluate_image", {
    description: "Evaluate a single tool's image using Claude vision. Checks if image matches the tool.",
    inputSchema: { tool_name: z.string().describe("Name of the tool to evaluate") },
  }, async ({ tool_name }) => {
    const tool = await findToolByName(tool_name);
    if (!tool) return { content: [{ type: "text", text: `Tool not found: ${tool_name}` }], isError: true };
    const result = await evaluateImage(toolToImageInfo(tool));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

// ── Route handler ──────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const expectedApiKey = process.env.MCP_API_KEY;
  if (!expectedApiKey) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "MCP_API_KEY is not configured" }, id: null },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerKey = req.headers.get("x-api-key") || "";
  const suppliedKey = bearer || headerKey;
  if (suppliedKey !== expectedApiKey) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
      { status: 401 }
    );
  }

  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`mcp:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Please wait a moment." }, id: null },
      { status: 429 }
    );
  }

  // GET is used for SSE streams — not supported in stateless serverless mode
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
