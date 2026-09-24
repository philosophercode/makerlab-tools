import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { BlobStore } from "../blob";
import {
  getChatProposals,
  loadPendingDraft,
  saveChatProposal,
  writePendingResearch,
  type ChatProposalRow,
} from "../data/chat-proposals";
import { getDb } from "../db/client";
import { chatProposals } from "../db/schema/index";
import type { Db } from "../db/types";
import type { InventoryWriteWarning } from "../inventory/result";
import { requestManualArchive } from "../manuals/trigger";
import { requestMirrorPush } from "../mirror/trigger";
import { applyProposals, refusalFor } from "./apply";
import { applyToResearch, loadCurationSubject, pendingRecord } from "./curation";
import { currentValue } from "./decide";
import type { FieldProposal } from "./types";

/**
 * Accepting and rejecting the assistant's proposals (refresh research spec
 * §12.2): the admin's click on a `data-proposal` card, through
 * `POST /api/chat-proposals` — never a model tool.
 *
 * - **Permission, again**: `tools.edit` for a tool, `tools.approve` for a
 *   pending item; the caller's, checked per subject.
 * - **A tool** is written through the same path as a refresh (`apply.ts`: the
 *   editor save with the proposal's `base_revision`). A stale revision writes
 *   nothing: the card becomes a conflict showing the record's value now, re-based
 *   onto the current revision, to be decided again.
 * - **A pending item** gets the change written into its research — the
 *   preliminary page's draft — conditional on the item's revision.
 * - **Siblings follow.** Accepting one card moves the record's revision, which
 *   would make every other open card from the same turn a false conflict; the
 *   open cards about *other* fields, made at the revision this write started
 *   from, are moved to the new one.
 * - Expired (older than seven days) and already-decided cards are refused.
 */

export interface ChatDecisionContext {
  userId: string;
  canEditTools: boolean;
  canApprove: boolean;
  canPublish: boolean;
  db?: Db;
  store?: BlobStore | null;
}

export type ChatDecisionOutcome =
  | { id: string; status: "accepted" | "rejected"; proposal: FieldProposal; warning?: InventoryWriteWarning }
  | { id: string; status: "conflict"; proposal: FieldProposal }
  | { id: string; status: "refused"; error: string };

