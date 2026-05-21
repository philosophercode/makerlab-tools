import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import {
  createMaintenanceLog,
  fetchMaintenanceLogsByUnit,
} from "../../../lib/notion";
import { getChunksForTool, searchDocs } from "../../../lib/rag";
import type { MakerLabTool, MakerLabUnit } from "../../../components/catalog-types";

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  toolId?: string;
}

const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

export async function POST(req: Request) {
  const { messages, toolId }: ChatRequest = await req.json();
  const tools = await getCatalogTools();
  const focused = toolId ? await getCatalogTool(toolId) : null;
  const unitLookup = buildUnitLookup(tools);
  const system = buildSystemPrompt(tools, focused);

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system,
    messages: await convertToModelMessages(messages),
    tools: {
      get_unit_details: tool({
        description:
          "Fetch details for a specific physical unit, including its status, condition, and recent maintenance history. Use when the student names or asks about a specific unit (e.g. 'Prusa #1', 'Form 2 #2') or reports an issue tied to one.",
        inputSchema: z.object({
          unit_label: z
            .string()
            .describe("The unit label, e.g. 'Prusa #1' or 'Form 2 #1'."),
        }),
        execute: async ({ unit_label }) => {
          const match = findUnit(unitLookup, unit_label);
          if (!match) {
            const sample = unitLookup
              .slice(0, 8)
              .map((u) => u.label)
              .join(", ");
            return {
              found: false,
              message: `No unit found matching "${unit_label}". Some known units: ${sample}${unitLookup.length > 8 ? "…" : ""}`,
            };
          }

          const logs = await fetchMaintenanceLogsByUnit(match.id).catch(
            () => []
          );

          return {
            found: true,
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
            maintenance_logs: logs.slice(0, 10).map((log) => ({
              title: log.fields.title,
              type: log.fields.type || "",
              priority: log.fields.priority || "",
              status: log.fields.status || "",
              date_reported: log.fields.date_reported || "",
              description: log.fields.description || "",
            })),
          };
        },
      }),
      report_issue: tool({
        description:
          "File a maintenance ticket in Notion when a student reports a problem with a tool or unit. Gather a short title and a clear description first. If they named a specific unit (like 'Prusa #1'), include it so the log is linked. Ask for the reporter's name if they haven't given it.",
        inputSchema: z.object({
          title: z.string().describe("Short summary of the issue"),
          description: z
            .string()
            .describe("Full description of what's wrong"),
          unit_label: z
            .string()
            .optional()
            .describe("Unit label if the issue is tied to a specific unit"),
          priority: z
            .enum(PRIORITIES)
            .default("Medium")
            .describe(
              "Critical = unsafe / lab-blocking, High = unusable, Medium = degraded, Low = cosmetic"
            ),
          reported_by: z
            .string()
            .optional()
            .describe("Student name or NetID if provided"),
        }),
        execute: async ({
          title,
          description,
          unit_label,
          priority,
          reported_by,
        }) => {
          const match = unit_label ? findUnit(unitLookup, unit_label) : null;
          try {
            const record = await createMaintenanceLog({
              title,
              description,
              type: "Issue Report",
              priority,
              status: "Open",
              reported_by: reported_by || undefined,
              unit: match ? [match.id] : undefined,
              date_reported: new Date().toISOString().split("T")[0],
            });
            return {
              success: true,
              ticket_id: record.id,
              unit_resolved: match
                ? { id: match.id, label: match.label }
                : null,
              message: `Logged maintenance ticket ${record.id}.`,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Failed to file ticket";
            return { success: false, error: message };
          }
        },
      }),
      search_docs: tool({
        description:
          "Search ingested tool manuals and resources for technical info, specifications, troubleshooting steps, etc. Use when the student asks about specs, error codes, materials compatibility, or anything that would be in a manual.",
        inputSchema: z.object({
          query: z.string().describe("Natural-language search query"),
          tool_id: z
            .string()
            .optional()
            .describe(
              "Optional: scope search to a specific tool's documents. If the student is viewing a tool, scope to it."
            ),
        }),
        execute: async ({ query, tool_id }) => {
          const hits = await searchDocs({ query, toolId: tool_id, topK: 5 });
          return { hits };
        },
      }),
    },
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}

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

function findUnit(
  units: UnitLookupEntry[],
  label: string
): UnitLookupEntry | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  return (
    units.find((u) => u.label.toLowerCase() === needle) ||
    units.find((u) => u.label.toLowerCase().includes(needle)) ||
    null
  );
}

