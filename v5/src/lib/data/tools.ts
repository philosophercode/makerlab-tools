import { and, eq, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "../db/client.ts";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { revisionEquals, revisionOf, type Revision } from "./revision.ts";
import { starterQuestionsFromEditor } from "../starter-questions.ts";
import { DISPLAY_NAME_MAX, OFFICIAL_NAME_MAX } from "../tool-names.ts";
import { isUuid } from "./uuid.ts";
import type { Refused } from "./write-result.ts";

/**
 * Row-level writes on `tools` — what the tool editor saves (spec §5.3, §4.4).
 *
 * Beside `./catalog.ts` rather than inside it: that module is the public
 * *view* of the catalogue, published-only and shaped for display, and it stays
 * that way. This one reads and writes raw columns for one tool at a time, and
 * sees drafts and archived rows, because the editor's job is exactly the rows
 * the catalogue hides.
 *
 * **Every write is revision-checked.** {@link writeTool} is the single
 * statement underneath all of them: `where id = … and <revision> = <expected>`,
 * with the new token in `returning`. If it matches nothing, nothing was
 * written — and only then does a second statement decide whether the row is
 * gone or somebody else moved it, because that read is wasted work on the
 * common path.
 *
 * **Nothing here is cached and nothing here invalidates a cache.** These
 * modules are loaded by `scripts/` under plain Node, where `next/cache` does
 * not exist; `src/lib/inventory/` composes these writes with invalidation and
 * with the audit trail.
 *
 * **Tools are archived, never deleted** (§5.3, §4.4) — there is deliberately no
 * `deleteTool` here, not even a private one, because maintenance history,
 * project links and printed QR labels all point at rows that must not vanish.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** One tool as the editor loads it, plus the token its save will carry. */
export interface EditableTool {
  id: string;
  slug: string;
  /** The display name (tool display names spec): short, ≤ 40, no part numbers. */
  name: string;
  /** The official name, or null when none is recorded; absent on fixtures from before it. */
  officialName?: string | null;
  description: string | null;
  categoryId: string | null;
  locationId: string | null;
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  notes: string | null;
  /** What to note from the nameplate (refresh research spec §4.1); absent on fixtures from before it. */
  floorCheck?: string | null;
  /** The assistant's starter chips on this tool's page; empty means the generic ones. */
  starterQuestions: string[];
  published: boolean;
  archivedAt: Date | null;
  lastReviewedAt: Date | null;
  lastReviewedBy: string | null;
  /** Hand this back with the save. Opaque — see `./revision.ts`. */
  revision: Revision;
}

/** The fields the editor may change. Deliberately not `slug`, and not state. */
export interface ToolPatch {
  /** The display name: refused (`invalid_field`) when blank or over `DISPLAY_NAME_MAX`. */
  name?: string;
  /** The official name; empty clears it. Refused over `OFFICIAL_NAME_MAX`. */
  officialName?: string | null;
  description?: string | null;
  categoryId?: string | null;
  locationId?: string | null;
  materials?: readonly string[];
  ppeRequired?: readonly string[];
  tags?: readonly string[];
  trainingRequired?: boolean;
  useRestrictions?: string | null;
  emergencyStop?: string | null;
  notes?: string | null;
  /** What to note from the nameplate (refresh research spec §4.1); empty clears it. */
  floorCheck?: string | null;
  /** Up to three; validated by `starterQuestionsFromEditor`, refused (`invalid_field`) rather than cut. */
  starterQuestions?: readonly string[];
}

/** What every write here answers. A refusal means nothing was written. */
export type ToolWriteResult =
  | { ok: true; revision: Revision }
  | Refused<"conflict" | "not_found" | "invalid_field">;

export interface ToolReadOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

export interface ToolWriteOptions extends ToolReadOptions {
  /**
   * The signed-in person, stamped onto `updated_by`. Null is accepted so the
   * import and the demo seed can use these functions, but every request path
   * has a resolved session by the time it gets here — the foreign key on
   * `updated_by` refuses anything else.
   */
  actorUserId?: string | null;
}

// ── Reading ─────────────────────────────────────────────────────────

/**
 * One tool by slug or uuid, drafts and archived rows included, with the
 * revision token the panel will hand back.
 *
 * **The token is minted here, when the panel opens** — not when the page was
 * rendered and not when it was cached. That is what makes the conflict check
 * mean "changed while you had it open" rather than "changed since this HTML was
 * generated", and it is why the editor loads through its own read instead of
 * reusing whatever the cached tool page already had.
 *
 * Null for anything that is neither a uuid nor a known slug, rather than
 * letting free text reach a uuid column as a cast error.
 */
export async function findToolForEditor(
  idOrSlug: string,
  options: ToolReadOptions = {}
): Promise<EditableTool | null> {
  const db = options.db ?? (await getDb());
  const match = isUuid(idOrSlug)
    ? or(eq(tools.slug, idOrSlug), eq(tools.id, idOrSlug))
    : eq(tools.slug, idOrSlug);

  const [row] = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      description: tools.description,
      categoryId: tools.categoryId,
      locationId: tools.locationId,
      materials: tools.materials,
      ppeRequired: tools.ppeRequired,
      tags: tools.tags,
      trainingRequired: tools.trainingRequired,
      useRestrictions: tools.useRestrictions,
      emergencyStop: tools.emergencyStop,
      notes: tools.notes,
      floorCheck: tools.floorCheck,
      starterQuestions: tools.starterQuestions,
      published: tools.published,
      archivedAt: tools.archivedAt,
      lastReviewedAt: tools.lastReviewedAt,
      lastReviewedBy: tools.lastReviewedBy,
      revision: revisionOf(tools.updatedAt),
    })
    .from(tools)
    .where(match)
    .limit(1);

  return row ?? null;
}

