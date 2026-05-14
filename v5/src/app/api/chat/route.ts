import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import type { MakerLabTool } from "../../../components/catalog-types";

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  toolId?: string;
}

export async function POST(req: Request) {
  const { messages, toolId }: ChatRequest = await req.json();
  const system = await buildSystemPrompt(toolId);

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}

async function buildSystemPrompt(toolId?: string): Promise<string> {
  const tools = await getCatalogTools();
  const focused = toolId ? await getCatalogTool(toolId) : null;

  const sections: string[] = [
    "You are the MakerLab Assistant — a friendly, knowledgeable helper for students using the Cornell Tech MakerLab. Answer questions about lab tools, training requirements, safety, materials, and which machines are right for a given project. Be concise, accurate, and grounded only in the catalog provided below. If the user asks about a tool that isn't in the catalog, say so honestly.",
    `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context). Do not invent slugs — only use slugs from the catalog list.`,
  ];

  if (focused) {
    sections.push(
      `## Active tool context\n\nThe student is currently viewing the **${focused.name}** detail page in the MakerLab catalog. If they use pronouns like "this", "it", "that tool", or "the machine", or ask things like "how do I use it" / "what can I make with this" without naming a tool, assume they are asking about the ${focused.name}. Use the resource links below when relevant — point to the SOP, safety doc, or manual when the student asks how to use, set up, or troubleshoot the tool. Do not wrap "${focused.name}" itself in a tool link — the student is already on its page.\n\n${describeTool(focused)}`
    );
  }

  sections.push(`## MakerLab catalog (${tools.length} tools)`);
  sections.push(
    tools
      .map(
        (tool) =>
          `- **${tool.name}** — slug: \`${tool.slug}\` — ${tool.category}${tool.categorySub ? ` / ${tool.categorySub}` : ""} · ${tool.location}${tool.zone ? ` / ${tool.zone}` : ""} · ${tool.trainingLevel}`
      )
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
  if (tool.links.length) {
    lines.push("- Resources:");
    for (const link of tool.links) {
      lines.push(`  - ${link.kind || "Resource"}: ${link.label} — ${link.href}`);
    }
  }
  return lines.join("\n");
}
