import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { feedback, tools } from "../db/schema/index.ts";
import { FEEDBACK_STATUS, isOneOf, type FlagField } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { rankByVocabulary } from "./rank.ts";
import { isUuid } from "./uuid.ts";

/**
 * Catalogue corrections on Postgres (spec §3.10, §4.9).
 *
 * This is the module §3.10 names as the replacement for the raw Notion `fetch`
 * that used to live inside `capabilities/flags.ts`. The capability keeps the
 * validation and the row building — both pure, both unit-tested — and this
 * module is the only thing that touches the table.
 *
 * A correction is **inert by construction** (spec §8): nothing here writes to
 * the catalogue. A report is inserted, listed for a person holding
 * `feedback.manage`, and marked reviewed, fixed or dismissed — and that is the
 * whole of it. Changing the tool the correction is about happens in the tool
 * editor, by somebody who read the report and decided. There is no code path
 * from a student's sentence to a catalogue field, and Phase 5's queue is
 * deliberately not one.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/** One correction, in the column shape the table takes. */
export interface NewFeedback {
  /** The tool the report is about, or null when it could not be resolved. */
  toolId: string | null;
  fieldFlagged: FlagField | null;
  issueDescription: string;
  suggestedFix?: string | null;
  reporterName?: string | null;
  /** **Session only.** No request field reaches this, by design. */
  reporterEmail?: string | null;
  reporterUserId?: string | null;
}

export interface FeedbackWriteOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * File one correction, open (`status: "new"`) for staff to triage.
 *
 * A `tool_id` that is not uuid-shaped is stored as null rather than passed to a
 * uuid column, which would answer a cast error: a correction staff have to
 * match up by hand still beats one that never arrived (Article 4).
 *
 * Throws on a database failure; the caller turns that into the opaque
 * `write_failed` the surfaces already know how to report.
 */
export async function createFeedback(
  row: NewFeedback,
  options: FeedbackWriteOptions = {}
): Promise<{ id: string }> {
  const db = options.db ?? (await getDb());

  const [created] = await db
    .insert(feedback)
    .values({
      toolId: row.toolId && isUuid(row.toolId) ? row.toolId : null,
      fieldFlagged: row.fieldFlagged,
      issueDescription: row.issueDescription,
      suggestedFix: row.suggestedFix || null,
      reporterName: row.reporterName || null,
      reporterEmail: row.reporterEmail || null,
      reporterUserId: row.reporterUserId || null,
      status: "new",
      // Null for an anonymous report, which stays the intended default (§8).
      createdBy: row.reporterUserId || null,
      updatedBy: row.reporterUserId || null,
    })
    .returning({ id: feedback.id });

  return { id: created.id };
}

// ── The queue (spec §5.6) ───────────────────────────────────────────

/**
 * One correction as `/admin/corrections` works it.
 *
 * **Stored values, not display text.** `field_flagged` is `safety_info` here
 * and becomes "Safety info" through `next-intl` on the page (Article 6), so the
 * words a reviewer reads are translatable and the value posted back is the one
 * the CHECK constraint accepts.
 *
 * `toolSlug` is what makes the queue's promise true: an accepted correction has
 * to be one click from the field it corrects, and the tool's own page is where
 * that field is — with the editor a click away on it for anybody holding
 * `tools.edit` (§5.3(b)). A correction whose tool never resolved carries null
 * and says so instead of linking nowhere.
 */
export interface FeedbackQueueEntry {
  id: string;
  toolId: string | null;
  toolSlug: string | null;
  toolName: string;
  /** One of `FLAG_FIELDS`, or null when the report named no field. */
  fieldFlagged: string | null;
  issueDescription: string;
  suggestedFix: string;
  reporterName: string;
  /**
   * The reporter's address, on this projection only.
   *
   * The same deliberate exception `listMaintenanceQueue` makes, for the same
   * reason and with the same limit: one caller, gated on `feedback.manage`, and
   * a correction that needs a question asked is useless without a way to ask
   * it. It reaches the page and nothing else — not a prompt, not the mirror,
   * not a log line (§8).
   */
  reporterEmail: string;
  /** One of `FEEDBACK_STATUS`. */
  status: string;
  createdAt: Date;
}

export interface FeedbackQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** How many corrections to read. */
  limit?: number;
}

/**
 * Bounded like every read here (Article 4). Corrections arrive a few a week;
 * two hundred is a year of them, and the page filters within what it has.
 */
const QUEUE_LIMIT = 200;

/**
 * Untriaged first, then the order `FEEDBACK_STATUS` is declared in — new,
 * reviewed, fixed, dismissed, which is the order the work moves through.
 */
const STATUS_RANK = rankByVocabulary(feedback.status, FEEDBACK_STATUS);

/**
 * Every correction, the unhandled ones first (spec §5.6).
 *
 * `FEEDBACK_STATUS` is declared in the order the work moves through — new,
 * reviewed, fixed, dismissed — so ranking by its index puts what nobody has
 * looked at yet at the top, and a value added to the vocabulary later sorts
 * where it was declared rather than silently last.
 *
 * Handled corrections stay in the list because dismissing one is a judgement
 * somebody may want to revisit, and because "has this been reported before" is
 * the question a duplicate report raises. One statement, tool joined in.
 */
export async function listFeedbackQueue(
  options: FeedbackQueryOptions = {}
): Promise<FeedbackQueueEntry[]> {
  const db = options.db ?? (await getDb());

  const rows = await db
    .select({
      id: feedback.id,
      toolId: feedback.toolId,
      toolSlug: tools.slug,
      toolName: tools.name,
      fieldFlagged: feedback.fieldFlagged,
      issueDescription: feedback.issueDescription,
      suggestedFix: feedback.suggestedFix,
      reporterName: feedback.reporterName,
      reporterEmail: feedback.reporterEmail,
      status: feedback.status,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .leftJoin(tools, eq(feedback.toolId, tools.id))
    .orderBy(STATUS_RANK, desc(feedback.createdAt))
    .limit(options.limit ?? QUEUE_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    toolId: row.toolId,
    toolSlug: row.toolSlug,
    toolName: row.toolName || "",
    fieldFlagged: row.fieldFlagged,
    issueDescription: row.issueDescription,
    suggestedFix: row.suggestedFix || "",
    reporterName: row.reporterName || "",
    reporterEmail: row.reporterEmail || "",
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** Triaging one correction: what the page may set it to. */
export type FeedbackWriteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "invalid_field" };

/**
 * Mark one correction reviewed, fixed or dismissed (spec §5.6).
 *
 * The status is the whole write: a correction is a message, not a record to
 * edit, and rewriting what somebody reported would make the queue a worse
 * record than the inbox it replaced. Fixing the *catalogue* happens in the tool
 * editor, which is what the row links to.
 *
 * Checked against `FEEDBACK_STATUS` here rather than by `feedback_status_check`,
 * which refuses the whole statement with a message no page can render.
 *
 * Throws on a database failure; the caller reports that as `failed`.
 */
export async function updateFeedbackStatus(
  feedbackId: string,
  status: string,
  options: FeedbackWriteOptions & { actorUserId?: string | null } = {}
): Promise<FeedbackWriteResult> {
  if (!isUuid(feedbackId)) return { ok: false, reason: "not_found" };
  if (!isOneOf(FEEDBACK_STATUS, status)) return { ok: false, reason: "invalid_field" };

  const db = options.db ?? (await getDb());
  const rows = await db
    .update(feedback)
    .set({ status, updatedBy: options.actorUserId ?? null })
    .where(eq(feedback.id, feedbackId))
    .returning({ id: feedback.id });

  return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