export async function decideChatProposals(
  ids: readonly string[],
  decision: "accept" | "reject",
  ctx: ChatDecisionContext
): Promise<ChatDecisionOutcome[]> {
  const db = ctx.db ?? (await getDb());
  const rows = await getChatProposals(ids, { db });
  const out: ChatDecisionOutcome[] = [];
  const found = new Set(rows.map((row) => row.id));
  for (const id of ids) if (!found.has(id)) out.push({ id, status: "refused", error: "not_found" });

  const allowed: ChatProposalRow[] = [];
  for (const row of rows) {
    const permitted = row.subjectKind === "tool" ? ctx.canEditTools : ctx.canApprove;
    if (!permitted) out.push({ id: row.id, status: "refused", error: "not_permitted" });
    else if (row.decidedAt) out.push({ id: row.id, status: "refused", error: "not_editable" });
    else if (row.expired) out.push({ id: row.id, status: "refused", error: "expired" });
    else allowed.push(row);
  }

  if (decision === "reject") {
    for (const row of allowed) {
      const proposal: FieldProposal = { ...row.proposal, decision: "rejected" };
      await saveChatProposal(row.id, { proposal, decidedBy: ctx.userId }, { db });
      out.push({ id: row.id, status: "rejected", proposal });
    }
    return order(ids, out);
  }

  // One write per subject and starting revision, so accepting five cards from
  // one turn is one save.
  const groups = new Map<string, ChatProposalRow[]>();
  for (const row of allowed) {
    const key = `${row.subjectKind}:${row.subjectId}:${row.baseRevision}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const results =
      group[0].subjectKind === "tool" ? await acceptForTool(group, ctx, db) : await acceptForPending(group, ctx, db);
    out.push(...results);
  }
  return order(ids, out);
}

async function acceptForTool(group: ChatProposalRow[], ctx: ChatDecisionContext, db: Db): Promise<ChatDecisionOutcome[]> {
  const { subjectId, baseRevision } = group[0];
  const subject = await loadCurationSubject("tool", subjectId, { db });
  if (!subject) return group.map((row) => ({ id: row.id, status: "refused" as const, error: "not_found" }));

  const refused: ChatDecisionOutcome[] = [];
  const acceptable = group.filter((row) => {
    const refusal = refusalFor(row.proposal, { canPublish: ctx.canPublish, toolPublished: subject.published });
    if (refusal) refused.push({ id: row.id, status: "refused", error: refusal });
    return !refusal;
  });
  if (acceptable.length === 0) return refused;

  const applied = await applyProposals(
    acceptable.map((row) => ({ ...row.proposal, id: row.id })),
    {
      toolId: subject.id,
      baseRevision,
      actorUserId: ctx.userId,
      canPublish: ctx.canPublish,
      toolPublished: subject.published,
      db,
      store: ctx.store,
    }
  );

  if (!applied.ok) {
    if (applied.error !== "conflict") return [...refused, ...acceptable.map((row) => ({ id: row.id, status: "refused" as const, error: applied.error }))];
    const now = await loadCurationSubject("tool", subjectId, { db });
    const results: ChatDecisionOutcome[] = [];
    for (const row of acceptable) {
      const proposal: FieldProposal = { ...row.proposal, decision: "conflict", current: now ? currentValue(now.record, row.proposal) : row.proposal.current };
      await saveChatProposal(row.id, { proposal, baseRevision: now?.revision, decidedBy: ctx.userId }, { db });
      results.push({ id: row.id, status: "conflict", proposal });
    }
    return [...refused, ...results];
  }

  const done = new Set(applied.applied);
  const results: ChatDecisionOutcome[] = [];
  for (const row of acceptable) {
    if (!done.has(row.id)) {
      results.push({ id: row.id, status: "refused", error: "failed" });
      continue;
    }
    const proposal: FieldProposal = { ...row.proposal, decision: "accepted" };
    await saveChatProposal(row.id, { proposal, decidedBy: ctx.userId }, { db });
    results.push({ id: row.id, status: "accepted", proposal, ...(applied.warning ? { warning: applied.warning } : {}) });
  }
  await rebaseSiblings(db, "tool", subjectId, baseRevision, applied.revision, acceptable.map((row) => row.proposal.field));
  if (applied.resourceIds.length > 0) await requestManualArchive(applied.resourceIds);
  await requestMirrorPush();
  return [...refused, ...results];
}

async function acceptForPending(group: ChatProposalRow[], ctx: ChatDecisionContext, db: Db): Promise<ChatDecisionOutcome[]> {
  const { subjectId, baseRevision } = group[0];
  const draft = await loadPendingDraft(subjectId, { db });
  if (!draft || !draft.research) return group.map((row) => ({ id: row.id, status: "refused" as const, error: "not_found" }));
  if (draft.status !== "researched") return group.map((row) => ({ id: row.id, status: "refused" as const, error: "not_editable" }));

  const conflict = async (): Promise<ChatDecisionOutcome[]> => {
    const record = pendingRecord(draft.research!);
    const results: ChatDecisionOutcome[] = [];
    for (const row of group) {
      const proposal: FieldProposal = { ...row.proposal, decision: "conflict", current: currentValue(record, row.proposal) };
      await saveChatProposal(row.id, { proposal, baseRevision: draft.revision, decidedBy: ctx.userId }, { db });
      results.push({ id: row.id, status: "conflict", proposal });
    }
    return results;
  };
  if (draft.revision !== baseRevision) return conflict();

  const refused: ChatDecisionOutcome[] = [];
  let research = draft.research;
  const accepted: ChatProposalRow[] = [];
  for (const row of group) {
    const refusal = refusalFor(row.proposal, { canPublish: true, toolPublished: false });
    const next = refusal ? null : applyToResearch(research, row.proposal);
    if (!next) {
      refused.push({ id: row.id, status: "refused", error: refusal ?? "invalid_field" });
      continue;
    }
    research = next;
    accepted.push(row);
  }
  if (accepted.length === 0) return refused;

  const written = await writePendingResearch(subjectId, baseRevision, research, { db });
  if (!written.ok) {
    if (written.reason === "conflict") return [...refused, ...(await conflict())];
    return [...refused, ...accepted.map((row) => ({ id: row.id, status: "refused" as const, error: written.reason }))];
  }
  const results: ChatDecisionOutcome[] = [];
  for (const row of accepted) {
    const proposal: FieldProposal = { ...row.proposal, decision: "accepted" };
    await saveChatProposal(row.id, { proposal, decidedBy: ctx.userId }, { db });
    results.push({ id: row.id, status: "accepted", proposal });
  }
  await rebaseSiblings(db, "pending", subjectId, baseRevision, written.revision, accepted.map((row) => row.proposal.field));
  // Nothing cached reads a pending item; the page re-renders on its next request.
  return [...refused, ...results];
}

/**
 * Move the other open cards of this subject — made at the revision this write
 * started from, about fields it did not touch — onto the new revision, so our
 * own accept does not turn them into conflicts.
 */
async function rebaseSiblings(
  db: Db,
  kind: "tool" | "pending",
  subjectId: string,
  from: string,
  to: string,
  touched: readonly string[]
): Promise<void> {
  const fields = [...new Set(touched)].filter((field) => field !== "resource");
  await db
    .update(chatProposals)
    .set({ baseRevision: to })
    .where(
      and(
        eq(chatProposals.subjectKind, kind),
        eq(chatProposals.subjectId, subjectId),
        eq(chatProposals.baseRevision, from),
        isNull(chatProposals.decidedAt),
        fields.length > 0
          ? sql`not (${chatProposals.proposal}->>'field' in (${sql.join(
              fields.map((field) => sql`${field}`),
              sql`, `
            )}))`
          : undefined
      )
    );
}

function order(ids: readonly string[], outcomes: ChatDecisionOutcome[]): ChatDecisionOutcome[] {
  return ids.flatMap((id) => outcomes.filter((outcome) => outcome.id === id));
}
