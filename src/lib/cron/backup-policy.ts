import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { account, session, verification } from "../db/schema/auth.ts";
import { manualChunks, manualPages } from "../db/schema/manuals.ts";
import { notionMirrors } from "../db/schema/mirror.ts";
import { oauthAccessToken, oauthApplication } from "../db/schema/access.ts";
import { staffShifts } from "../db/schema/staff-shifts.ts";
import { starterAnswers } from "../db/schema/starter-answers.ts";
import { chatIllustrations } from "../db/schema/illustrations.ts";
import { usageEvents, usageGaps } from "../db/schema/usage.ts";

/**
 * What the nightly export deliberately leaves out (data platform design spec
 * §3.9, and the Phase 3 note that asked whoever landed Better Auth's tables to
 * decide this).
 *
 * `backup.ts` discovers its tables rather than listing them, which is what a
 * backup should do: a table added in a later phase is exported because it
 * exists, not because somebody remembered. But Phase 4 added tables whose rows
 * are *live credentials*, and a `select *` over them writes bearer tokens into
 * a file that is then kept for up to three years. A restorable copy of the
 * catalogue is worth having; an archive of session tokens is a way for anyone
 * holding one backup to sign in as anybody.
 *
 * So the default stays "back it up", and the exceptions are named here:
 *
 *  - **`session` and `verification` are skipped whole.** A session row *is* a
 *    bearer token, and a verification row is a half-finished OAuth handshake
 *    that is meaningless minutes later. Neither is worth restoring — and
 *    restoring them would mean reviving sign-ins that should have ended with
 *    whatever outage forced the restore.
 *  - **`account` is kept, with its secret columns blanked.** The row that
 *    matters is the link — this person is this Google `sub` — which is exactly
 *    what a restore needs to put somebody back together. The tokens are
 *    Google's and are reissued on the next sign-in, so losing them costs
 *    nothing and keeping them costs a credential in a file.
 *  - **`user` is kept whole, deliberately.** `role` and `banned` are the state
 *    a restore would most need to get right, and the row carries no secret.
 *  - **`notion_mirrors` is kept, with its token blanked** (Phase 8). The
 *    ciphertext is decryptable by anyone who also holds `AUTH_SECRET`, and as a
 *    `bytea` it would serialise as a `Buffer` object besides. A restored mirror
 *    keeps its mapping and pages and asks its owner for the token again — the
 *    same thing rotating `AUTH_SECRET` does (spec §8).
 *
 *  - **`oauth_access_token` is skipped whole** (MCP access spec, Phase 3). Its
 *    rows are the `mcp` plugin's bearer and refresh tokens, stored as issued —
 *    the same reason `session` is skipped. A restore signs every connected app
 *    out; each signs in again.
 *  - **`oauth_application` is kept, with `client_secret` blanked.** The client
 *    registration is worth restoring; its secret is a credential.
 *  - **`api_tokens` is kept whole.** It holds SHA-256 hashes of personal access
 *    tokens, never a token: a hash cannot be replayed, and keeping it means a
 *    restore does not silently break every assistant somebody connected.
 *
 * Everything is named through the table objects rather than string literals, so
 * renaming a table or a column fails the typecheck here instead of quietly
 * un-redacting it.
 */

/**
 * `account` columns blanked in the export. Typed against the table's own row
 * shape: rename `refreshToken` and this list stops compiling.
 */
const ACCOUNT_SECRETS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
] as const satisfies readonly (keyof typeof account.$inferSelect)[];

/**
 * `notion_mirrors` columns blanked in the export: the owner's Notion token,
 * encrypted under a key derived from `AUTH_SECRET`.
 */
const MIRROR_SECRETS = [
  "tokenCiphertext",
] as const satisfies readonly (keyof typeof notionMirrors.$inferSelect)[];

/** `oauth_application` columns blanked in the export: a confidential client's secret. */
const OAUTH_CLIENT_SECRETS = [
  "clientSecret",
] as const satisfies readonly (keyof typeof oauthApplication.$inferSelect)[];

/** Tables the nightly file does not contain at all. */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  getTableName(session),
  getTableName(verification),
  getTableName(oauthAccessToken),
]);

/**
 * Tables the nightly file leaves out because they are **derived**, not
 * because they are secret: a manual's page text (`manual_pages`) and its search
 * passages with their 512-number embeddings (`manual_chunks`). Together they
 * are most of the file's bytes and all of them are rebuilt from the stored
 * PDFs, which live in Blob, not in the backup.
 *
 * `manual_documents` stays in — it is small and records each manual's outline
 * and status. That is also why a restore must rebuild with `--force`: the
 * restored rows already carry the current extractor and chunker versions, so a
 * plain `manuals:index` would find nothing to do.
 *
 *     npm run manuals:index -- --force
 *
 * (manual text and search spec; `docs/operations.md` "Restoring a backup").
 * Backup only: `npm run data:push` still copies these tables, since a hosted
 * database without them has no manual search until somebody re-embeds.
 */