/**
 * The tool's current revision, or null when there is no such tool.
 *
 * A read, not a write: the one caller that needs it is a removal that has an
 * irreversible step of its own to perform before it touches the database, and
 * would rather find out about a conflict first.
 */
export async function readToolRevision(
  toolId: string,
  options: ToolReadOptions = {}
): Promise<Revision | null> {
  if (!isUuid(toolId)) return null;
  const db = options.db ?? (await getDb());

  const [row] = await db
    .select({ revision: revisionOf(tools.updatedAt) })
    .from(tools)
    .where(eq(tools.id, toolId))
    .limit(1);

  return row?.revision ?? null;
}

// ── Writing ─────────────────────────────────────────────────────────

/**
 * Save the editor's fields (spec §5.3(4)).
 *
 * `expectedRevision` is the token the panel received when it opened. If the row
 * has moved since — anybody's write, including a unit or resource edit, because
 * those touch the tool row too — nothing is written and the caller is told
 * `conflict`. There is never a silent overwrite and never a partial one: this
 * is one statement.
 */
export async function updateTool(
  id: string,
  patch: ToolPatch,
  expectedRevision: Revision,
  options: ToolWriteOptions = {}
): Promise<ToolWriteResult> {
  const values = toToolValues(patch);
  if (!values) return { ok: false, reason: "invalid_field" };

  const db = options.db ?? (await getDb());
  return writeTool(db, id, values, expectedRevision, options.actorUserId);
}

/**
 * Move the tool's revision without changing a field.
 *
 * The editor's panel is one form over four tables, and its token is the
 * *tool's*. Without this, adding a unit or reordering photos would leave
 * `tools.updated_at` standing, so a second editor's stale token would still
 * match and their save would quietly overwrite work they never saw. A no-op
 * `UPDATE` still fires the `set_updated_at()` trigger, so touching the row is
 * all it takes.
 *
 * Takes its handle explicitly, because every caller touches inside the same
 * transaction as the child write it is pairing with: one `now()` for the whole
 * transaction means the token this returns is the one the child write got too.
 */
export async function touchTool(
  db: Db,
  id: string,
  expectedRevision: Revision,
  actorUserId?: string | null
): Promise<ToolWriteResult> {
  return writeTool(db, id, {}, expectedRevision, actorUserId);
}

/** Publish or unpublish (Article 5: a tool is a draft until a person says so). */
export async function setToolPublished(
  id: string,
  published: boolean,
  expectedRevision: Revision,
  options: ToolWriteOptions = {}
): Promise<ToolWriteResult> {
  const db = options.db ?? (await getDb());
  return writeTool(db, id, { published }, expectedRevision, options.actorUserId);
}

/**
 * Archive or restore. Archiving stamps `archived_at`; restoring clears it.
 *
 * `now()` rather than a JavaScript `Date` so the stamp is the database's clock —
 * the same one `updated_at` is about to get from the trigger, and the same one
 * whatever else this transaction writes will get.
 */
export async function setToolArchived(
  id: string,
  archived: boolean,
  expectedRevision: Revision,
  options: ToolWriteOptions = {}
): Promise<ToolWriteResult> {
  const db = options.db ?? (await getDb());
  return writeTool(
    db,
    id,
    { archivedAt: archived ? sql`now()` : null },
    expectedRevision,
    options.actorUserId
  );
}

/**
 * **Looks good** — the inventory review's one-click mark (§5.3(3)).
 *
 * Both columns together: a date with no reviewer is an assertion nobody signed.
 */
