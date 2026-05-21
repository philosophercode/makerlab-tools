import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type FilePart,
  type ModelMessage,
  type TextPart,
  type UIMessage,
  type UserModelMessage,
} from "ai";
import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import {
  createMaintenanceLog,
  fetchAllResources,
  fetchMaintenanceLogsByUnit,
} from "../../../lib/notion";
import type { MakerLabTool, MakerLabUnit } from "../../../components/catalog-types";
import type { ResourceRecord } from "../../../lib/types";

const MAX_PDFS_PER_CHAT = 3;

interface AttachedManual {
  title: string;
  url: string;
}

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
  const manuals = focused ? await collectToolManuals(focused.id) : [];
  if (focused) {
    const hosts = uniqueHosts(focused.links.map((l) => l.href));
    console.info(
      `[chat] focused tool: ${focused.name} (${focused.id}), links: ${focused.links.length}`
    );
    console.info(
      `[chat] web_fetch allowedDomains: ${hosts.length ? hosts.join(", ") : "empty"}`
    );
    console.info(`[chat] manuals attached: ${manuals.length}`);
  }
  const system = buildSystemPrompt(tools, focused, manuals);
  const modelMessages = attachManualsToFirstUserMessage(
    await convertToModelMessages(messages),
    manuals
  );

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      if (manuals.length > 0) {
        writer.write({
          type: "data-manuals-attached",
          data: { titles: manuals.map((m) => m.title) },
          transient: true,
        });
      }

      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system,
        messages: modelMessages,
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
          photo_uploads: z
            .array(
              z.object({
                id: z.string().describe("Notion file_upload_id"),
                name: z.string().describe("Original filename"),
              })
            )
            .optional()
            .describe(
              "Notion file_upload references. Parse these from the [Attached photos: file_upload_id=... name=...] hint in the student's message."
            ),
        }),
        execute: async ({
          title,
          description,
          unit_label,
          priority,
          reported_by,
          photo_uploads,
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
              photo_uploads: photo_uploads?.length ? photo_uploads : undefined,
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
      web_fetch: anthropic.tools.webFetch_20250910({
        maxUses: 5,
        maxContentTokens: 20000,
        citations: { enabled: true },
        ...(focused
          ? (() => {
              const hosts = uniqueHosts(focused.links.map((l) => l.href));
              return hosts.length ? { allowedDomains: hosts } : {};
            })()
          : {}),
      }),
    },
    stopWhen: stepCountIs(5),
  });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
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

function uniqueHosts(urls: string[]): string[] {
  const set = new Set<string>();
  for (const u of urls) {
    try {
      set.add(new URL(u).hostname);
    } catch {
      // skip malformed URLs
    }
  }
  return [...set];
}

function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false;
  const cleaned = url.split("?")[0].toLowerCase();
  return cleaned.endsWith(".pdf");
}

function pickPdfUrl(resource: ResourceRecord): string | null {
  if (isPdfUrl(resource.fields.url)) return resource.fields.url ?? null;
  const file = (resource.fields.files || []).find((f) => isPdfUrl(f.filename) || isPdfUrl(f.url));
  return file?.url || null;
}

async function collectToolManuals(toolId: string): Promise<AttachedManual[]> {
  let resources: ResourceRecord[];
  try {
    resources = await fetchAllResources();
  } catch (err) {
    console.warn("[chat] failed to load resources for manuals", err);
    return [];
  }

  const forTool = resources.filter(
    (r) => r.fields.published !== false && (r.fields.tool || []).includes(toolId)
  );

  const manuals: AttachedManual[] = [];
  for (const r of forTool) {
    const url = pickPdfUrl(r);
    if (!url) {
      if (r.fields.url) {
        console.info(`[chat] skipping non-PDF resource: ${r.fields.title} (${r.fields.url})`);
      }
      continue;
    }
    if (manuals.length >= MAX_PDFS_PER_CHAT) {
      console.info(`[chat] PDF cap reached (${MAX_PDFS_PER_CHAT}); skipping: ${r.fields.title}`);
      continue;
    }
    manuals.push({ title: r.fields.title || "Manual", url });
  }
  return manuals;
}

function attachManualsToFirstUserMessage(
  messages: ModelMessage[],
  manuals: AttachedManual[]
): ModelMessage[] {
  if (manuals.length === 0) return messages;
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return messages;

  const fileParts: FilePart[] = manuals.map((m) => ({
    type: "file",
    mediaType: "application/pdf",
    data: new URL(m.url),
    filename: `${m.title}.pdf`,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  }));

  const target = messages[firstUserIdx] as UserModelMessage;
  const existing = target.content;
  const existingParts: (TextPart | FilePart)[] = Array.isArray(existing)
    ? (existing.filter((p) => p.type === "text" || p.type === "file") as (TextPart | FilePart)[])
    : [{ type: "text", text: String(existing ?? "") }];

  const updated: UserModelMessage = {
    role: "user",
    content: [...fileParts, ...existingParts],
  };
  return [...messages.slice(0, firstUserIdx), updated, ...messages.slice(firstUserIdx + 1)];
}

