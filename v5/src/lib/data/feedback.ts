import { getDb } from "../db/client.ts";
import { feedback } from "../db/schema/index.ts";
import type { FlagField } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Catalogue corrections on Postgres (spec §3.10, §4.9).
 *
 * This is the module §3.10 names as the replacement for the raw Notion `fetch`
 * that used to live inside `capabilities/flags.ts`. The capability keeps the
 * validation and the row building — both pure, both unit-tested — and this
 * module is the only thing that touches the table.
 *
 * A correction is **inert by construction** (spec §8): the only statement here
 * is an insert into `feedback`. There is no code path from a student's report
 * to the catalogue; that runs through a person on `/admin/corrections`.
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
