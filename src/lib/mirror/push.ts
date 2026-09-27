import { getDb } from "../db/client.ts";
import { MIRROR_ENTITY, type MirrorEntity } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { deleteMirrorPage, getMirrorPageIds, listOrphanedMirrorPages, upsertMirrorPage } from "../data/mirror-pages.ts";
import { claimMirrorRun, finishMirrorRun, releaseMirrorRun, type ClaimedMirror } from "../data/mirrors.ts";
import { mirrorClientFor } from "./credentials.ts";
import { validateDatabaseSchema } from "./database-schemas.ts";
import { MIRROR_PUSH_BUDGET_MS } from "./limits.ts";
import { NotionMirrorError, scrubSecrets, type NotionClient, type NotionClientOptions } from "./notion-client.ts";
import { buildMirrorProperties, relationTargets, type MirrorRelations } from "./properties.ts";
import { listSourceRows, SOURCE_PAGE_SIZE, type AnySourceRow, type SourceCursor } from "./source.ts";
import type { MirrorErrorCode, MirrorLastError, MirrorMapping } from "./types.ts";

/**
 * One push of one mirror (spec §3.8 "Push", §5.8, §8 "External calls").
 *
 * 1. **Claim** (`claimMirrorRun`): the overlap guard. A paused, disconnected
 *    or already-running mirror is skipped before a single request is made.
 * 2. **Open a client** from the stored ciphertext. An unset `AUTH_SECRET` is a
 *    failed push that stays active (setting the secret fixes it); a token the
 *    current key cannot read pauses the mirror, since only reconnecting can.
 * 3. **For each mapped entity in dependency order**, page through the rows
 *    `source.ts` selects. Before the first write to an entity its database is
 *    read once and checked against the schema, so a deleted database is
 *    `database_not_found` for that entity alone and the push moves on. Each
 *    row updates its page (or, if Notion says the page is gone, creates a new
 *    one), or creates one and records it at once, so a push cut short never
 *    creates a page twice. An archived tool or unpublished project archives
 *    its page. A row whose relation target has no page yet is pushed without
 *    it and recorded as not mirrored, so the next push tries again.
 * 4. **Archive orphans** — pages whose row was deleted — and forget them.
 * 5. **Finish** (`finishMirrorRun`). Only a clean, complete push advances
 *    `last_synced_at`, to the claim's watermark; a partial or failed one leaves
 *    it where it was so the rows that failed are selected again.
 *
 * **The mapping may change under a push** (Create databases, Save mapping bump
 * `mapping_generation`). The claim carries the generation it started under;
 * a page is recorded, and `last_synced_at` advanced, only while the mirror is
 * still at it. A push that finds it moved stops as `superseded`, frees the
 * guard without recording a result, and answers `incomplete`, so the workflow
 * runs another round from the new mapping.
 *
 * **Stops.** A 401 stops everything and pauses the mirror (§5.8). The 45 s
 * budget, or a 429 whose wait would pass it, stops the loop with what is done
 * recorded; three Notion 5xx responses in a row stop it as
 * `notion_unavailable`, since a Notion that is down would fail every row.
 *
 * **Nothing secret or personal is logged or stored as an error.** One
 * `console.info` line per push carries the mirror id and counts. The
 * `last_error.detail` is generic English built here — entity names, counts and
 * Notion's status and error code — run through `scrubSecrets`; it never holds
 * Notion's message, row content, a name or an email.
 *
 * Throws only on a database error, and releases `running_since` in a `finally`
 * even then.
 *
 * Relative imports with `.ts` extensions, no `server-only`: this is step code.
 */

export interface PushMirrorOptions {
  db?: Db;
  budgetMs?: number;
  client?: Partial<Omit<NotionClientOptions, "token">>;
}

export type MirrorPushOutcome =
  | {
      state: "skipped";
      reason: "not_found" | "paused" | "not_connected" | "owner_not_allowed" | "running" | "not_mapped";
    }
  | { state: "ok"; pushed: number; archived: number }
  /**
   * More to push: the budget ran out with no failures, or the mapping changed
   * under the push (Create databases, Save mapping) and the next round must
   * run from the new one.
   */
  | { state: "incomplete"; pushed: number; archived: number }
  | { state: "partial"; pushed: number; archived: number; failed: number; error: MirrorLastError }
  | { state: "failed"; error: MirrorLastError; paused: boolean };

/** Consecutive Notion 5xx / network failures after which the push stops. */
const MAX_CONSECUTIVE_UNAVAILABLE = 3;
/** How many orphaned pages one pass archives per entity. */
const ORPHAN_BATCH = 50;
const MAX_DETAIL = 300;