function buildSystemPrompt(
  tools: MakerLabTool[],
  focused: MakerLabTool | null
): string {
  const sections: string[] = [
    "You are the MakerLab Assistant — a friendly, knowledgeable helper for students using the Cornell Tech MakerLab. Answer questions about lab tools, training requirements, safety, materials, and which machines are right for a given project. Be concise, accurate, and grounded only in the catalog provided below. If the user asks about a tool that isn't in the catalog, say so honestly.",
    `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context). Do not invent slugs — only use slugs from the catalog list.`,
    `## Reporting maintenance issues\n\nIf a student describes a tool or unit problem (broken, jammed, misbehaving, missing parts, safety concern, etc.), gather a short title, a clear description, the affected unit if any, and the student's name, then call \`report_issue\`. After it succeeds, tell the student the ticket was filed and include the ticket ID. If they only name a tool (not a specific unit), it's fine to file the ticket without one — but ask first if they can tell you which unit. If they name a specific unit you don't recognize, call \`get_unit_details\` first to confirm it before filing.\n\nPriority guide: Critical = unsafe or blocks all lab use · High = tool unusable · Medium = degraded performance · Low = cosmetic.`,
    `## Unit details\n\nWhen a student asks about a specific unit ("how is Prusa #1 doing?", "is Form 2 #2 working?", "show me the history on the Trotec"), call \`get_unit_details\` to fetch its live status and recent maintenance history. Surface the status, condition, and a short recap of the most recent log entries.`,
    `## Searching documentation\n\nFor questions that require deeper technical info than what's in the catalog summary — exact specifications, step-by-step setup, error codes, materials compatibility, troubleshooting, calibration, software workflows — call \`search_docs\` with a focused natural-language query. If the student is viewing a tool page (see Active tool context below), pass that tool's id as \`tool_id\` to scope the search. Use the returned chunks to ground your answer, and cite the source resource by name. If \`search_docs\` returns no hits, fall back to the catalog and (if needed) tell the student you don't have manual coverage for that question.`,
  ];

  if (focused) {
    sections.push(
      `## Active tool context\n\nThe student is currently viewing the **${focused.name}** detail page in the MakerLab catalog (tool id: \`${focused.id}\`). If they use pronouns like "this", "it", "that tool", or "the machine", or ask things like "how do I use it" / "what can I make with this" without naming a tool, assume they are asking about the ${focused.name}. When calling \`search_docs\`, pass \`tool_id: "${focused.id}"\` to scope the search. Use the resource links below when relevant — point to the SOP, safety doc, or manual when the student asks how to use, set up, or troubleshoot the tool. Do not wrap "${focused.name}" itself in a tool link — the student is already on its page.\n\n${describeTool(focused)}`
    );

    const docChunks = getChunksForTool(focused.id, 20);
    if (docChunks.length) {
      const formatted = docChunks
        .map((chunk) => `### ${chunk.resource_title}\n${chunk.text}`)
        .join("\n\n---\n\n");
      sections.push(
        `## Tool documentation\n\nThe following excerpts are from manuals and resources attached to **${focused.name}**. Prefer these for technical questions; call \`search_docs\` for anything not covered here.\n\n${formatted}`
      );
    }
  }

  sections.push(`## MakerLab catalog (${tools.length} tools)`);
  sections.push(
    tools
      .map((tool) => {
        const head = `- **${tool.name}** — slug: \`${tool.slug}\` — ${tool.category}${tool.categorySub ? ` / ${tool.categorySub}` : ""} · ${tool.location}${tool.zone ? ` / ${tool.zone}` : ""} · ${tool.trainingLevel}`;
        if (!tool.units.length) return head;
        const units = tool.units
          .map((unit) => `${unit.name} [${unit.status}]`)
          .join(", ");
        return `${head}\n  units: ${units}`;
      })
      .join("\n")
  );

  return sections.join("\n\n");
}

function describeTool(tool: MakerLabTool): string {
  const lines: string[] = [
    `**${tool.name}**`,
    `- Category: ${tool.category}${tool.categorySub ? ` / ${tool.categorySub}` : ""}`,
    `- Location: ${tool.location}${tool.zone ? ` / ${tool.zone}` : ""}`,
    `- Training: ${tool.trainingLabel} (level: ${tool.trainingLevel})`,
  ];
  if (tool.materials.length) lines.push(`- Materials: ${tool.materials.join(", ")}`);
  if (tool.ppe.length) lines.push(`- PPE: ${tool.ppe.join(", ")}`);
  if (tool.useRestrictions) lines.push(`- Restrictions: ${tool.useRestrictions}`);
  if (tool.emergencyStop) lines.push(`- Emergency stop: ${tool.emergencyStop}`);
  if (tool.description) lines.push(`- Description: ${tool.description}`);
  if (tool.units.length) {
    lines.push("- Units:");
    for (const unit of tool.units) {
      lines.push(
        `  - ${unit.name} — status: ${unit.status}, condition: ${unit.condition}${unit.serial && unit.serial !== "Unlisted" ? `, serial: ${unit.serial}` : ""}`
      );
    }
  }
  if (tool.links.length) {
    lines.push("- Resources:");
    for (const link of tool.links) {
      lines.push(`  - ${link.kind || "Resource"}: ${link.label} — ${link.href}`);
    }
  }
  return lines.join("\n");
}
