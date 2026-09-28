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

export type GapDecisionError = "not_found";

export interface GapSubject {
  id: string;
  question: string;
  status: string;
  toolId: string | null;
  toolName: string | null;
  occurrences: number;
}

export async function getGapSubject(id: string, options: { db?: Db } = {}): Promise<GapSubject | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const rows = (await db.execute(
    sql`select g.id, g.question, g.status, g.tool_id, t.name as tool_name, g.occurrences
          from usage_gaps g left join tools t on t.id = g.tool_id
         where g.id = ${id}`
  )) as unknown as { rows: Record<string, unknown>[] };
  const row = rows.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    question: String(row.question),
    status: String(row.status),
    toolId: (row.tool_id as string | null) ?? null,
    toolName: (row.tool_name as string | null) ?? null,
    occurrences: Number(row.occurrences ?? 0),
  };
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
        issueDescription: `Unanswered in the assistant: ${gap.question}`,
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
