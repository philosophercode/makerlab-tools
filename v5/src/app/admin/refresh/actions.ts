"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { can } from "../../../lib/auth/permissions";
import { closeEmptyRefresh, getRefresh } from "../../../lib/data/tool-refreshes";
import { isUuid } from "../../../lib/data/uuid";
import { parseReviewerNote } from "../../../lib/intake/reviewer-note";
import { decideRefresh } from "../../../lib/refresh/decisions";
import { queueRefresh } from "../../../lib/refresh/queue";
import {
  ADMIN_REFRESH_PATH,
  refreshItemPath,
  type DecideRefreshInput,
  type DecideRefreshResult,
  type QueueRefreshInput,
  type QueueRefreshResult,
  type RefreshAgainInput,
} from "./action-result";

/**
 * Refresh research's endpoints (refresh research spec §5, §8).
 *
 * Every one resolves the caller, rate-limits and checks `tools.edit` through
 * `authorizeAdminAction` before it reads anything — a server action is a POST
 * endpoint with a generated name, reachable without the page that offers it.
 * Renaming a published tool also needs `tools.publish`, checked where the
 * accept happens (`lib/refresh/apply.ts`).
 *
 * Inputs are parsed here; refusals are values rendered from
 * `admin.errors.<code>`; a thrown error becomes `failed`.
 */

const SURFACE = "admin/refresh";
const INVENTORY_PATH = "/admin/inventory";

const queueSchema = z.strictObject({
  toolIds: z.array(z.string().refine(isUuid)).min(1).max(1000),
  includeDescription: z.boolean(),
  note: z.string().max(4000).nullable(),
});

/** **Refresh research (N)** on `/admin/inventory` (§5.1). */
export async function queueToolRefresh(input: QueueRefreshInput): Promise<QueueRefreshResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;
  const userId = gate.identity.userId;
  if (!userId) return { ok: false, error: "not_signed_in" };

  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  const note = parseReviewerNote(parsed.data.note);
  if (note === "too_long" || note === "invalid") return { ok: false, error: "invalid_field" };
  // A note is about one machine (§5.1: "available when N = 1").
  if (note !== null && parsed.data.toolIds.length !== 1) return { ok: false, error: "invalid_field" };

  try {
    const outcome = await queueRefresh({
      userId,
      toolIds: parsed.data.toolIds,
      note,
      includeDescription: parsed.data.includeDescription,
    });
    if (!outcome.ok) return outcome;
    revalidatePath(INVENTORY_PATH);
    revalidatePath(ADMIN_REFRESH_PATH);
    return { ok: true, queued: outcome.queued, skipped: outcome.skipped, missing: outcome.missing };
  } catch (error) {
    console.error(`[${SURFACE}] queue failed`, error);
    return { ok: false, error: "failed" };
  }
}

const decideSchema = z.strictObject({
  refreshId: z.string().refine(isUuid),
  rowRevision: z.string().min(1).max(40),
  decision: z.enum(["accept", "reject", "accept_all_verified", "reject_all"]),
  ids: z.array(z.string().min(1).max(2100)).max(60).optional(),
});

/** Accept, Reject, Accept all verified, Reject all (§5.2). */
export async function decideRefreshProposals(input: DecideRefreshInput): Promise<DecideRefreshResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;
  const userId = gate.identity.userId;
  if (!userId) return { ok: false, error: "not_signed_in" };
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };

  try {
    const outcome = await decideRefresh(parsed.data, { userId, canPublish: can(gate.identity, "tools.publish") });
    revalidatePath(refreshItemPath(parsed.data.refreshId));
    revalidatePath(ADMIN_REFRESH_PATH);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    revalidatePath(INVENTORY_PATH);
    return { ok: true, applied: outcome.applied, ...(outcome.warning ? { warning: outcome.warning } : {}) };
  } catch (error) {
    console.error(`[${SURFACE}] decision failed`, error);
    return { ok: false, error: "failed" };
  }
}

const againSchema = z.strictObject({
  refreshId: z.string().refine(isUuid),
  note: z.string().max(4000).nullable(),
  includeDescription: z.boolean(),
});

/**
 * **Refresh again** (§5.2, §5.3): close this refresh — its decided cards stay
 * recorded, its undecided ones are left undecided — and queue a new one for the
 * same tool, with the note. A refresh still running cannot be redone.
 */
export async function refreshAgain(input: RefreshAgainInput): Promise<QueueRefreshResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;
  const userId = gate.identity.userId;
  if (!userId) return { ok: false, error: "not_signed_in" };
  const parsed = againSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  const note = parseReviewerNote(parsed.data.note);
  if (note === "too_long" || note === "invalid") return { ok: false, error: "invalid_field" };

  try {
    const refresh = await getRefresh(parsed.data.refreshId);
    if (!refresh) return { ok: false, error: "not_found" };
    if (refresh.status === "queued" || refresh.status === "researching") return { ok: false, error: "not_editable" };
    if (refresh.status === "proposed") await closeEmptyRefresh(refresh.id, userId);

    const outcome = await queueRefresh({
      userId,
      toolIds: [refresh.toolId],
      note,
      includeDescription: parsed.data.includeDescription,
    });
    revalidatePath(ADMIN_REFRESH_PATH);
    revalidatePath(refreshItemPath(refresh.id));
    if (!outcome.ok) return outcome;
    return { ok: true, queued: outcome.queued, skipped: outcome.skipped, missing: outcome.missing };
  } catch (error) {
    console.error(`[${SURFACE}] refresh again failed`, error);
    return { ok: false, error: "failed" };
  }
}
