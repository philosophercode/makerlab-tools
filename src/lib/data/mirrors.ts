import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { notionMirrors } from "../db/schema/mirror.ts";
import { MIRROR_ENTITY, MIRROR_STATUS, isOneOf, type MirrorEntity, type MirrorStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import {
  MIRROR_COALESCE_STALE_MINUTES,
  MIRROR_RUN_STALE_MINUTES,
  MIRROR_SYNC_NOW_MINUTES,
  MIRROR_WATERMARK_SAFETY_MINUTES,
} from "../mirror/limits.ts";
import { relationDependents } from "../mirror/database-schemas.ts";
import { MIRROR_OWNER_ROLES } from "../mirror/owner-roles.ts";
import type { MirrorLastError, MirrorMapping, MirrorView } from "../mirror/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * `notion_mirrors` — one admin's Notion mirror and the claims that keep its
 * pushes from overlapping (spec §3.8, §4.12, §8).
 *
 * **Every claim is one conditional `UPDATE … RETURNING`** whose WHERE clause
 * carries the state it moves from, so two callers racing for the same mirror
 * cannot both win — the `pending-tools.ts` idiom. When a claim matches nothing,
 * a follow-up read says why; the claim itself is still one statement.
 *
 * **Every time window is computed by Postgres, and no JavaScript `Date` ever
 * reaches a comparison** (read `revision.ts`): `now()` has microseconds and a
 * `Date` milliseconds, so a round-tripped timestamp would compare wrong on Neon
 * and right on PGlite. The push watermark and `last_synced_at` therefore
 * travel as `timestamptz::text` and go back in as `$::timestamptz`.
 *
 * **Nothing here returns the token** except {@link claimMirrorRun} and
 * {@link getMirrorTokenCiphertext}, which hand the ciphertext to the push and to
 * setup. {@link getMirrorViewForOwner} does not even select it.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `server-only`:
 * the mirror's workflow steps load this module from an esbuild bundle.
 */

// ── Shapes ──────────────────────────────────────────────────────────

export interface MirrorDataOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** One mirror, minus its token. */
export interface MirrorRecord {
  id: string;
  ownerUserId: string;
  /** A token is stored; false after Disconnect. */
  hasToken: boolean;
  parentPageId: string;
  parentPageTitle: string | null;
  mapping: MirrorMapping;
  pausedAt: Date | null;
  runningSince: Date | null;
  pushRequestedAt: Date | null;
  syncRequestedAt: Date | null;
  lastSyncedAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: MirrorStatus | null;
  lastError: MirrorLastError | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a push works from: the record, the ciphertext, and its two timestamps as text. */
export interface ClaimedMirror extends MirrorRecord {
  tokenCiphertext: Uint8Array | null;
  /**
   * Claim time minus {@link MIRROR_WATERMARK_SAFETY_MINUTES}, as Postgres'
   * `timestamptz::text` (microseconds kept). Hand it to `finishMirrorRun` as
   * `advanceTo` when everything up to it was pushed.
   */
  watermark: string;
  /** `last_synced_at::text`: push rows whose `updated_at > $since::timestamptz`. Null = push everything. */
  since: string | null;
  /**
   * `mapping_generation` at the claim. Hand it to `finishMirrorRun` and
   * `upsertMirrorPage`: once the mapping changes under a running push, that
   * push neither advances `last_synced_at` nor records a page.
   */
  generation: number;
}

export type ClaimMirrorRunResult =
  | ClaimedMirror
  | { skipped: "not_found" | "paused" | "not_connected" | "owner_not_allowed" | "running" };

export type ClaimManualSyncResult =
  | { ok: true; mirrorId: string }
  | {
      ok: false;
      reason: "not_found" | "not_connected" | "paused" | "not_mapped" | "too_soon" | "running";
      retryAfterSeconds?: number;
    };

export interface FinishMirrorRunInput {
  status: MirrorStatus;
  error: MirrorLastError | null;
  /** The claim's `watermark`, or null to leave `last_synced_at` where it is. */
  advanceTo: string | null;
  /**
   * The claim's `generation`. `advanceTo` is applied only while the mirror is
   * still at it: a mapping changed or reset during the push (Create databases,
   * Save mapping) forced a full push, and this push must not undo that.
   */
  generation: number;
  /** Pause the mirror (a revoked token, §5.8). Never un-pauses. */
  pause: boolean;
}

// ── SQL pieces ──────────────────────────────────────────────────────

/** `interval 'N minutes'` from a constant — rendered inline, never a parameter. */
function minutes(n: number): SQL {
  return sql.raw(`interval '${Math.trunc(n)} minutes'`);
}

const m = notionMirrors;

/** It has a token and is not paused. */
const CONNECTED = sql`(${m.tokenCiphertext} is not null and ${m.pausedAt} is null)`;

/**
 * Its owner may still manage a mirror: their row holds a role that grants
 * `mirror.manage` and is not banned (`mirror/owner-roles.ts`). A demoted or
 * banned admin's mirror stops receiving pushes — it carries names and emails,
 * and they could no longer pause it themselves.
 */
const OWNER_ALLOWED = sql`exists (select 1 from "user" as u where u.id = ${m.ownerUserId} and u.role in (${sql.join(
  MIRROR_OWNER_ROLES.map((role) => sql`${role}`),
  sql`, `
)}) and u.banned is not true)`;

/** A mirror is active when it is connected, not paused, and its owner may still manage it. */
const ACTIVE = sql`(${CONNECTED} and ${OWNER_ALLOWED})`;

/** Nobody is pushing it: no `running_since`, or one old enough to be a dead run. */
const NOT_RUNNING = sql`(${m.runningSince} is null or ${m.runningSince} < now() - ${minutes(MIRROR_RUN_STALE_MINUTES)})`;

/** At least one entity is mapped to a database id. */
const MAPPED = sql`exists (select 1 from jsonb_each(${m.mapping}) as e where jsonb_typeof(e.value) = 'string' and e.value #>> '{}' <> '')`;

/** Sync now is allowed: never pressed, or pressed longer ago than the window. */
const SYNC_WINDOW_OPEN = sql`(${m.syncRequestedAt} is null or ${m.syncRequestedAt} < now() - ${minutes(MIRROR_SYNC_NOW_MINUTES)})`;

/** A timestamptz as an ISO-8601 UTC string, milliseconds, computed by Postgres. */
function isoText(expression: SQL): SQL<string | null> {
  return sql<string | null>`to_char((${expression}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

const RECORD_COLUMNS = {
  id: m.id,
  ownerUserId: m.ownerUserId,
  hasToken: sql<boolean>`(${m.tokenCiphertext} is not null)`,
  parentPageId: m.parentPageId,
  parentPageTitle: m.parentPageTitle,
  mapping: m.mapping,
  pausedAt: m.pausedAt,
  runningSince: m.runningSince,
  pushRequestedAt: m.pushRequestedAt,
  syncRequestedAt: m.syncRequestedAt,
  lastSyncedAt: m.lastSyncedAt,
  lastRunAt: m.lastRunAt,
  lastStatus: m.lastStatus,
  lastError: m.lastError,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
};

type RecordRow = {
  id: string;
  ownerUserId: string;
  hasToken: boolean | string | null;
  parentPageId: string;
  parentPageTitle: string | null;
  mapping: MirrorMapping | null;
  pausedAt: Date | null;
  runningSince: Date | null;
  pushRequestedAt: Date | null;
  syncRequestedAt: Date | null;
  lastSyncedAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: MirrorLastError | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: RecordRow): MirrorRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    hasToken: bool(row.hasToken),
    parentPageId: row.parentPageId,
    parentPageTitle: row.parentPageTitle,
    mapping: normalizeMirrorMapping(row.mapping),
    pausedAt: row.pausedAt,
    runningSince: row.runningSince,
    pushRequestedAt: row.pushRequestedAt,
    syncRequestedAt: row.syncRequestedAt,
    lastSyncedAt: row.lastSyncedAt,
    lastRunAt: row.lastRunAt,
    lastStatus: isOneOf(MIRROR_STATUS, row.lastStatus) ? row.lastStatus : null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Drivers agree on `boolean`, but a raw expression is cheap to be sure of. */
function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

/**
 * Only known entities with a non-empty string id, in dependency order. The
 * mapping is jsonb and was written by this app, but a hand-edited row should
 * still read as something the push can trust.
 */
export function normalizeMirrorMapping(value: unknown): MirrorMapping {
  const out: MirrorMapping = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const entity of MIRROR_ENTITY) {
    const id = record[entity];
    if (typeof id === "string" && id.trim()) out[entity] = id.trim();
  }
  return out;
}

async function handle(options: MirrorDataOptions): Promise<Db> {
  return options.db ?? (await getDb());
}

// ── Reading ─────────────────────────────────────────────────────────

/** One mirror by id, or null — including for anything not uuid-shaped. */
export async function getMirror(id: string, options: MirrorDataOptions = {}): Promise<MirrorRecord | null> {
  if (!isUuid(id)) return null;
  const db = await handle(options);
  const [row] = await db.select(RECORD_COLUMNS).from(m).where(eq(m.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

/** The signed-in admin's mirror, or null. Always found by owner — never by an id from the client (§8). */
export async function getMirrorForOwner(
  ownerUserId: string,
  options: MirrorDataOptions = {}
): Promise<MirrorRecord | null> {
  const db = await handle(options);
  const [row] = await db.select(RECORD_COLUMNS).from(m).where(eq(m.ownerUserId, ownerUserId)).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * What `/admin/mirror` renders. Every flag is computed by Postgres against its
 * own `now()` — the same clock the claims use — and every date comes back as
 * an ISO string. The token column is not selected.
 */
export async function getMirrorViewForOwner(
  ownerUserId: string,
  options: MirrorDataOptions = {}
): Promise<MirrorView | null> {
  const db = await handle(options);
  const [row] = await db
    .select({
      id: m.id,
      connected: sql<boolean>`(${m.tokenCiphertext} is not null)`,
      parentPageId: m.parentPageId,
      parentPageTitle: m.parentPageTitle,
      mapping: m.mapping,
      paused: sql<boolean>`(${m.pausedAt} is not null)`,
      running: sql<boolean>`(${m.runningSince} is not null and ${m.runningSince} >= now() - ${minutes(MIRROR_RUN_STALE_MINUTES)})`,
      syncPending: sql<boolean>`(${m.syncRequestedAt} is not null and (${m.lastRunAt} is null or ${m.lastRunAt} < ${m.syncRequestedAt}))`,
      pushScheduled: sql<boolean>`(${m.pushRequestedAt} is not null)`,
      lastSyncedAt: isoText(sql`${m.lastSyncedAt}`),
      lastRunAt: isoText(sql`${m.lastRunAt}`),
      lastStatus: m.lastStatus,
      lastError: m.lastError,
      syncAvailableAt: sql<string | null>`case when ${SYNC_WINDOW_OPEN} then null else ${isoText(
        sql`${m.syncRequestedAt} + ${minutes(MIRROR_SYNC_NOW_MINUTES)}`
      )} end`,
    })
    .from(m)
    .where(eq(m.ownerUserId, ownerUserId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    connected: bool(row.connected),
    parentPageId: row.parentPageId,
    parentPageTitle: row.parentPageTitle,
    mapping: normalizeMirrorMapping(row.mapping),
    paused: bool(row.paused),
    running: bool(row.running),
    syncPending: bool(row.syncPending),
    pushScheduled: bool(row.pushScheduled),
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastRunAt: row.lastRunAt ?? null,
    lastStatus: isOneOf(MIRROR_STATUS, row.lastStatus) ? row.lastStatus : null,
    lastError: row.lastError ?? null,
    syncAvailableAt: row.syncAvailableAt ?? null,
  };
}

/** The stored ciphertext, for setup calls (create databases, validate a mapping). Null when disconnected. */
export async function getMirrorTokenCiphertext(
  mirrorId: string,
  options: MirrorDataOptions = {}
): Promise<Uint8Array | null> {
  if (!isUuid(mirrorId)) return null;
  const db = await handle(options);
  const [row] = await db.select({ token: m.tokenCiphertext }).from(m).where(eq(m.id, mirrorId)).limit(1);
  return row?.token ?? null;
}

// ── Setup ───────────────────────────────────────────────────────────

/**
 * Connect (or reconnect) the owner's mirror: an upsert on the owner.
 *
 * Reconnecting keeps the mapping and every `mirror_pages` row, so the same
 * Notion pages are updated rather than duplicated. It clears `paused_at` — a
 * new token is the answer to the 401 that paused it (§5.8) — and clears a
 * `last_error` that the old token caused (`unauthorized`, `token_unreadable`,
 * `key_unavailable`); any other error is still true and stays on the page.
 *
 * The caller has already validated the token with one read (§8) and encrypted
 * it; this function never sees the plaintext.
 */
export async function saveMirrorConnection(
  input: {
    ownerUserId: string;
    tokenCiphertext: Uint8Array;
    parentPageId: string;
    parentPageTitle: string | null;
  },
  options: MirrorDataOptions = {}
): Promise<{ mirror: MirrorRecord; created: boolean }> {
  const db = await handle(options);
  const [row] = await db
    .insert(m)
    .values({
      ownerUserId: input.ownerUserId,
      tokenCiphertext: input.tokenCiphertext,
      parentPageId: input.parentPageId,
      parentPageTitle: input.parentPageTitle,
    })
    .onConflictDoUpdate({
      target: m.ownerUserId,
      set: {
        tokenCiphertext: input.tokenCiphertext,
        parentPageId: input.parentPageId,
        parentPageTitle: input.parentPageTitle,
        pausedAt: null,
        lastError: sql`case when ${m.lastError} ->> 'code' in ('unauthorized', 'token_unreadable', 'key_unavailable') then null else ${m.lastError} end`,
      },
    })
    .returning({ ...RECORD_COLUMNS, created: sql<boolean>`(xmax = 0)` });
  const { created, ...record } = row;
  return { mirror: toRecord(record), created: bool(created) };
}

/**
 * Forget the token (§3.8 "Disconnect"). The mapping and `mirror_pages` stay,
 * so reconnecting picks up where it left off; a pending coalesced push is
 * dropped, since it could not run. True when the owner had a mirror.
 */
export async function disconnectMirror(ownerUserId: string, options: MirrorDataOptions = {}): Promise<boolean> {
  const db = await handle(options);
  const rows = await db
    .update(m)
    .set({ tokenCiphertext: null, pushRequestedAt: null })
    .where(eq(m.ownerUserId, ownerUserId))
    .returning({ id: m.id });
  return rows.length > 0;
}

/**
 * Replace the mapping. The caller validated every id (`applyPastedMapping`) or
 * created the databases (`ensureMirrorDatabases`); unknown entities and empty
 * ids are dropped here.
 *
 * @throws when the mirror does not exist — callers only ever hold an id they
 *   just read by owner.
 */
export async function setMirrorMapping(
  mirrorId: string,
  mapping: MirrorMapping,
  options: MirrorDataOptions = {}
): Promise<MirrorRecord> {
  if (!isUuid(mirrorId)) throw new Error("setMirrorMapping: the mirror does not exist");
  const db = await handle(options);
  const next = normalizeMirrorMapping(mapping);
  const [row] = await db
    .update(m)
    .set({
      mapping: next,
      // A mapping that changes moves the generation, so a push running under
      // the old one records nothing more (see `finishMirrorRun`). Saving the
      // same mapping again leaves a running push alone.
      mappingGeneration: sql`case when ${m.mapping} = ${JSON.stringify(next)}::jsonb then ${m.mappingGeneration} else ${m.mappingGeneration} + 1 end`,
    })
    .where(eq(m.id, mirrorId))
    .returning(RECORD_COLUMNS);
  if (!row) throw new Error("setMirrorMapping: the mirror does not exist");
  return toRecord(row);
}

/**
 * Forget which pages mirror `entities` and make the next push a full one
 * (`last_synced_at = null`) — what recreating a deleted database needs, since
 * the old page ids point into a database that is gone (§5.8).
 *
 * Other entities' pages stay, but the **dependents** — every entity with a
 * relation to one of `entities` (`relationDependents`: units, resources,
 * maintenance and projects for tools; tools for categories and locations;
 * maintenance for units) — are marked not mirrored (`source_updated_at =
 * null`). Their relations point at the forgotten pages, and without the mark
 * the push's own filter would skip them, since each is recorded at its current
 * revision. The full push then updates them in place with the new links.
 *
 * Bumps `mapping_generation`, so a push already running under the old mapping
 * cannot advance `last_synced_at` over this reset or record pages again.
 */
export async function resetMirrorEntities(
  mirrorId: string,
  entities: MirrorEntity[],
  options: MirrorDataOptions = {}
): Promise<void> {
  const known = entities.filter((entity) => isOneOf(MIRROR_ENTITY, entity));
  if (!isUuid(mirrorId) || known.length === 0) return;
  const db = await handle(options);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`delete from mirror_pages where mirror_id = ${mirrorId} and entity in (${sql.join(
        known.map((entity) => sql`${entity}`),
        sql`, `
      )})`
    );
    const dependents = relationDependents(known);
    if (dependents.length) {
      await tx.execute(
        sql`update mirror_pages set source_updated_at = null where mirror_id = ${mirrorId} and entity in (${sql.join(
          dependents.map((entity) => sql`${entity}`),
          sql`, `
        )})`
      );
    }
    await tx
      .update(m)
      .set({ lastSyncedAt: null, mappingGeneration: sql`${m.mappingGeneration} + 1` })
      .where(eq(m.id, mirrorId));
  });
}

/** Pause or resume the owner's mirror. Pausing keeps the first `paused_at`. Null when there is no mirror. */
export async function setMirrorPaused(
  ownerUserId: string,
  paused: boolean,
  options: MirrorDataOptions = {}
): Promise<MirrorRecord | null> {
  const db = await handle(options);
  const [row] = await db
    .update(m)
    .set({ pausedAt: paused ? sql`coalesce(${m.pausedAt}, now())` : null })
    .where(eq(m.ownerUserId, ownerUserId))
    .returning(RECORD_COLUMNS);
  return row ? toRecord(row) : null;
}

// ── The push's own claim (the overlap guard, §3.8 step 1) ───────────

/**
 * Start a push: set `running_since = now()` if the mirror is connected, not
 * paused, its owner may still manage it, and nobody is pushing it (or the last push has been "running" for
 * longer than {@link MIRROR_RUN_STALE_MINUTES}, which is a dead one).
 *
 * The watermark is taken in the same statement, so it is exactly the claim
 * time minus {@link MIRROR_WATERMARK_SAFETY_MINUTES}.
 */
export async function claimMirrorRun(mirrorId: string, options: MirrorDataOptions = {}): Promise<ClaimMirrorRunResult> {
  if (!isUuid(mirrorId)) return { skipped: "not_found" };
  const db = await handle(options);
  const [row] = await db
    .update(m)
    .set({ runningSince: sql`now()` })
    .where(and(eq(m.id, mirrorId), ACTIVE, NOT_RUNNING))
    .returning({
      ...RECORD_COLUMNS,
      tokenCiphertext: m.tokenCiphertext,
      watermark: sql<string>`(now() - ${minutes(MIRROR_WATERMARK_SAFETY_MINUTES)})::text`,
      since: sql<string | null>`${m.lastSyncedAt}::text`,
      generation: m.mappingGeneration,
    });
  if (row) {
    const { tokenCiphertext, watermark, since, generation, ...record } = row;
    return {
      ...toRecord(record),
      tokenCiphertext: tokenCiphertext ?? null,
      watermark,
      since: since ?? null,
      generation: Number(generation),
    };
  }

  const [state] = await db
    .select({
      connected: sql<boolean>`(${m.tokenCiphertext} is not null)`,
      paused: sql<boolean>`(${m.pausedAt} is not null)`,
      ownerAllowed: sql<boolean>`${OWNER_ALLOWED}`,
    })
    .from(m)
    .where(eq(m.id, mirrorId))
    .limit(1);
  if (!state) return { skipped: "not_found" };
  if (!bool(state.connected)) return { skipped: "not_connected" };
  if (bool(state.paused)) return { skipped: "paused" };
  if (!bool(state.ownerAllowed)) return { skipped: "owner_not_allowed" };
  return { skipped: "running" };
}

/**
 * End a push, whatever happened: clear `running_since`, stamp `last_run_at`,
 * record the status and error, and — only when `advanceTo` is given and the
 * mirror is still at the claim's `generation` — move `last_synced_at` to it.
 * A mapping change or reset during the push set `last_synced_at` to null to
 * force a full push; overwriting it with this push's watermark would strand
 * every row older than it in the newly mapped databases. A partial or failed push passes null, so the rows
 * that failed are selected again next time (§3.8 step 5). `pause` pauses the
 * mirror (a revoked token, §5.8) and keeps an existing `paused_at`.
 *
 * Answers `current: false` when the mapping moved on during the push, so the
 * caller knows its work did not count as a complete push.
 */
export async function finishMirrorRun(
  mirrorId: string,
  input: FinishMirrorRunInput,
  options: MirrorDataOptions = {}
): Promise<{ current: boolean }> {
  if (!isUuid(mirrorId)) return { current: false };
  const db = await handle(options);
  const rows = await db
    .update(m)
    .set({
      runningSince: null,
      lastRunAt: sql`now()`,
      lastStatus: input.status,
      lastError: input.error,
      ...(input.advanceTo !== null
        ? {
            lastSyncedAt: sql`case when ${m.mappingGeneration} = ${input.generation} then ${input.advanceTo}::timestamptz else ${m.lastSyncedAt} end`,
          }
        : {}),
      ...(input.pause ? { pausedAt: sql`coalesce(${m.pausedAt}, now())` } : {}),
    })
    .where(eq(m.id, mirrorId))
    .returning({ generation: m.mappingGeneration });
  return { current: rows.length > 0 && Number(rows[0].generation) === input.generation };
}

/**
 * Free the overlap guard of a claimed run that had nothing to do — no entity
 * mapped — without writing a status. `finishMirrorRun` always records one, and
 * a mirror that pushed nothing should keep the result it last earned rather
 * than show a made-up "ok" or "failed". Stamps `last_run_at`, so a Sync now
 * claim is seen as settled.
 */
export async function releaseMirrorRun(mirrorId: string, options: MirrorDataOptions = {}): Promise<void> {
  if (!isUuid(mirrorId)) return;
  const db = await handle(options);
  await db.update(m).set({ runningSince: null, lastRunAt: sql`now()` }).where(eq(m.id, mirrorId));
}

// ── Sync now (§8: one push per mirror per 15 minutes) ───────────────

/**
 * Claim the owner's Sync now: set `sync_requested_at = now()` if the mirror is
 * connected, not paused, mapped, not being pushed right now, and was not
 * synced on request in the last {@link MIRROR_SYNC_NOW_MINUTES}. A refusal
 * says why, and `too_soon` says how many seconds are left.
 *
 * **A running push refuses the claim** (`running`) rather than spend the
 * owner's fifteen minutes on a push whose own claim would be skipped as
 * `running` — the page would then show the other push's result as if it
 * answered the press. The owner presses again once it finishes.
 *
 * The owner's role is not re-checked here: the server action has just checked
 * `mirror.manage` on the live identity, which is the authority.
 */
export async function claimManualSync(
  ownerUserId: string,
  options: MirrorDataOptions = {}
): Promise<ClaimManualSyncResult> {
  const db = await handle(options);
  const [claimed] = await db
    .update(m)
    .set({ syncRequestedAt: sql`now()` })
    .where(and(eq(m.ownerUserId, ownerUserId), CONNECTED, MAPPED, SYNC_WINDOW_OPEN, NOT_RUNNING))
    .returning({ id: m.id });
  if (claimed) return { ok: true, mirrorId: claimed.id };

  const [state] = await db
    .select({
      connected: sql<boolean>`(${m.tokenCiphertext} is not null)`,
      paused: sql<boolean>`(${m.pausedAt} is not null)`,
      mapped: sql<boolean>`${MAPPED}`,
      windowOpen: sql<boolean>`${SYNC_WINDOW_OPEN}`,
      retryAfterSeconds: sql<number | string | null>`case when ${SYNC_WINDOW_OPEN} then null else greatest(1, ceil(extract(epoch from (${m.syncRequestedAt} + ${minutes(
        MIRROR_SYNC_NOW_MINUTES
      )} - now()))))::int end`,
    })
    .from(m)
    .where(eq(m.ownerUserId, ownerUserId))
    .limit(1);
  if (!state) return { ok: false, reason: "not_found" };
  if (!bool(state.connected)) return { ok: false, reason: "not_connected" };
  if (bool(state.paused)) return { ok: false, reason: "paused" };
  if (!bool(state.mapped)) return { ok: false, reason: "not_mapped" };
  if (bool(state.windowOpen)) return { ok: false, reason: "running" };
  const retryAfterSeconds = Number(state.retryAfterSeconds ?? 1);
  return { ok: false, reason: "too_soon", retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1 };
}

/** Give a Sync now claim back — the workflow could not be started, so it did not count. */
export async function releaseManualSync(mirrorId: string, options: MirrorDataOptions = {}): Promise<void> {
  if (!isUuid(mirrorId)) return;
  const db = await handle(options);
  await db.update(m).set({ syncRequestedAt: null }).where(eq(m.id, mirrorId));
}

// ── Coalescing (§3.8 trigger 1) ─────────────────────────────────────

/**
 * A change happened: claim a coalesced push for every active mirror that does
 * not already have one waiting (or whose claim is older than
 * {@link MIRROR_COALESCE_STALE_MINUTES}, a run that never finished). Returns
 * the ids claimed; an empty list means a push is already on its way, or there
 * is nothing to push to, and the caller starts nothing.
 */
export async function claimCoalescedPush(options: MirrorDataOptions = {}): Promise<string[]> {
  const db = await handle(options);
  const rows = await db
    .update(m)
    .set({ pushRequestedAt: sql`now()` })
    .where(
      and(
        ACTIVE,
        sql`(${m.pushRequestedAt} is null or ${m.pushRequestedAt} < now() - ${minutes(MIRROR_COALESCE_STALE_MINUTES)})`
      )
    )
    .returning({ id: m.id });
  return rows.map((row) => row.id);
}

/** Give coalescing claims back — the workflow could not be started. */
export async function releaseCoalescedPush(ids: string[], options: MirrorDataOptions = {}): Promise<void> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return;
  const db = await handle(options);
  await db.update(m).set({ pushRequestedAt: null }).where(inArray(m.id, valid));
}

/**
 * The coalescing run woke up: clear every waiting claim and return the ids of
 * the mirrors still active, which it then pushes. Clearing first means a
 * change made while those pushes run claims — and schedules — the next one.
 */
export async function takeCoalescedPush(options: MirrorDataOptions = {}): Promise<string[]> {
  const db = await handle(options);
  const rows = await db
    .update(m)
    .set({ pushRequestedAt: null })
    .where(sql`${m.pushRequestedAt} is not null`)
    .returning({ id: m.id, active: sql<boolean>`${ACTIVE}` });
  return rows.filter((row) => bool(row.active)).map((row) => row.id);
}

// ── The daily backstop (§3.9) ───────────────────────────────────────

/**
 * Mirrors the daily cron should push: active, not running, and either never
 * synced, not `ok` last time, or behind a source table that changed since.
 * One `EXISTS` per mirrored table, each a scan of `updated_at` bounded by the
 * first match.
 */
export async function listMirrorsDueForBackstop(options: MirrorDataOptions = {}): Promise<string[]> {
  const db = await handle(options);
  const changed = (table: string) =>
    sql`exists (select 1 from ${sql.raw(`"${table}"`)} as s where s.updated_at > ${m.lastSyncedAt})`;
  const rows = await db
    .select({ id: m.id })
    .from(m)
    .where(
      and(
        ACTIVE,
        NOT_RUNNING,
        sql`(${m.lastSyncedAt} is null
          or ${m.lastStatus} is distinct from 'ok'
          or ${changed("categories")}
          or ${changed("locations")}
          or ${changed("tools")}
          or ${changed("units")}
          or ${changed("resources")}
          or ${changed("maintenance_logs")}
          or ${changed("projects")})`
      )
    );
  return rows.map((row) => row.id);
}
