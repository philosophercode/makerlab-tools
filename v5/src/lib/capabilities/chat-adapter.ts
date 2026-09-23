import { tool, type Tool } from "ai";
import type {
  Capability,
  CapabilityCtx,
  CapabilityTool,
  PromptEnv,
} from "./types";
import { languageNameForLocale } from "../../i18n/config";
import { siteConfig } from "../site-config";
import type { MakerLabTool } from "../../components/catalog-types";

/**
 * Chat adapter (design spec §3.3). Bridges the surface-agnostic capability
 * registry to the Vercel AI SDK:
 *
 * - {@link toAiTools} wraps each {@link CapabilityTool} in the AI SDK `tool()`
 *   shape. The `execute` runs the tool's `run(input, ctx)` and hands the model
 *   its structured result. A tool that renders a widget writes its own UI part
 *   through `ctx.writer` (intake's `data-intake-table`).
 * - {@link buildSystemPrompt} composes the system prompt by joining the chat
 *   surface's scaffolding (intro, tool-linking, focused-tool context, resource
 *   reading/citing, catalog listing) with each capability's `promptFragment`.
 * - {@link composeChat} is a convenience that returns both at once.
 *
 * Manual (PDF) attachment sections remain owned by the chat route itself — they
 * depend on per-request server-side PDF fetching that has no place in the
 * surface-agnostic prompt env.
 */

/**
 * Convert every capability's tools into a `Record<name, Tool>` for the AI SDK.
 * Each tool returns its full structured result. Tools marked `mcpOnly` are
 * left out.
 */
export function toAiTools(
  capabilities: Capability[],
  ctx: CapabilityCtx
): Record<string, Tool> {
  const aiTools: Record<string, Tool> = {};
  for (const capability of capabilities) {
    for (const capTool of capability.tools) {
      // MCP-only tools are writes the chat reaches another way. Intake's
      // `create_tool` is the one today: in the chat a new tool goes through
      // pending rows, background research and a human approval (spec §5.4),
      // and handing the model a direct write would be a way round all three.
      if (capTool.mcpOnly) continue;
      aiTools[capTool.name] = wrapTool(capTool, ctx);
    }
  }
  return aiTools;
}

/** Wrap a single capability tool in the AI SDK `tool()` shape. */
function wrapTool(
  capTool: CapabilityTool<unknown, unknown>,
  ctx: CapabilityCtx
): Tool {
  return tool({
    description: capTool.description,
    inputSchema: capTool.inputSchema,
    execute: (input: unknown) => capTool.run(input, ctx),
  });
}

/**
 * Compose the chat system prompt: the chat surface scaffolding plus every
 * capability's `promptFragment(env)`, in registry order. Preserves parity with
 * the original chat route prompt (intro, tool-linking, focused-tool context,
 * resource reading/citing, catalog listing) while letting capabilities inject
 * their own instructions (unit lookups, maintenance flow, intake, …).
 */
export function buildSystemPrompt(
  capabilities: Capability[],
  env: PromptEnv
): string {
  const { tools, focusedTool, locale } = env;
  const sections: string[] = [introSection(), linkingSection()];

  for (const capability of capabilities) {
    const fragment = capability.promptFragment(env).trim();
    if (fragment) sections.push(fragment);
  }

  if (locale && locale !== "en") {
    sections.push(languageSection(locale));
  }

  if (focusedTool) {
    sections.push(focusedToolSection(focusedTool));
  }

  if (focusedTool && focusedTool.links.length > 0) {
    sections.push(resourcesSection(focusedTool));
  }

  sections.push(readingSection());
  sections.push(citingSection());
  sections.push(catalogSection(tools));

  return sections.join("\n\n");
}

/**
 * Convenience composer (design spec §3.3): returns the wrapped AI SDK tools and
 * the composed system prompt for a single chat request.
 */