/** Why the loop stopped early. `superseded`: the mapping changed under the push. */
type Stop = "budget" | "unauthorized" | "unavailable" | "superseded";

/** What a push has done so far. */
interface RunState {
  pushed: number;
  archived: number;
  failedRows: number;
  /** Entities with a failed row, a missing relation, or a failed database. */
  failedEntities: Set<MirrorEntity>;
  missingDatabases: Set<MirrorEntity>;
  schemaMismatches: Map<MirrorEntity, string[]>;
  /** The last Notion status and code a row failed with — for the detail line. */
  lastRowError: { status: number | null; code: string | null } | null;
  consecutiveUnavailable: number;
  stop: Stop | null;
}

/** Thrown inside the loop to stop it; never escapes {@link pushMirror}. */
class StopPush extends Error {
  stop: Stop;
  constructor(stop: Stop) {
    super(`mirror push stopped: ${stop}`);
    this.stop = stop;
  }
}

export async function pushMirror(mirrorId: string, options: PushMirrorOptions = {}): Promise<MirrorPushOutcome> {
  const db = options.db ?? (await getDb());
  const claim = await claimMirrorRun(mirrorId, { db });
  if ("skipped" in claim) {
    const outcome: MirrorPushOutcome = { state: "skipped", reason: claim.skipped };
    logOutcome(mirrorId, outcome);
    return outcome;
  }

  let released = false;
  try {
    const outcome = await run(claim, options, db);
    released = true;
    logOutcome(mirrorId, outcome);
    return outcome;
  } finally {
    if (!released) {
      // A database error (or a bug) escaped: record it and free the guard, so
      // the next trigger does not wait fifteen minutes for a push that died.
      // If the database is what failed, this fails too; the original error is
      // the one that propagates, and the 15-minute staleness rule frees it.
      try {
        await finishMirrorRun(
          mirrorId,
          {
            status: "failed",
            error: lastError("unknown", [], 0, "A database error interrupted the push."),
            advanceTo: null,
            pause: false,
            generation: claim.generation,
          },
          { db }
        );
      } catch {
        // Nothing more to do; see above.
      }
    }
  }
}

/** Everything after the claim. Always finishes the run itself, except when it throws. */
async function run(claim: ClaimedMirror, options: PushMirrorOptions, db: Db): Promise<MirrorPushOutcome> {
  const mirrorId = claim.id;
  const mapping = claim.mapping;
  const entities = MIRROR_ENTITY.filter((entity) => mapping[entity]);
  if (entities.length === 0) {
    await releaseMirrorRun(mirrorId, { db });
    return { state: "skipped", reason: "not_mapped" };
  }

  const now = options.client?.now ?? Date.now;
  const budgetMs = Math.max(0, options.budgetMs ?? MIRROR_PUSH_BUDGET_MS);
  const deadline = now() + budgetMs;
  const opened = mirrorClientFor(claim.tokenCiphertext, { ...options.client, deadline });
  if (!opened.ok) {
    // `not_connected` cannot happen after a claim (it requires a token); it is
    // reported as unreadable rather than inventing a state for it.
    const code: MirrorErrorCode = opened.code === "key_unavailable" ? "key_unavailable" : "token_unreadable";
    const pause = code === "token_unreadable";
    const error = lastError(
      code,
      [],
      0,
      code === "key_unavailable"
        ? "AUTH_SECRET is not set, so the stored token cannot be decrypted."
        : "The stored token cannot be decrypted with the current key. Connect again."
    );
    await finishMirrorRun(mirrorId, { status: "failed", error, advanceTo: null, pause, generation: claim.generation }, { db });
    return { state: "failed", error, paused: pause };
  }
  const client = opened.client;

  const state: RunState = {
    pushed: 0,
    archived: 0,
    failedRows: 0,
    failedEntities: new Set(),
    missingDatabases: new Set(),
    schemaMismatches: new Map(),
    lastRowError: null,
    consecutiveUnavailable: 0,
    stop: null,
  };

  try {
    for (const entity of entities) {
      await pushEntity(entity, { claim, client, db, state, mapping });
    }
    for (const entity of entities) {
      if (state.missingDatabases.has(entity) || state.schemaMismatches.has(entity)) continue;
      await archiveOrphans(entity, { claim, client, db, state, mapping });
    }
  } catch (error) {
    if (!(error instanceof StopPush)) throw error;
    state.stop = error.stop;
  }

  const generation = claim.generation;
  if (state.stop === "unauthorized") {
    const error = lastError("unauthorized", [], state.failedRows, "Notion refused the token (401). Connect again with a new token.");
    await finishMirrorRun(mirrorId, { status: "failed", error, advanceTo: null, pause: true, generation }, { db });
    return { state: "failed", error, paused: true };
  }
  if (state.stop === "superseded") {
    // The mapping changed under this push. What it did is not a result for
    // the new mapping — free the guard, keep the result the mirror last
    // earned, and let the workflow run the next round from the new mapping.
    await releaseMirrorRun(mirrorId, { db });
    return { state: "incomplete", pushed: state.pushed, archived: state.archived };
  }

  const failures = state.failedRows > 0 || state.failedEntities.size > 0 || state.stop === "unavailable";
  if (!failures && state.stop === null) {
    const finished = await finishMirrorRun(
      mirrorId,
      { status: "ok", error: null, advanceTo: claim.watermark, pause: false, generation },
      { db }
    );
    // Clean, but under a mapping that has since changed: `last_synced_at`
    // stayed where the change put it, and another round pushes the rest.
    if (!finished.current) return { state: "incomplete", pushed: state.pushed, archived: state.archived };
    return { state: "ok", pushed: state.pushed, archived: state.archived };
  }
  if (!failures) {
    const seconds = Math.round(budgetMs / 1000);
    const error = lastError(
      "budget_exhausted",
      [],
      0,
      `The ${seconds}-second budget for one push ran out after ${state.pushed + state.archived} page writes; the rest waits for the next push.`
    );
    await finishMirrorRun(mirrorId, { status: "partial", error, advanceTo: null, pause: false, generation }, { db });
    return { state: "incomplete", pushed: state.pushed, archived: state.archived };
  }

  const error = failureError(state);
  const anything = state.pushed + state.archived > 0;
  await finishMirrorRun(
    mirrorId,
    { status: anything ? "partial" : "failed", error, advanceTo: null, pause: false, generation },
    { db }
  );
  if (anything) {
    return { state: "partial", pushed: state.pushed, archived: state.archived, failed: state.failedRows, error };
  }
  return { state: "failed", error, paused: false };
}

