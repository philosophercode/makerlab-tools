import "server-only";

import { record, warn } from "../admin/audit-warning";
import type { NewAuditEvent } from "../data/audit";
import type { Revision } from "../data/revision";
import {
  markToolReviewed,
  setToolArchived,
  setToolPublished,
  type ToolWriteResult,
} from "../data/tools";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { invalidateCatalog } from "../revalidate";
import type { InventoryWriteResult } from "./result";

/**
 * The five changes to a tool's state (spec §5.3(5), §4.11, Article 5).
 *
 * Publish, unpublish, archive and restore are the security-relevant ones — they
 * decide what the public catalogue shows — so each writes an `audit_events`
 * row. They are in their own module, apart from `./tool-edits.ts`, because that
 * is the whole difference between them and an ordinary edit.
 *
 * **A lost audit event is a warning on a success, never a failure.** The row
 * has already changed by the time the event is written; answering
 * `{ ok: false }` would make the panel restore the previous value and assert a
 * state the database no longer holds. `record` and `warn` come from
 * `src/lib/admin/audit-warning.ts` — the channel `/admin/users` opened in
 * Phase 4, shared rather than re-invented.
 *
 * **Tools are archived, never deleted** (§5.3 "Deleting"): maintenance history,
 * project links and printed QR labels all point at rows that must survive. An
 * archived tool can be restored, and the data layer has no delete to call.
 */

/** Names this surface in the console line a missing audit event leaves behind. */
const AUDIT_SURFACE = "inventory";

export interface ToolStateChange {
  toolId: string;
  /** The token the panel received when it opened. */
  expectedRevision: Revision;
  /** Who is doing it. Recorded as the audit event's actor. */
  actorUserId?: string | null;
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** Publish a tool: the draft becomes catalogue (Article 5). */
export async function publishTool(input: ToolStateChange): Promise<InventoryWriteResult> {
  return changeState(input, (db) =>
    setToolPublished(input.toolId, true, input.expectedRevision, {
      db,
      actorUserId: input.actorUserId,
    }),
    () => ({
      actorUserId: input.actorUserId ?? null,
      action: "tool.published",
      subjectType: "tool",
      subjectId: input.toolId,
    })
  );
}

/** Unpublish: the tool stops being catalogue without losing anything. */
export async function unpublishTool(input: ToolStateChange): Promise<InventoryWriteResult> {
  return changeState(input, (db) =>
    setToolPublished(input.toolId, false, input.expectedRevision, {
      db,
      actorUserId: input.actorUserId,
    }),
    () => ({
      actorUserId: input.actorUserId ?? null,
      action: "tool.unpublished",
      subjectType: "tool",
      subjectId: input.toolId,
    })
  );
}

/** Archive: the machine is gone, its history is not. Never a delete. */
export async function archiveTool(input: ToolStateChange): Promise<InventoryWriteResult> {
  return changeState(input, (db) =>
    setToolArchived(input.toolId, true, input.expectedRevision, {
      db,
      actorUserId: input.actorUserId,
    }),
    () => ({
      actorUserId: input.actorUserId ?? null,
      action: "tool.archived",
      subjectType: "tool",
      subjectId: input.toolId,
      detail: { archived: true },
    })
  );
}

/**
 * Restore an archived tool.
 *
 * `AUDIT_ACTIONS` has no `tool.restored` (§4.11), so this is `tool.archived`
 * with `archived: false` — the shape `setUserBanned` already uses for a lifted
 * ban, and for the same reason: a vocabulary that drifts from the spec is worse
 * than a flag in the detail.
 */
export async function restoreTool(input: ToolStateChange): Promise<InventoryWriteResult> {
  return changeState(input, (db) =>
    setToolArchived(input.toolId, false, input.expectedRevision, {
      db,
      actorUserId: input.actorUserId,
    }),
    () => ({
      actorUserId: input.actorUserId ?? null,
      action: "tool.archived",
      subjectType: "tool",
      subjectId: input.toolId,
      detail: { archived: false },
    })
  );
}

/**
 * **Looks good** — the inventory review's mark (§5.3(3)). Stamps
 * `last_reviewed_at` and `last_reviewed_by`.
 *
 * **No audit event, deliberately.** `AUDIT_ACTIONS` is the whole vocabulary
 * (§4.11) and has no entry for a review, because §4.11 scopes the trail to
 * security-relevant actions and says ordinary edits are not logged — and this
 * is an ordinary edit that happens to be one click. The alternative is inventing
 * a `tool.reviewed` action, which is a spec change, not an implementation
 * detail. Worth revisiting if the review pass turns out to need an answer to
 * "who said this was fine in March"; the columns already record it.
 */
export async function markReviewed(input: ToolStateChange): Promise<InventoryWriteResult> {
  return changeState(input, (db) =>
    markToolReviewed(input.toolId, input.expectedRevision, {
      db,
      actorUserId: input.actorUserId,
    })
  );
}

/**
 * Write, record, invalidate — in that order, and only as far as each step
 * earns.
 *
 * A refusal stops at the write: nothing changed, so there is nothing to record
 * and nothing stale to bust. A change that lands carries on regardless of what
 * the audit write does.
 */
async function changeState(
  input: ToolStateChange,
  write: (db: Db) => Promise<ToolWriteResult>,
  event?: () => NewAuditEvent
): Promise<InventoryWriteResult> {
  const db = input.db ?? (await getDb());

  const written = await write(db);
  if (!written.ok) return { ok: false, error: written.reason };

  const recorded = event ? await record(event(), AUDIT_SURFACE) : true;

  invalidateCatalog();
  return { ok: true, revision: written.revision, ...warn(undefined, recorded) };
}
