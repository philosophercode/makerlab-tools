import { z } from "zod";
import { approvalRefusal } from "../actions/intake";
import { can } from "../auth/permissions";
import { listUncategorizedTools, listUnitLabels } from "../data/cleanup";
import { listPendingTools } from "../data/pending-tools";
import { suggestedCategory } from "../intake/approval-draft";
import { imageVerdict } from "../intake/image-verdict";
import { listCategoriesForChoosing } from "../taxonomy/seed";
import { fenceUntrusted, OTHERS_TEXT_NOTE } from "../web/fence";
import type { Capability, CapabilityTool, PromptEnv } from "./types";

/**
 * The assistant's cleanup reads (assistant cleanup spec 2026-10-28 §3–§4):
 * after a bulk import there are loose ends — tools with no category, unit
 * labels in three styles, a review queue to work through. Each read lists one
 * kind of loose end with what the assistant needs to group it into proposal
 * cards (`recategorize_tool`, `rename_units`, `approve_pending_items`), and
 * the prompt fragment is the playbook for "help me clean up".
 *
 * Chat only: they are the triage half of a conversation whose other half is
 * the cards. Reads only — nothing here changes anything.
 *
 * - `list_uncategorized_tools` — `tools.edit`. Each tool with research's
 *   category **only when it names a live category** (so the line carries the
 *   lab's own words, never research's free text). Catalogue data: not fenced.
 * - `list_unit_labels` — `tools.edit`. Staff's own entries: not fenced.
 * - `review_approval_queue` — `tools.approve`. Item names came from imported
 *   lists and research, so the list is fenced and reading it taints the turn
 *   (`OUTSIDE_CONTENT_TOOLS`). Each item's photo verdict is computed in code
 *   from the vision ranking research stored (`intake/image-verdict.ts`).
 */

const MAX_SHOWN = 200;

// ── list_uncategorized_tools ────────────────────────────────────────

interface UncategorizedResult {
  total: number;
  shown: number;
  tools: { id: string; slug: string; name: string; official_name: string | null; state: "published" | "draft"; suggested_category: string | null }[];
}

const listUncategorizedToolsTool: CapabilityTool<Record<string, never>, UncategorizedResult> = {
  name: "list_uncategorized_tools",
  description:
    "List the catalogue's tools that have no category (archived ones left out): each one's id, slug, name, official name, published or draft, and — when research or the imported list named one of the lab's categories — that category's slug as suggested_category. Staff who edit the catalogue only. Pair with list_categories, then move them with recategorize_tool, one card per category.",
  inputSchema: z.strictObject({}),
  kind: "read",
  chatOnly: true,
  requiredPermission: "tools.edit",
  run: async () => {
    const [found, categories] = await Promise.all([listUncategorizedTools(), listCategoriesForChoosing()]);
    const slugOf = new Map(categories.map((category) => [category.id, category.slug ?? null]));
    const shown = found.slice(0, MAX_SHOWN);
    return {
      total: found.length,
      shown: shown.length,
      tools: shown.map((tool) => {
        const id = tool.research ? suggestedCategory(tool.research, tool.categoryHint, categories) : "";
        return {
          id: tool.id,
          slug: tool.slug,
          name: tool.name,
          official_name: tool.officialName,
          state: tool.published ? "published" : "draft",
          suggested_category: (id && slugOf.get(id)) || null,
        };
      }),
    };
  },
};

// ── list_unit_labels ────────────────────────────────────────────────

interface UnitLabelsResult {
  tools: number;
  units: number;
  groups: { tool_id: string; tool_slug: string; tool_name: string; units: { id: string; label: string; status: string }[] }[];
}

const listUnitLabelsTool: CapabilityTool<{ tool_ids?: string[] }, UnitLabelsResult> = {
  name: "list_unit_labels",
  description:
    "List the units (each physical machine) of every tool not archived, grouped by tool, with each unit's id, label and status — retired units left out — so labels can be made consistent across the lab. Optionally only some tools. Staff who edit the catalogue only. Rename with rename_units (up to 20 per card).",
  inputSchema: z.strictObject({
    tool_ids: z.array(z.string().min(1).max(200)).max(50).optional().describe("Only these tools (ids or slugs); all when left out"),
  }),
  kind: "read",
  chatOnly: true,
  requiredPermission: "tools.edit",
  run: async (input) => {
    const wanted = input.tool_ids?.length ? new Set(input.tool_ids.map((id) => id.trim().toLowerCase())) : null;
    const groups = (await listUnitLabels()).filter((group) => !wanted || wanted.has(group.toolId) || wanted.has(group.toolSlug.toLowerCase()));
    const shown = groups.slice(0, MAX_SHOWN);
    return {
      tools: groups.length,
      units: groups.reduce((sum, group) => sum + group.units.length, 0),
      groups: shown.map((group) => ({ tool_id: group.toolId, tool_slug: group.toolSlug, tool_name: group.toolName, units: group.units })),
    };
  },
};