interface EntityContext {
  claim: ClaimedMirror;
  client: NotionClient;
  db: Db;
  state: RunState;
  mapping: MirrorMapping;
}

/** Push every changed row of one entity. */
async function pushEntity(entity: MirrorEntity, ctx: EntityContext): Promise<void> {
  const { claim, client, db, state, mapping } = ctx;
  const databaseId = mapping[entity]!;
  let checked = false;
  let after: SourceCursor | null = null;

  for (;;) {
    const rows: AnySourceRow[] = await listSourceRows(entity, {
      mirrorId: claim.id,
      since: claim.since,
      after,
      limit: SOURCE_PAGE_SIZE,
      db,
    });
    if (rows.length === 0) return;
    const last = rows[rows.length - 1];
    after = { revision: last.revision, id: last.id };

    if (!checked) {
      if (!(await databaseUsable(entity, databaseId, ctx))) return;
      checked = true;
    }

    const relations = await relationsFor(entity, rows, ctx);
    for (const row of rows) {
      if (client.remainingMs() <= 0) throw new StopPush("budget");
      const result = await pushRow(entity, databaseId, row, relations, ctx);
      if (result === "database_gone") {
        state.missingDatabases.add(entity);
        state.failedEntities.add(entity);
        return;
      }
    }
    if (rows.length < SOURCE_PAGE_SIZE) return;
  }
}

/**
 * Read the entity's database once before writing to it. A missing, archived
 * or trashed database fails the entity as `database_not_found`; one without
 * the expected properties as `schema_mismatch`. Either way the push goes on
 * to the next entity.
 */
async function databaseUsable(entity: MirrorEntity, databaseId: string, ctx: EntityContext): Promise<boolean> {
  const { client, state, mapping } = ctx;
  try {
    const database = await client.getDatabase(databaseId);
    noteSuccess(state);
    if (database.archived === true || database.in_trash === true) {
      state.missingDatabases.add(entity);
      state.failedEntities.add(entity);
      return false;
    }
    const problem = validateDatabaseSchema(entity, database, mapping);
    if (problem) {
      state.schemaMismatches.set(entity, [...(problem.missing ?? []), ...(problem.wrongType ?? [])]);
      state.failedEntities.add(entity);
      return false;
    }
    return true;
  } catch (error) {
    const notion = asNotionError(error);
    if (notion.code === "database_not_found" || notion.code === "not_found") {
      state.missingDatabases.add(entity);
      state.failedEntities.add(entity);
      return false;
    }
    handleStopping(notion);
    // Anything else (a 5xx, a 403): the entity cannot be pushed this time.
    noteRowFailure(entity, notion, state, 0);
    return false;
  }
}

