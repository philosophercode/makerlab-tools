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
 *   shape. The `execute` runs the tool's `run(input, ctx)`. When the tool
 *   declares a `card`, the adapter emits a `data-card` UI part through
 *   `ctx.writer` after `run()` resolves so the client renders an interactive
 *   widget, then hands the model a compact text result instead of the full
 *   payload.
 * - {@link buildSystemPrompt} composes the system prompt by joining the chat
 *   surface's scaffolding (intro, tool-linking, focused-tool context, resource
 *   fetching/citing, catalog listing) with each capability's `promptFragment`.
 * - {@link composeChat} is a convenience that returns both at once.
 *
 * Manual (PDF) attachment sections remain owned by the chat route itself — they
 * depend on per-request server-side PDF fetching that has no place in the
 * surface-agnostic prompt env.
 */

/**
 * Convert every capability's tools into a `Record<name, Tool>` for the AI SDK.
 * Tools with a `card` emit a `data-card` part via `ctx.writer` and return a
 * compact acknowledgement to the model; tools without a card return their full
 * structured result.
 */
export function toAiTools(
  capabilities: Capability[],
  ctx: CapabilityCtx
): Record<string, Tool> {
  const aiTools: Record<string, Tool> = {};
  for (const capability of capabilities) {
    for (const capTool of capability.tools) {
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
    execute: async (input: unknown) => {
      const result = await capTool.run(input, ctx);
      if (capTool.card) {
        const card = capTool.card(result);
        if (ctx.writer) {
          ctx.writer.write({ type: "data-card", data: card });
        }
        return compactCardResult(card, result);
      }
      return result;
    },
  });
}

/**
 * Build the compact text/object result returned to the model for a card-bearing
 * tool. The full card payload is rendered client-side via the streamed
 * `data-card` part, so the model only needs a short, structured summary it can
 * reason about (and reference when proposing the next step).
 */
function compactCardResult(
  card: ReturnType<NonNullable<CapabilityTool["card"]>>,
  result: unknown
): unknown {
  // Identification cards (the only card kind today) summarize to a compact
  // object the model can act on without re-deriving from the raw result.
  if (card.kind === "identification") {
    return {
      card_rendered: true,
      kind: card.kind,
      candidate_id: card.candidateId,
      state: card.state,
      name: card.name,
      category: card.category,
      location: card.location,
      duplicate_of: card.duplicateOf ?? null,
      draft_url: card.draftUrl,
      also_creating: card.alsoCreating.map((row) => ({
        label: row.label,
        entity: row.entity,
        is_new: row.isNew,
      })),
    };
  }
  // Unknown future card kinds: acknowledge and fall back to the raw result so
  // nothing is silently dropped from the model's view.
  return { card_rendered: true, result };
}

/**
 * Compose the chat system prompt: the chat surface scaffolding plus every
 * capability's `promptFragment(env)`, in registry order. Preserves parity with
 * the original chat route prompt (intro, tool-linking, focused-tool context,
 * resource fetching/citing, catalog listing) while letting capabilities inject
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

  sections.push(fetchingSection());
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
    system: buildSystemPrompt(capabilities, env),
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
    .map((link) => `- [${link.kind || "Resource"}] ${link.label} — ${link.href}`)
    .join("\n");
  return `## Resources for this tool\n\nThe following resources are linked from the **${focused.name}** Notion page. Retrieve any of them with the \`web_fetch\` tool when relevant.\n\n${list}`;
}

function fetchingSection(): string {
  return `## Fetching resources\n\nUse the \`web_fetch\` tool to read any URL from the "Resources for this tool" list — HTML SOPs, safety pages, manufacturer guides, manual PDFs, etc. Rules:\n\n- Only call \`web_fetch\` on exact URLs that appear in "Resources for this tool" (or, during intake, on product/manual URLs the student supplied). Do not invent URLs or fetch general web pages the student wasn't routed to.`;
}

function citingSection(): string {
  return `## Citing sources\n\nWhen you draw on a \`web_fetch\`ed page, cite the source inline as a **markdown link** using the exact URL from the lists above. Two formats:\n\n1. PDF with a known page: \`[Form 4 Manual, p. 14](https://media.formlabs.com/.../-ENUS-Form-4-Manual.pdf#page=14)\` — append \`#page=N\` so browser PDF viewers jump to the page.\n2. HTML page or PDF with no known page: \`[Trotec Speedy 400 SOP](https://...)\`.\n\nDo not invent page numbers or URLs. Always use exact URLs from the lists above.`;
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
      lines.push(`  - ${link.kind || "Resource"}: ${link.label} — ${link.href}`);
    }
  }
  return lines.join("\n");
}
