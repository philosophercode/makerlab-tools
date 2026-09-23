import "server-only";

import type { AdminActionWarning } from "../admin/action-result";
import { record, warn } from "../admin/audit-warning";
import {
  approvePendingAsUnit,
  approvePendingTool,
  type ApprovePendingInput,
} from "../data/pending-tools";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { requestMirrorPush } from "../mirror/trigger";
import { invalidateCatalog } from "../revalidate";

/**
 * Approving a researched item, with what approval owes afterwards (spec §5.4
 * step 11, §4.11, Article 5).
 *
 * `approvePendingTool` and `approvePendingAsUnit` are the only functions in the
 * app that turn research into catalogue, and they deliberately do nothing
 * else: `src/lib/data/` is loaded by `scripts/` under plain Node, where
 * `next/cache` does not exist. This module is the layer between them and the
 * `/admin/intake` server actions — the counterpart of `src/lib/inventory/*` —
 * and it does the two things every approval owes once it has committed:
 *
 * 1. **The audit trail.** `pending.approved` always, about the pending item;
 *    and `tool.published` as well when the approval published, because a tool
 *    that reached the public catalogue through intake reached it as surely as
 *    one published from the editor, and the trail must say so in the same
 *    words.
 * 2. **The catalogue cache.** `invalidateCatalog()`, for a draft too — the
 *    inventory table and `catalog.view_drafts` read it, and a draft is one
 *    click from published.
 * 3. **The Notion mirror.** `requestMirrorPush()` (§3.8 trigger 1: "Approving
 *    a tool … calls `requestMirrorPush()`"), for a draft too, since the mirror
 *    carries every tool with a Published checkbox. It never throws and costs
 *    one query when nobody has a mirror; the push itself runs minutes later
 *    in a workflow, so Notion being down cannot touch an approval.
 *
 * **A lost audit event is a warning on a success, never a failure.** The tool
 * exists by the time the event is written; answering `{ ok: false }` would tell
 * the page nothing was created, and a second press would create it twice
 * (Article 4). The channel is `src/lib/admin/audit-warning.ts`, shared with
 * every admin surface.
 *
 * Not a `"use server"` module — nothing here is an endpoint, and nothing here
 * checks a permission. The actions in `app/admin/intake/actions.ts` gate first.
 */

/** Names this surface in the console line a missing audit event leaves behind. */
const AUDIT_SURFACE = "admin/intake";

/**
 * Why an approval did nothing. Every one is also an `admin.errors.<code>`.
 *
 * The data layer's own refusals, passed straight through: `low_confidence` is
 * the "I've checked this" gate (§5.4 step 12), `not_editable` the item having
 * moved on (researching again, approved by somebody else, discarded), and
 * `duplicate_serial` the unit index refusing a serial the tool already has.
 */
export type IntakeApprovalError =
  "not_found" | "not_editable" | "low_confidence" | "invalid_field" | "duplicate_serial";

/** What an approval answers. `slug` is where the tool now lives. */
export type IntakeApprovalResult =
  | { ok: true; toolId: string; slug: string; published: boolean; warning?: AdminActionWarning }
  | { ok: false; error: IntakeApprovalError };

/** Who is approving. Always a signed-in person — the gate saw to that. */
export interface IntakeApprover {
  userId: string;
}

export interface IntakeApprovalOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * **Approve** or **Approve as draft** (`input.publish`).
 *
 * The write is one transaction in the data layer; everything here runs only
 * once it has committed, and only as far as each step earns. A refusal stops
 * at the write — nothing changed, so there is nothing to record, nothing
 * stale to bust and nothing to mirror.
 */
export async function approveAndRecord(
  approver: IntakeApprover,
  input: Omit<ApprovePendingInput, "actorUserId">,
  options: IntakeApprovalOptions = {}
): Promise<IntakeApprovalResult> {
  const approved = await approvePendingTool(
    { ...input, actorUserId: approver.userId },
    { db: options.db }
  );
  if (!approved.ok) return { ok: false, error: approved.reason };

  const pendingRecorded = await record(
    {
      actorUserId: approver.userId,
      action: "pending.approved",
      subjectType: "pending_tool",
      subjectId: input.id,
      detail: {
        toolId: approved.toolId,
        unitId: approved.unitId,
        published: approved.published,
        asUnit: false,
        overridden: approved.overridden,
        note: input.overrideNote?.trim() || null,
      },
    },
    AUDIT_SURFACE
  );

  // Its own event, in the words the editor's Publish uses: "which tools did
  // the public catalogue gain, and who decided" has one answer whichever door
  // the tool came in through.
  const publishRecorded = approved.published
    ? await record(
        {
          actorUserId: approver.userId,
          action: "tool.published",
          subjectType: "tool",
          subjectId: approved.toolId,
          detail: { pendingId: input.id },
        },
        AUDIT_SURFACE
      )
    : true;

  invalidateCatalog();
  await requestMirrorPush({ db: options.db });

  return {
    ok: true,
    toolId: approved.toolId,
    slug: approved.slug,
    published: approved.published,
    ...warn(undefined, pendingRecorded && publishRecorded),
  };
}

/**
 * **Add unit** — an add-unit item becomes another unit of the tool it matched.
 *
 * Nothing is published by this, so the only event is `pending.approved` with
 * `asUnit: true`. `published` in the answer is the *existing* tool's state, read
 * inside the approval's own transaction, so the page can say whether the link
 * it offers is a public page or a draft only staff can open. Nothing fallible
 * runs between the commit and the cache invalidation: a unit that exists must
 * never be reported as a failure (Article 4).
 */
export async function addUnitAndRecord(
  approver: IntakeApprover,
  input: { id: string; serialNumber?: string | null },
  options: IntakeApprovalOptions = {}
): Promise<IntakeApprovalResult> {
  const db = options.db ?? (await getDb());

  const added = await approvePendingAsUnit(
    { id: input.id, actorUserId: approver.userId, serialNumber: input.serialNumber },
    { db }
  );
  if (!added.ok) return { ok: false, error: added.reason };
  const published = added.published;

  // A new unit changes what the tool page says about availability — and what
  // the mirror's Units database holds. Neither can throw.
  invalidateCatalog();
  await requestMirrorPush({ db });

  const recorded = await record(
    {
      actorUserId: approver.userId,
      action: "pending.approved",
      subjectType: "pending_tool",
      subjectId: input.id,
      detail: {
        toolId: added.toolId,
        unitId: added.unitId,
        published,
        asUnit: true,
        overridden: false,
        note: null,
      },
    },
    AUDIT_SURFACE
  );

  return {
    ok: true,
    toolId: added.toolId,
    slug: added.slug,
    published,
    ...warn(undefined, recorded),
  };
}