/** `mirror_pages` lookups for every relation target `rows` name. */
async function relationsFor(entity: MirrorEntity, rows: AnySourceRow[], ctx: EntityContext): Promise<MirrorRelations> {
  const pages = new Map<MirrorEntity, Map<string, string>>();
  for (const [target, ids] of relationTargets(entity, rows as never[])) {
    if (!ctx.mapping[target]) continue;
    pages.set(target, await getMirrorPageIds(ctx.claim.id, target, [...ids], { db: ctx.db }));
  }
  return {
    mapped: (target) => Boolean(ctx.mapping[target]),
    pageId: (target, id) => pages.get(target)?.get(id) ?? null,
  };
}

/**
 * Push one row. Returns `database_gone` when Notion says the entity's database
 * no longer exists, so the caller abandons the entity; otherwise records
 * the outcome in `state` itself.
 */
async function pushRow(
  entity: MirrorEntity,
  databaseId: string,
  row: AnySourceRow,
  relations: MirrorRelations,
  ctx: EntityContext
): Promise<"done" | "database_gone"> {
  const { client, db, state, claim } = ctx;
  try {
    if (row.archive) {
      if (!row.pageId) return "done";
      try {
        await client.updatePage(row.pageId, { archived: true });
      } catch (error) {
        if (asNotionError(error).code !== "page_not_found") throw error;
        // Deleted by hand already: nothing to archive, nothing to remember.
        await deleteMirrorPage(claim.id, entity, row.id, { db });
        noteSuccess(state);
        return "done";
      }
      await recordPage(ctx, { entity, entityId: row.id, notionPageId: row.pageId, sourceUpdatedAt: row.revision });
      state.archived += 1;
      noteSuccess(state);
      return "done";
    }

    const built = buildMirrorProperties(entity, row as never, relations);
    let pageId = row.pageId;
    if (pageId) {
      try {
        await client.updatePage(pageId, { properties: built.properties, archived: false });
      } catch (error) {
        if (asNotionError(error).code !== "page_not_found") throw error;
        // The page was deleted by hand: forget it and create a new one.
        await deleteMirrorPage(claim.id, entity, row.id, { db });
        pageId = null;
      }
    }
    if (!pageId) {
      const created = await client.createPage({ parent: { database_id: databaseId }, properties: built.properties });
      pageId = created.id;
    }
    await recordPage(ctx, {
      entity,
      entityId: row.id,
      notionPageId: pageId,
      // A row pushed without a relation it should have is not mirrored yet.
      sourceUpdatedAt: built.missingRelation ? null : row.revision,
    });
    state.pushed += 1;
    noteSuccess(state);
    if (built.missingRelation) {
      state.failedRows += 1;
      state.failedEntities.add(entity);
    }
    return "done";
  } catch (error) {
    if (!(error instanceof NotionMirrorError)) throw error; // a database error: let it propagate
    if (error.code === "database_not_found") return "database_gone";
    handleStopping(error);
    noteRowFailure(entity, error, state, 1);
    return "done";
  }
}

/**
 * Record a row's page under the claim's generation. When the mapping changed
 * during the push the row is not written — its page is in a database the
 * mirror no longer maps — and the push stops as `superseded`.
 */
async function recordPage(
  ctx: EntityContext,
  page: { entity: MirrorEntity; entityId: string; notionPageId: string; sourceUpdatedAt: string | null }
): Promise<void> {
  const recorded = await upsertMirrorPage(
    { mirrorId: ctx.claim.id, ...page, generation: ctx.claim.generation },
    { db: ctx.db }
  );
  if (!recorded) throw new StopPush("superseded");
}