export function composeChat(
  capabilities: Capability[],
  ctx: CapabilityCtx,
  env: PromptEnv
): { tools: Record<string, Tool>; system: string } {
  return {
    tools: toAiTools(capabilities, ctx),
    // The prompt env inherits the request's identity from the ctx, so the route
    // supplies it once and both the tools and the prompt fragments see the same
    // caller. An explicit `env.identity` still wins, for tests and future
    // surfaces that compose a prompt without a ctx.
    system: buildSystemPrompt(capabilities, { identity: ctx.identity, ...env }),
  };
}

// ── Prompt sections (parity with the original chat route) ───────────

function introSection(): string {
  return `You are the ${siteConfig.chatAssistantName} — a friendly, knowledgeable helper for ${siteConfig.audience} using the ${siteConfig.institution} MakerLab. Answer questions about lab tools, training requirements, safety, materials, and which machines are right for a given project. Be concise, accurate, and grounded only in the catalog provided below. If the user asks about a tool that isn't in the catalog, say so honestly.`;
}

function linkingSection(): string {
  return `## Linking tools\n\nWhenever you mention a tool that exists in the catalog below, **format its name as a markdown link** to its detail page using the slug provided in the catalog: \`[Tool Name](/tools/<slug>)\`. This lets the student jump straight to the tool's page. Examples:\n- "You could use the [Bambu Lab X1-Carbon Combo 3D Printer](/tools/<slug>) for that."\n- "For laser cutting acrylic, check the [Epilog Helix 24](/tools/<slug>)."\n\nDo **not** link the tool the student is already viewing (see Active tool context). Do not invent slugs — only use slugs from the catalog list.`;
}

function languageSection(locale: string): string {
  const language = languageNameForLocale(locale);
  return `## Response language\n\nRespond to the student in **${language}**, regardless of the language they write in. Translate your explanations and conversational text into ${language}. However, ALWAYS keep the following in English so MakerLab staff can read them: tool and equipment names (use the exact catalog names), unit labels (e.g. "Prusa #1"), and — critically — the \`title\` and \`description\` you pass to the \`report_issue\` tool when filing a maintenance ticket. Maintenance ticket content must be written in English even though you reply to the student in ${language}.`;
}

function focusedToolSection(focused: MakerLabTool): string {
  return `## Active tool context\n\nThe student is currently viewing the **${focused.name}** detail page in the MakerLab catalog. If they use pronouns like "this", "it", "that tool", or "the machine", or ask things like "how do I use it" / "what can I make with this" without naming a tool, assume they are asking about the ${focused.name}. Use the resource links below when relevant — point to the SOP, safety doc, or manual when the student asks how to use, set up, or troubleshoot the tool. Do not wrap "${focused.name}" itself in a tool link — the student is already on its page.\n\n${describeTool(focused)}`;
}

function resourcesSection(focused: MakerLabTool): string {
  const list = focused.links
    .map((link) => `- [${link.kind || "Resource"}] ${link.label} — ${resourceHref(link.href)}`)
    .join("\n");
  return `## Resources for this tool\n\nThe following resources are linked from the **${focused.name}** catalog entry. Read any web page among them with the \`read_page\` tool when relevant.\n\n${list}\n\n${pointingRule(focused)}`;
}

/**
 * The rule that makes the assistant name the document, not just allude to it
 * (gateway spec amendment "Chat prompt tuning for Luna"). Without it Luna
 * answered "how do I set this up safely?" from the catalog fields and wrote
 * "follow the lab SOP" — true, but it never said which document, and a
 * resource with no link on file read to it as one it could not mention.
 */
function pointingRule(focused: MakerLabTool): string {
  const sop = focused.links.find((link) => /sop/i.test(link.kind ?? ""));
  const example = (sop ?? focused.links[0])?.label ?? `${focused.name} SOP`;
  return `**Point to these by name.** When the student asks how to use, set up, operate, maintain or troubleshoot the ${focused.name}, or how to do it safely, name the matching resource above **by its exact title** in your answer — for example "follow the **${example}**" — not just "the SOP" or "the manual". Link it with its exact URL when it has one; when it says "no link on file", name it by title and tell the student to ask staff for a copy. Never invent a URL for it, and do not claim to know what a resource says unless you have read it.`;
}