export const REBUILT_AFTER_RESTORE: ReadonlySet<string> = new Set([
  getTableName(manualPages),
  getTableName(manualChunks),
]);

/**
 * Tables the nightly file and `data:push` leave out because their rows are
 * **promised to be short-lived** (usage insight spec §4, §8): raw usage events
 * (30 days) and the Unanswered queue, which holds scrubbed student questions
 * (30 days after last asked). A backup kept for up to three years would break
 * both promises quietly, and a restore would resurrect text that was meant to
 * be gone. Their counts live on in `usage_rollups`, which is backed up: it is
 * hourly counts and names nobody. `data:push` skips them too, so testing on a
 * local database never lands in the hosted one's numbers.
 */
export const RETENTION_BOUND: ReadonlySet<string> = new Set([getTableName(usageEvents), getTableName(usageGaps)]);

/**
 * Tables `data:push` leaves out because their rows belong to **the database
 * that made them** (starter answers): a pre-run chip answer carries that
 * database's own manual addresses (a local copy's are `localhost` ones) and a
 * hash of its rows, so copied to another deployment it would be wrong or,
 * at best, stale. The hosted deployment makes its own with
 * `npm run starters:refresh`. The nightly backup keeps them — a restore is
 * the same deployment.
 *
 * `staff_shifts` (on-shift spec 2026-10-07) for the same reason: a shift is
 * somebody saying "I am at this lab right now". Pushed from a local copy, a
 * test shift would put a name on the live home page and kiosk. The backup
 * keeps it; a restored shift has ended by its own time anyway.
 *
 * `chat_illustrations` (gateway spec amendment 2026-10-07) too: each row names
 * a private blob in the store of the deployment that drew it, which `data:push`
 * does not copy, and a person's daily ledger means nothing on another
 * deployment.
 *
 * Deliberately **not** `tool_skills` (tool skills spec 2026-10-07 §4.3),
 * though it too is AI-written and cached: a skill names its manual sources by
 * document id and page (ids survive `data:push`) and its links by the
 * manufacturer's URL, never a stored file's address, and its input hash covers
 * the same rows on both sides. A skill written on a local copy is valid on the
 * hosted one, so it travels, like `manual_eval_questions`.
 */
export const DEPLOYMENT_BOUND: ReadonlySet<string> = new Set([
  getTableName(starterAnswers),
  getTableName(staffShifts),
  getTableName(chatIllustrations),
]);

/** True when this table's rows are made per deployment and never pushed to another. */
export function isDeploymentBound(table: PgTable): boolean {
  return DEPLOYMENT_BOUND.has(getTableName(table));
}

/** True when this table's rows must not outlive their retention window in a backup or a push. */
export function isRetentionBound(table: PgTable): boolean {
  return RETENTION_BOUND.has(getTableName(table));
}

/** Per-table column blanklists, by SQL table name. */
const REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [getTableName(account)]: ACCOUNT_SECRETS,
  [getTableName(notionMirrors)]: MIRROR_SECRETS,
  [getTableName(oauthApplication)]: OAUTH_CLIENT_SECRETS,
};

/**
 * The Drizzle property names blanked for this table (empty when none). Also
 * read by `npm run data:push`, which applies the same policy to what it copies
 * to a hosted database (`src/lib/push-hosted/rows.ts`).
 */
export function redactedColumnKeys(tableName: string): readonly string[] {
  return REDACTED_COLUMNS[tableName] ?? [];
}

/**
 * True when this table's rows are credentials and must not be written to a
 * backup file — or copied by `data:push` — at all.
 */
export function isExcludedFromBackup(table: PgTable): boolean {
  return EXCLUDED_TABLES.has(getTableName(table));
}

/** True when the nightly file skips this table because a restore rebuilds it. */
export function isRebuiltAfterRestore(table: PgTable): boolean {
  return REBUILT_AFTER_RESTORE.has(getTableName(table));
}

/**
 * A copy of `rows` with this table's secret columns set to null.
 *
 * Null rather than absent: the column still exists and is nullable, so the
 * exported row stays the right shape for a restore to insert. A missing key
 * would read as "this backup predates the column", which is a different and
 * more confusing thing to hand somebody at 3am.
 */
export function redactRows(tableName: string, rows: unknown[]): unknown[] {
  const secrets = REDACTED_COLUMNS[tableName];
  if (!secrets) return rows;
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const key of secrets) {
      if (key in copy) copy[key] = null;
    }
    return copy;
  });
}
