import type { MirrorEntity, MirrorStatus } from "../db/schema/vocabulary.ts";

/**
 * Client-safe shapes for the Notion mirror (spec §3.8, §4.12).
 *
 * This module imports only the vocabulary, so a client component
 * (`MirrorStatus`, `MirrorMapping`) can import it without pulling the database,
 * the crypto or the Notion client into the browser bundle. Relative imports
 * with `.ts` extensions: workflow step code reaches it under plain Node.
 */

/** Notion database ids by entity, dashed lower-case. An entity with no id is not pushed. */
export type MirrorMapping = Partial<Record<MirrorEntity, string>>;

/**
 * Why the last push did not finish cleanly — `notion_mirrors.last_error.code`.
 * Every code has an `admin.mirror.lastError.<code>` string.
 */
export const MIRROR_ERROR_CODES = [
  "unauthorized",
  "token_unreadable",
  "key_unavailable",
  "database_not_found",
  "schema_mismatch",
  "rows_failed",
  "budget_exhausted",
  "notion_unavailable",
  "unknown",
] as const;
export type MirrorErrorCode = (typeof MIRROR_ERROR_CODES)[number];

/**
 * `notion_mirrors.last_error`: a code the page translates, which entities it
 * concerned, how many rows failed, and a short English diagnosis.
 *
 * `detail` is scrubbed of anything token-shaped, at most 300 characters, and
 * never holds a token or an email — it is shown on the page and may be copied
 * into an issue.
 */
export interface MirrorLastError {
  code: MirrorErrorCode;
  entities: MirrorEntity[];
  failed: number;
  detail: string | null;
}

/**
 * Why a setup call (test, connect, create databases, save mapping, sync now)
 * was refused. Every code has an `admin.mirror.errors.<code>` string.
 */
export const MIRROR_SETUP_ERRORS = [
  "invalid_token",
  "invalid_page",
  "invalid_database_id",
  "unauthorized",
  "page_not_found",
  "database_not_found",
  "schema_mismatch",
  "notion_unavailable",
  "key_unavailable",
  "token_unreadable",
  "not_connected",
  "not_mapped",
  "mirror_paused",
  "sync_too_soon",
  "sync_running",
  "start_failed",
] as const;
export type MirrorSetupError = (typeof MIRROR_SETUP_ERRORS)[number];

/** One pasted database id that did not validate, and why. */
export interface MappingProblem {
  entity: MirrorEntity;
  code: "invalid_database_id" | "database_not_found" | "schema_mismatch";
  /** Expected property names the database lacks. */
  missing?: string[];
  /** Expected property names present with the wrong type. */
  wrongType?: string[];
}

/**
 * What `/admin/mirror` renders — the owner's mirror, never its token. Every
 * date is an ISO string, and every flag is computed by Postgres against its own
 * `now()`, so the page and the claim that will refuse a second Sync now agree.
 */
export interface MirrorView {
  id: string;
  /** A token is stored. Disconnect forgets it and keeps everything else. */
  connected: boolean;
  parentPageId: string;
  parentPageTitle: string | null;
  mapping: MirrorMapping;
  paused: boolean;
  /** `running_since` is set and newer than 15 minutes. */
  running: boolean;
  /** `sync_requested_at` is set and `last_run_at` is null or older than it. */
  syncPending: boolean;
  /** `push_requested_at` is set: a change is waiting for the coalesced push. */
  pushScheduled: boolean;
  lastSyncedAt: string | null;
  lastRunAt: string | null;
  lastStatus: MirrorStatus | null;
  lastError: MirrorLastError | null;
  /** When Sync now is next allowed; null means it is allowed now. */
  syncAvailableAt: string | null;
}