/** A resource's URL as the prompt shows it — or a plain note when there is none. */
function resourceHref(href: string | undefined): string {
  return hasUsableUrl(href) ? (href as string) : "no link on file";
}

/**
 * Whether a resource link is a real address the student can open. The demo
 * seed's placeholder `#` (and an empty href) is not: shown raw, it read as a
 * broken link the assistant avoided naming at all.
 */
export function hasUsableUrl(href: string | undefined): boolean {
  return typeof href === "string" && /^(https?:\/\/|\/)/i.test(href.trim()) && href.trim() !== "/";
}

function readingSection(): string {
  return `## Reading resources\n\nUse the \`read_page\` tool to read a URL from the "Resources for this tool" list — HTML SOPs, safety pages, manufacturer guides. Rules:\n\n- Only call \`read_page\` on exact URLs that appear in "Resources for this tool". It refuses every other URL, so do not invent URLs or try general web pages the student wasn't routed to.\n- \`read_page\` returns page text, not PDFs. Manual PDFs reach you as attached documents, when there are any; for a PDF that is not attached, give the student the link rather than guessing what it says.\n- To look something up beyond these resources, use \`exa_search\`.`;
}

function citingSection(): string {
  return `## Citing sources\n\nWhen you draw on an attached manual, a page read with \`read_page\`, or an \`exa_search\` result, cite the source inline as a **markdown link** using its exact URL — from the lists above, or the result's own URL for a search. Three formats:\n\n1. PDF with a known page: \`[Form 4 Manual, p. 14](https://media.formlabs.com/.../-ENUS-Form-4-Manual.pdf#page=14)\` — append \`#page=N\` so browser PDF viewers jump to the page.\n2. HTML page or PDF with no known page: \`[Trotec Speedy 400 SOP](https://...)\`.\n3. A resource with "no link on file": its exact title in bold, \`**Trotec Speedy 400 SOP**\`, with no link.\n\nDo not invent page numbers or URLs. Always use exact URLs from the lists above or from a search result.`;
}

function catalogSection(tools: MakerLabTool[]): string {
  const header = `## MakerLab catalog (${tools.length} tools)`;
  const list = tools
    .map((t) => {
      const head = `- **${t.name}** — slug: \`${t.slug}\` — ${t.category}${t.categorySub ? ` / ${t.categorySub}` : ""} · ${t.location}${t.zone ? ` / ${t.zone}` : ""} · ${t.trainingLevel}`;
      if (!t.units.length) return head;
      const units = t.units.map((unit) => `${unit.name} [${unit.status}]`).join(", ");
      return `${head}\n  units: ${units}`;
    })
    .join("\n");
  return `${header}\n\n${list}`;
}

/** Full multi-line description of the focused tool (parity with the route). */
function describeTool(t: MakerLabTool): string {
  const lines: string[] = [
    `**${t.name}**`,
    `- Category: ${t.category}${t.categorySub ? ` / ${t.categorySub}` : ""}`,
    `- Location: ${t.location}${t.zone ? ` / ${t.zone}` : ""}`,
    `- Training: ${t.trainingLabel} (level: ${t.trainingLevel})`,
  ];
  if (t.materials.length) lines.push(`- Materials: ${t.materials.join(", ")}`);
  if (t.ppe.length) lines.push(`- PPE: ${t.ppe.join(", ")}`);
  if (t.useRestrictions) lines.push(`- Restrictions: ${t.useRestrictions}`);
  if (t.emergencyStop) lines.push(`- Emergency stop: ${t.emergencyStop}`);
  if (t.description) lines.push(`- Description: ${t.description}`);
  if (t.units.length) {
    lines.push("- Units:");
    for (const unit of t.units) {
      lines.push(
        `  - ${unit.name} — status: ${unit.status}, condition: ${unit.condition}${unit.serial && unit.serial !== "Unlisted" ? `, serial: ${unit.serial}` : ""}`
      );
    }
  }
  if (t.links.length) {
    lines.push("- Resources:");
    for (const link of t.links) {
      lines.push(`  - ${link.kind || "Resource"}: ${link.label} — ${resourceHref(link.href)}`);
    }
  }
  return lines.join("\n");
}
