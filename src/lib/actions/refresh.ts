import "server-only";

import { z } from "zod";
import { INVENTORY_PATH } from "../../app/admin/inventory/action-result";
import { ADMIN_REFRESH_PATH, type RefreshWriteError } from "../../app/admin/refresh/action-result";
import { toolSubjects } from "../data/action-subjects";
import { isUuid } from "../data/uuid";
import { REVIEWER_NOTE_MAX_CHARS } from "../intake/limits";
import { parseReviewerNote } from "../intake/reviewer-note";
import { queueRefresh } from "../refresh/queue";
import { allowanceLeft } from "./allowance";
import { defineAction, toolShape } from "./define";
import { MAX_BATCH } from "./tool-args";

/**
 * **Refresh research (N)** on `/admin/inventory` (refresh research spec §5.1;
 * assistant–GUI parity spec §4.5 #37, §9 phase 5). Moved from
 * `app/admin/refresh/actions.ts`'s `queueToolRefresh`.
 *
 * `tools.edit`. Research runs again over catalogue tools and comes back as
 * proposals a person decides on `/admin/refresh` — nothing reaches the
 * catalogue from here. It **spends** the research allowance, so for the
 * assistant it is a card with the person's click and never over MCP
 * (§11 answer 3); the allowance is checked at the click, in `queueRefresh`,
 * exactly as for the button.
 */

const input = z.strictObject({
  toolIds: z.array(z.string().refine(isUuid)).min(1).max(1000),
  includeDescription: z.boolean(),
  note: z.string().max(4000).nullable(),
});

export const REFRESH_QUEUE = defineAction<z.infer<typeof input>, { queued: number; skipped: number; missing: number }, RefreshWriteError>({
  id: "refresh.queue",
  toolName: "queue_refresh",
  description:
    "Research catalogue tools again for newer facts, links and images; the results come back as proposals to review on /admin/refresh. Costs one research item per tool from today's allowance. Proposes the run; nothing starts until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "spend",
  input,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolIds[0] ?? "" }),
  tool: toolShape(
    z.strictObject({
      tool_ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BATCH).describe("The tools' ids, from search_tools or the page's selection"),
      include_description: z.boolean().optional().describe("Also propose a new description (default false: facts, links and images only)"),
      note: z.string().max(REVIEWER_NOTE_MAX_CHARS).optional().describe("One line for research, one tool only — only if the person gave one"),
    }),
    (args) => ({
      ok: true,
      inputs: [{ toolIds: [...new Set(args.tool_ids)], includeDescription: args.include_description ?? false, note: args.note ?? null }],
    })
  ),
  preview: async (input, ctx) => {
    const tools = await toolSubjects(input.toolIds);
    if (tools.length === 0) return null;
    const names = tools.map((tool) => tool.name).join(", ");
    return {
      summary: { key: "refresh_queue", values: { count: tools.length, left: await allowanceLeft(ctx) } },
      rows: [
        { field: "tools", before: null, after: names },
        ...(input.note ? [{ field: "researchNote", before: null, after: input.note }] : []),
      ],
      subjectName: names,
      link: ADMIN_REFRESH_PATH,
    };
  },
  run: async (input, ctx) => {
    const userId = ctx.identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    const note = parseReviewerNote(input.note);
    if (note === "too_long" || note === "invalid") return { ok: false, error: "invalid_field" };
    // A note is about one machine (§5.1: "available when N = 1").
    if (note !== null && input.toolIds.length !== 1) return { ok: false, error: "invalid_field" };
    const outcome = await queueRefresh({ userId, toolIds: input.toolIds, note, includeDescription: input.includeDescription });
    if (!outcome.ok) return outcome;
    return { ok: true, value: { queued: outcome.queued, skipped: outcome.skipped, missing: outcome.missing }, committed: true };
  },
  revalidate: [INVENTORY_PATH, ADMIN_REFRESH_PATH],
});