// ── review_approval_queue ───────────────────────────────────────────

interface ReviewQueueResult {
  total: number;
  ready_to_approve: number;
  items: string;
}

/** Why an item cannot be approved from a card, in words. */
const BLOCKED: Record<string, string> = {
  not_editable: "not researched yet",
  unresolved_duplicate: "possible duplicate to decide on its page",
  low_confidence: "low confidence: needs the reviewer's own note on its page",
};

const reviewApprovalQueueTool: CapabilityTool<Record<string, never>, ReviewQueueResult> = {
  name: "review_approval_queue",
  description:
    "Triage the items waiting for approval (researched intake and import items): each one's id, name, research confidence, whether a card can approve it, the category approval would give it, and a photo verdict — good (research's vision check found a clean front or three-quarter photo of the whole product), check (with reasons: a banner, a back view, small, busy background, an uploaded photo nobody judged) or none. Names are fenced as untrusted text. Staff who approve equipment only. Approve the ready ones with approve_pending_items; list the rest for the person.",
  inputSchema: z.strictObject({}),
  kind: "read",
  chatOnly: true,
  requiredPermission: "tools.approve",
  run: async () => {
    const [items, categories] = await Promise.all([listPendingTools({ statuses: ["researched"], limit: MAX_SHOWN }), listCategoriesForChoosing()]);
    const labelOf = new Map(categories.map((category) => [category.id, category.group ? `${category.group} › ${category.name}` : category.name]));
    let ready = 0;
    const lines = items.map((item) => {
      const refusal = approvalRefusal(item);
      const photo = imageVerdict(item.research?.images, item.photos);
      const categoryId = item.research ? suggestedCategory(item.research, item.categoryHint, categories) : "";
      const approvable = !refusal;
      if (approvable && photo.verdict === "good") ready += 1;
      return [
        `- id: ${item.id} · ${oneLine(item.name, 120)} · confidence: ${item.research?.confidence.level ?? "?"}`,
        `  card can approve: ${approvable ? "yes" : `no (${BLOCKED[refusal ?? ""] ?? refusal})`} · category on approval: ${categoryId ? labelOf.get(categoryId) : "(none)"}`,
        `  photo: ${photo.verdict} — ${photo.reasons.join("; ")}`,
        `  review page: /admin/intake/${item.id}`,
      ].join("\n");
    });
    return {
      total: items.length,
      ready_to_approve: ready,
      items: fenceUntrusted("items waiting for approval (names from imported lists and research)", lines.join("\n") || "(none waiting)", OTHERS_TEXT_NOTE),
    };
  },
};

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── The playbook ────────────────────────────────────────────────────

export function cleanupPromptFragment(env: PromptEnv): string {
  if (!env.identity || !can(env.identity, "tools.edit")) return "";
  const approve = can(env.identity, "tools.approve");
  return `## Cleaning up the catalogue (triage)

When the person asks you to clean up, triage, tidy or sort out the catalogue — after an import, "give everything a category", "fix the unit names", "approve the ones that look good" — work through it in batches:

1. **Read first.** \`list_uncategorized_tools\` with \`list_categories\` for categories; \`list_unit_labels\` for unit names${approve ? "; `review_approval_queue` for the items waiting for approval" : ""}. Never guess ids.
2. **Group and propose.** Here several cards in one reply are right: one card per distinct change, up to 20 rows each. Categories: one \`recategorize_tool\` call per target category, using \`suggested_category\` when given and otherwise the category whose description fits best; a tool that fits none goes in your list, or \`propose_category\` when several share a gap. Unit names: pick the style most units already use (for example "Prusa MK4 #1") and \`rename_units\` only the units that differ — never rename one that already fits.${approve ? ` Approvals: \`approve_pending_items\` (publish: true unless the person said drafts) **only** for items with "card can approve: yes" and "photo: good".` : ""}
3. **Report the rest.** End with a short list of what you did not propose and why (${approve ? "photo to check, low confidence, possible duplicate, " : ""}no category fits), each with its page link, so the person can look at those themselves.

Keep the reply short: one line per card, then the list. Nothing changes until the person confirms each card.`;
}

export const cleanup: Capability = {
  id: "cleanup",
  promptFragment: cleanupPromptFragment,
  tools: [
    listUncategorizedToolsTool as unknown as CapabilityTool<unknown, unknown>,
    listUnitLabelsTool as unknown as CapabilityTool<unknown, unknown>,
    reviewApprovalQueueTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
