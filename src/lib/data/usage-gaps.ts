import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { feedback } from "../db/schema/feedback.ts";
import { usageGaps } from "../db/schema/usage.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * The two decisions a person makes about an unanswered question (usage
 * insight spec §7): **dismiss** it, or **file** it as a correction for the
 * catalogue. Relative imports with `.ts` extensions, no `"server-only"`, like
 * every module under `src/lib/data/`.
 *
 * Filing writes an ordinary `feedback` row — the tool, the scrubbed question
 * as `issue_description`, no reporter (nobody is recorded as having asked),
 * `new` — so it lands on `/admin/corrections` unchanged, and marks the gap
 * `filed` with the correction's id, in one transaction. The correction then
 * outlives the gap's 30 days, because a staff member decided to keep it.
 *
 * `decided_by` is the staff member, never the student.
 */

type GapDecisionError = "not_found";

/**
 * How a correction filed from the Unanswered queue begins. The value report
 * counts those corrections by it (`usage/value/value-queries.ts`), because the
 * gap row itself is deleted 30 days after it was last asked and the
 * correction is what stays.
 */
export const UNANSWERED_CORRECTION_PREFIX = "Unanswered in the assistant: ";

export interface GapSubject {
  id: string;
  question: string;
  status: string;
  toolId: string | null;
  toolName: string | null;
  occurrences: number;
}

export async function dismissGap(
  id: string,
  actorUserId: string | null,
  options: { db?: Db } = {}
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: GapDecisionError }> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  const [row] = await db.select({ status: usageGaps.status }).from(usageGaps).where(eq(usageGaps.id, id));
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "dismissed") return { ok: true, changed: false };
  await db
    .update(usageGaps)
    .set({ status: "dismissed", dismissedAtOccurrences: sql`${usageGaps.occurrences}`, decidedBy: actorUserId, decidedAt: sql`now()` })
    .where(eq(usageGaps.id, id));
  return { ok: true, changed: true };
}

export async function fileGapCorrection(
  id: string,
  actorUserId: string | null,
  options: { db?: Db } = {}
): Promise<{ ok: true; feedbackId: string; changed: boolean } | { ok: false; reason: GapDecisionError }> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const [gap] = await tx
      .select({ status: usageGaps.status, toolId: usageGaps.toolId, question: usageGaps.question, feedbackId: usageGaps.feedbackId })
      .from(usageGaps)
      .where(eq(usageGaps.id, id))
      .for("update");
    if (!gap) return { ok: false as const, reason: "not_found" as const };
    if (gap.status === "filed" && gap.feedbackId) return { ok: true as const, feedbackId: gap.feedbackId, changed: false };
    const [created] = await tx
      .insert(feedback)
      .values({
        toolId: gap.toolId,
        fieldFlagged: null,
        issueDescription: `${UNANSWERED_CORRECTION_PREFIX}${gap.question}`,
        status: "new",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: feedback.id });
    await tx
      .update(usageGaps)
      .set({ status: "filed", feedbackId: created.id, decidedBy: actorUserId, decidedAt: sql`now()` })
      .where(and(eq(usageGaps.id, id)));
    return { ok: true as const, feedbackId: created.id, changed: true };
  });
}