export async function markToolReviewed(
  id: string,
  expectedRevision: Revision,
  options: ToolWriteOptions = {}
): Promise<ToolWriteResult> {
  const db = options.db ?? (await getDb());
  return writeTool(
    db,
    id,
    { lastReviewedAt: sql`now()`, lastReviewedBy: options.actorUserId ?? null },
    expectedRevision,
    options.actorUserId
  );
}

// ── The one statement underneath all of them ────────────────────────

/**
 * `PgUpdateSetSource` rather than `Partial<$inferInsert>`: `archived_at` and
 * `last_reviewed_at` are set to `now()`, and only this type admits raw SQL.
 */
type ToolValues = PgUpdateSetSource<typeof tools>;

/**
 * Apply `values` to one tool, but only if it still carries `expectedRevision`.
 *
 * The `returning` carries the *new* token, computed after the BEFORE UPDATE
 * trigger has run, so a caller saving twice never re-reads to stay current.
 *
 * Zero rows is ambiguous — the row is gone, or it moved — and telling those
 * apart costs a second statement, so it is only paid for on the path that
 * needs it. The panel renders them differently: one offers a reload, the other
 * says the tool no longer exists.
 */
async function writeTool(
  db: Db,
  id: string,
  values: ToolValues,
  expectedRevision: Revision,
  actorUserId?: string | null
): Promise<ToolWriteResult> {
  // A slug or free text would reach a uuid column as a cast error, not as an
  // empty result.
  if (!isUuid(id)) return { ok: false, reason: "not_found" };

  const rows = await db
    .update(tools)
    // `updated_by` last so it is always stamped, and always by this write:
    // every path into here has a resolved actor, and "nobody" is a fact worth
    // recording rather than a reason to leave the previous author in place.
    .set({ ...values, updatedBy: actorUserId ?? null })
    .where(and(eq(tools.id, id), revisionEquals(tools.updatedAt, expectedRevision)))
    .returning({ revision: revisionOf(tools.updatedAt) });

  if (rows.length > 0) return { ok: true, revision: rows[0].revision };

  const [existing] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(eq(tools.id, id))
    .limit(1);

  return { ok: false, reason: existing ? "conflict" : "not_found" };
}

/**
 * The patch as column values, or null when a field is not worth writing.
 *
 * Only keys the caller actually sent are included, so a panel that edits one
 * field does not overwrite the rest with whatever it happened to have loaded.
 * Text is trimmed and an emptied field becomes null rather than `""` — the
 * catalogue derives "not recorded" from null, and a row of empty strings reads
 * as a row of answers.
 */
function toToolValues(patch: ToolPatch): ToolValues | null {
  const values: ToolValues = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    // The catalogue, the QR label and the chat all name a tool by this. An
    // empty one is not an edit anybody meant to make.
    if (!name) return null;
    // The display name's hard cap (tool display names spec §5.1). Refused, not
    // cut: the editor and approval hold the box to it, so a longer one is a
    // caller that skipped the rule.
    if (name.length > DISPLAY_NAME_MAX) return null;
    values.name = name;
  }

  if (patch.officialName !== undefined) {
    const official = (patch.officialName ?? "").replace(/\s+/g, " ").trim();
    if (official.length > OFFICIAL_NAME_MAX) return null;
    values.officialName = official || null;
  }

  if (patch.description !== undefined) values.description = emptyToNull(patch.description);
  if (patch.useRestrictions !== undefined) values.useRestrictions = emptyToNull(patch.useRestrictions);
  if (patch.emergencyStop !== undefined) values.emergencyStop = emptyToNull(patch.emergencyStop);
  if (patch.notes !== undefined) values.notes = emptyToNull(patch.notes);
  if (patch.floorCheck !== undefined) values.floorCheck = emptyToNull(patch.floorCheck);

  if (patch.categoryId !== undefined) {
    if (patch.categoryId !== null && !isUuid(patch.categoryId)) return null;
    values.categoryId = patch.categoryId;
  }
  if (patch.locationId !== undefined) {
    if (patch.locationId !== null && !isUuid(patch.locationId)) return null;
    values.locationId = patch.locationId;
  }

  if (patch.materials !== undefined) values.materials = cleanList(patch.materials);
  if (patch.ppeRequired !== undefined) values.ppeRequired = cleanList(patch.ppeRequired);
  if (patch.tags !== undefined) values.tags = cleanList(patch.tags);

  if (patch.trainingRequired !== undefined) values.trainingRequired = patch.trainingRequired;

  if (patch.starterQuestions !== undefined) {
    const questions = starterQuestionsFromEditor(patch.starterQuestions);
    if (!questions) return null;
    values.starterQuestions = questions;
  }

  return values;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

/** Trimmed, blanks dropped, order kept — these arrays are rendered as chips. */
function cleanList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}