function buildSystemPrompt(
  tools: MakerLabTool[],
  focused: MakerLabTool | null,
  manuals: AttachedManual[] = []
): string {
  const sections: string[] = [
    "You are the MakerLab Assistant — a friendly, knowledgeable helper for students using the Cornell Tech MakerLab. Answer questions about lab tools, training requirements, safety, materials, and which machines are right for a given project. Be concise, accurate, and grounded only in the catalog provided below. If the user asks about a tool that isn't in the catalog, say so honestly.",
    `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context). Do not invent slugs — only use slugs from the catalog list.`,
    `## Reporting maintenance issues\n\nYou are a first-line helper, not a ticket-creation machine. Follow this order:\n\n1. **Diagnose conversationally first.** When a student describes a problem, ask a clarifying question or two and walk them through quick fixes they can likely do themselves — swap the filament, re-level the bed, clear a jam, restart the slicer, replace a worn bit, check the e-stop, power-cycle, reseat cables, re-home axes, etc. Start with the simplest plausible fix and escalate from there.\n2. **Recognize when to escalate.** Move toward filing a ticket if: the issue is unsafe, the tool clearly needs staff intervention, the student says they can't fix it, the problem keeps recurring, or the student explicitly asks to log it.\n3. **Proactively offer to log.** Even after a successful self-fix for things staff should know about (jams, low filament, missing parts, anything that affects the next user), gently offer: "Want me to log a quick note so staff knows this happened?" Don't push — just offer.\n4. **Gather details and file.** Once the student agrees (or asks directly), collect: a short title, a clear description of what's wrong and what's already been tried, the affected unit if any, a priority, and the student's name/NetID. If they named a specific unit you don't recognize, call \`get_unit_details\` first to verify it exists. Then call \`report_issue\`. After it succeeds, tell the student the ticket was filed and include the ticket ID. If they only name a tool (not a specific unit), it's fine to file without one — but ask first if they can tell you which unit.\n\nIf the student's message includes a hint like \`[Attached photos: file_upload_id=<id> name=<name>; ...]\`, parse each \`file_upload_id\` and \`name\` pair and pass them as the \`photo_uploads\` argument to \`report_issue\` (do not echo the raw hint back to the student). The IDs are already uploaded to Notion and will be attached to the ticket.\n\nPriority guide: Critical = unsafe or blocks all lab use · High = tool unusable · Medium = degraded performance · Low = cosmetic.`,
    `## Unit details\n\nWhen a student asks about a specific unit ("how is Prusa #1 doing?", "is Form 2 #2 working?", "show me the history on the Trotec"), call \`get_unit_details\` to fetch its live status and recent maintenance history. Surface the status, condition, and a short recap of the most recent log entries.`,
  ];

  if (focused) {
    sections.push(
      `## Active tool context\n\nThe student is currently viewing the **${focused.name}** detail page in the MakerLab catalog. If they use pronouns like "this", "it", "that tool", or "the machine", or ask things like "how do I use it" / "what can I make with this" without naming a tool, assume they are asking about the ${focused.name}. Use the resource links below when relevant — point to the SOP, safety doc, or manual when the student asks how to use, set up, or troubleshoot the tool. Do not wrap "${focused.name}" itself in a tool link — the student is already on its page.\n\n${describeTool(focused)}`
    );
  }

  if (manuals.length > 0) {
    const list = manuals
      .map((m) => `- **${m.title}** — ${m.url}`)
      .join("\n");
    sections.push(
      `## Available manuals\n\nThe following PDF manuals are attached to this conversation as documents — Claude can read both their text and figures directly:\n\n${list}`
    );
  }

  if (focused && focused.links.length > 0) {
    const attachedUrls = new Set(manuals.map((m) => m.url));
    const list = focused.links
      .map((link) => {
        const tag = attachedUrls.has(link.href) ? " (attached)" : "";
        return `- [${link.kind || "Resource"}] ${link.label} — ${link.href}${tag}`;
      })
      .join("\n");
    sections.push(
      `## Resources for this tool\n\nThe following resources are linked from the **${focused.name}** Notion page. Items marked "(attached)" are already inlined above as PDF documents — read them directly. Anything else can be retrieved with the \`web_fetch\` tool.\n\n${list}`
    );
  }

  sections.push(
    `## Fetching resources\n\nUse the \`web_fetch\` tool to read any URL from the "Resources for this tool" list that isn't already attached — HTML SOPs, safety pages, manufacturer guides, etc. Rules:\n\n- Prefer attached PDFs when they exist; do not call \`web_fetch\` on a URL already marked "(attached)".\n- If an attached PDF was expected to answer the question but you can't actually read it (rare — usually means Anthropic's fetch was blocked by the host), call \`web_fetch\` on the same URL as a fallback.\n- Only call \`web_fetch\` on exact URLs that appear in "Resources for this tool". Do not invent URLs or fetch general web pages the student wasn't routed to.`
  );

  sections.push(
    `## Citing sources\n\nWhen you draw on an attached manual or a \`web_fetch\`ed page, cite the source inline as a **markdown link** using the exact URL from the lists above. Two formats:\n\n1. PDF with a known page: \`[Form 4 Manual, p. 14](https://media.formlabs.com/.../-ENUS-Form-4-Manual.pdf#page=14)\` — append \`#page=N\` so browser PDF viewers jump to the page.\n2. HTML page or PDF with no known page: \`[Trotec Speedy 400 SOP](https://...)\`.\n\nDo not invent page numbers or URLs. Always use exact URLs from the lists above.`
  );

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