/** Archive and forget the pages of rows that no longer exist. */
async function archiveOrphans(entity: MirrorEntity, ctx: EntityContext): Promise<void> {
  const { client, db, state, claim } = ctx;
  for (;;) {
    const orphans = await listOrphanedMirrorPages(claim.id, entity, { limit: ORPHAN_BATCH, db });
    if (orphans.length === 0) return;
    let failedAny = false;
    for (const orphan of orphans) {
      if (client.remainingMs() <= 0) throw new StopPush("budget");
      try {
        await client.updatePage(orphan.notionPageId, { archived: true });
        state.archived += 1;
        noteSuccess(state);
      } catch (error) {
        const notion = asNotionError(error);
        if (notion.code !== "page_not_found") {
          handleStopping(notion);
          noteRowFailure(entity, notion, state, 1);
          failedAny = true;
          continue;
        }
      }
      await deleteMirrorPage(claim.id, entity, orphan.entityId, { db });
    }
    // A failed archive stays in the list; stop rather than loop on it.
    if (failedAny || orphans.length < ORPHAN_BATCH) return;
  }
}

// ── State helpers ───────────────────────────────────────────────────

function asNotionError(error: unknown): NotionMirrorError {
  if (error instanceof NotionMirrorError) return error;
  throw error;
}

/** A 401 stops everything; the budget or a 429 past it stops the loop. */
function handleStopping(error: NotionMirrorError): void {
  if (error.code === "unauthorized") throw new StopPush("unauthorized");
  if (error.code === "deadline" || error.code === "rate_limited") throw new StopPush("budget");
}

function noteSuccess(state: RunState): void {
  state.consecutiveUnavailable = 0;
}

function noteRowFailure(entity: MirrorEntity, error: NotionMirrorError, state: RunState, rows: number): void {
  state.failedRows += rows;
  state.failedEntities.add(entity);
  state.lastRowError = { status: error.status, code: error.notionCode };
  if (error.code === "unavailable") {
    state.consecutiveUnavailable += 1;
    if (state.consecutiveUnavailable >= MAX_CONSECUTIVE_UNAVAILABLE) throw new StopPush("unavailable");
  } else {
    state.consecutiveUnavailable = 0;
  }
}

/** The single error a run with failures records, most actionable first. */
function failureError(state: RunState): MirrorLastError {
  const entities = MIRROR_ENTITY.filter((entity) => state.failedEntities.has(entity));
  if (state.missingDatabases.size) {
    const missing = MIRROR_ENTITY.filter((entity) => state.missingDatabases.has(entity));
    return lastError(
      "database_not_found",
      entities,
      state.failedRows,
      `Notion could not find the ${list(missing)} database${missing.length > 1 ? "s" : ""}. Create databases recreates only the missing ones.${rowsNote(state)}`
    );
  }
  if (state.schemaMismatches.size) {
    const parts = [...state.schemaMismatches].map(([entity, names]) => `${entity} (${names.join(", ")})`);
    return lastError(
      "schema_mismatch",
      entities,
      state.failedRows,
      `These databases lack properties the push writes, or have them with the wrong type: ${parts.join("; ")}.${rowsNote(state)}`
    );
  }
  if (state.stop === "unavailable") {
    return lastError(
      "notion_unavailable",
      entities,
      state.failedRows,
      `Notion did not respond (${MAX_CONSECUTIVE_UNAVAILABLE} server errors in a row); the push stopped.${rowsNote(state)}`
    );
  }
  return lastError("rows_failed", entities, state.failedRows, rowsNote(state).trim() || "Some rows could not be pushed.");
}

function rowsNote(state: RunState): string {
  if (state.failedRows === 0) return "";
  const entities = MIRROR_ENTITY.filter((entity) => state.failedEntities.has(entity));
  const last = state.lastRowError;
  const notion = last ? ` Last Notion response: ${last.status ?? "no status"}${last.code ? ` ${last.code}` : ""}.` : "";
  return ` ${state.failedRows} row${state.failedRows === 1 ? "" : "s"} could not be mirrored (${list(entities)}) and will be tried again.${notion}`;
}

function list(entities: readonly string[]): string {
  return entities.join(", ");
}

function lastError(code: MirrorErrorCode, entities: MirrorEntity[], failed: number, detail: string): MirrorLastError {
  const clean = scrubSecrets(detail).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL);
  return { code, entities, failed, detail: clean || null };
}

function logOutcome(mirrorId: string, outcome: MirrorPushOutcome): void {
  const counts =
    outcome.state === "skipped"
      ? `reason=${outcome.reason}`
      : outcome.state === "failed"
        ? `code=${outcome.error.code} paused=${outcome.paused}`
        : outcome.state === "partial"
          ? `pushed=${outcome.pushed} archived=${outcome.archived} failed=${outcome.failed} code=${outcome.error.code}`
          : `pushed=${outcome.pushed} archived=${outcome.archived}`;
  console.info(`[mirror] push ${mirrorId}: ${outcome.state} ${counts}`);
}
