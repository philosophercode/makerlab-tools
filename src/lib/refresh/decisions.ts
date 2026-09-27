import "server-only";

import type { BlobStore } from "../blob";
import {
  getRefresh,
  getRefreshRowRevision,
  loadRefreshSubject,
  saveRefreshDecisions,
} from "../data/tool-refreshes";
import type { Db } from "../db/types";
import type { InventoryWriteWarning } from "../inventory/result";
import { requestManualArchive } from "../manuals/trigger";
import { requestMirrorPush } from "../mirror/trigger";
import { applyProposals, refusalFor, type ApplyRefusal } from "./apply";
import { acceptAllVerifiedIds, allDecided, markDecided, rebaseAfterConflict, rejectAllIds } from "./decide";
import { isUndecided, type FieldProposal } from "./types";

/**
 * Deciding a refresh's proposals (refresh research spec §3.3, §5.2): the
 * review page's Accept, Reject, **Accept all verified** and **Reject all**.
 *
 * The caller (a server action) has checked `tools.edit` and knows whether the
 * person holds `tools.publish`. Here, in order:
 *
 * 1. The refresh must be `proposed`, and still at the row revision the page
 *    was rendered with — two admins deciding one refresh cannot overwrite each
 *    other's cards (`stale_refresh`).
 * 2. **Accept** writes through the editor's save path at `base_revision`
 *    (`apply.ts`). A conflict writes nothing to the tool: the cards whose field
 *    moved take the record's value now and are marked `conflict`, the refresh
 *    re-bases onto the tool's current revision, and the admin decides again.
 * 3. The decisions are recorded on the refresh row (who and when, when the last
 *    card is decided) — the history this feature needs, instead of an audit
 *    event (§3.3).
 * 4. After a write that landed: new manual links are archived and the Notion
 *    mirror is asked to catch up, as for any editor write.
 */

export interface DecideCommand {
  refreshId: string;
  rowRevision: string;
  decision: "accept" | "reject" | "accept_all_verified" | "reject_all";
  ids?: readonly string[];
}

export interface DecideContext {
  userId: string;
  canPublish: boolean;
  db?: Db;
  store?: BlobStore | null;
}

export type DecideOutcome =
  | { ok: true; applied: number; warning?: InventoryWriteWarning }
  | { ok: false; error: ApplyRefusal | "not_editable" | "stale_refresh" };

export async function decideRefresh(command: DecideCommand, ctx: DecideContext): Promise<DecideOutcome> {
  const refresh = await getRefresh(command.refreshId, { db: ctx.db });
  if (!refresh) return { ok: false, error: "not_found" };
  if (refresh.status !== "proposed" || !refresh.proposals) return { ok: false, error: "not_editable" };
  const rowRevision = await getRefreshRowRevision(refresh.id, { db: ctx.db });
  if (rowRevision !== command.rowRevision) return { ok: false, error: "stale_refresh" };

  const subject = await loadRefreshSubject(refresh.toolId, { db: ctx.db });
  if (!subject) return { ok: false, error: "not_found" };
  const proposals = refresh.proposals;
  const policy = { canPublish: ctx.canPublish, toolPublished: subject.published };

  const chosen = new Set(choose(proposals, command, policy));
  if (chosen.size === 0) return { ok: false, error: "invalid_field" };

  const save = (next: FieldProposal[], baseRevision: string) =>
    saveRefreshDecisions(
      refresh.id,
      command.rowRevision,
      { proposals: next, baseRevision, decidedBy: ctx.userId, close: allDecided(next) },
      { db: ctx.db }
    );

  if (command.decision === "reject" || command.decision === "reject_all") {
    const next = markDecided(proposals, chosen, "rejected");
    if (!(await save(next, refresh.baseRevision))) return { ok: false, error: "stale_refresh" };
    return { ok: true, applied: 0 };
  }

  // A single Accept of a card that cannot be accepted says why.
  if (command.decision === "accept") {
    for (const p of proposals.filter((proposal) => chosen.has(proposal.id))) {
      const refusal = refusalFor(p, policy);
      if (refusal) return { ok: false, error: refusal };
    }
  }

  const selected = proposals.filter((p) => chosen.has(p.id));
  const applied = await applyProposals(selected, {
    toolId: refresh.toolId,
    baseRevision: refresh.baseRevision,
    actorUserId: ctx.userId,
    canPublish: ctx.canPublish,
    toolPublished: subject.published,
    db: ctx.db,
    store: ctx.store,
  });

  if (!applied.ok) {
    if (applied.error === "conflict") {
      const rebased = rebaseAfterConflict(proposals, subject);
      await save(rebased, subject.revision);
    }
    return { ok: false, error: applied.error };
  }

  const next = markDecided(proposals, new Set(applied.applied), "accepted");
  const recorded = await save(next, applied.revision);
  if (!recorded) console.warn(`[refresh] ${refresh.id}: accepted proposals landed, but the decision record was taken by another save`);
  if (applied.resourceIds.length > 0) await requestManualArchive(applied.resourceIds);
  await requestMirrorPush();
  return { ok: true, applied: applied.applied.length, ...(applied.warning ? { warning: applied.warning } : {}) };
}

/** The cards a decision names. Accept-all skips what cannot be accepted — unverified quotes, a name the person may not publish. */
function choose(
  proposals: readonly FieldProposal[],
  command: DecideCommand,
  policy: { canPublish: boolean; toolPublished: boolean }
): string[] {
  switch (command.decision) {
    case "accept_all_verified":
      return acceptAllVerifiedIds(proposals).filter((id) => {
        const p = proposals.find((proposal) => proposal.id === id);
        return p ? refusalFor(p, policy) === null : false;
      });
    case "reject_all":
      return rejectAllIds(proposals);
    case "accept":
    case "reject": {
      const ids = new Set(command.ids ?? []);
      return proposals.filter((p) => ids.has(p.id) && isUndecided(p)).map((p) => p.id);
    }
  }
}
