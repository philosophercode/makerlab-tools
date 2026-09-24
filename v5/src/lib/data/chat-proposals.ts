import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { chatProposals, pendingTools, tools, user } from "../db/schema/index.ts";
import { isOneOf, PROPOSAL_SUBJECT_KIND, type ProposalSubjectKind } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { fieldProposalSchema, type FieldProposal } from "../refresh/types.ts";
import { parseResearchResult, researchResultSchema, type ResearchResult } from "../research/result.ts";
import { revisionOf, type Revision } from "./revision.ts";
import { isUuid } from "./uuid.ts";

/**
 * `chat_proposals` — changes the assistant put in front of an admin in a
 * curation turn (refresh research spec §12.2).
 *
 * A row is a {@link FieldProposal} about one subject (a tool or a pending
 * item), made at that subject's revision, by the admin whose chat it was. The
 * model writes these rows and nothing else: accepting one is the admin's click,
 * through `POST /api/chat-proposals`, never a model tool. Rows expire after
 * seven days — an expired one cannot be accepted — and are kept as history.
 *
 * Also here: the pending-item side of accepting, which writes a change into
 * `pending_tools.research` — the preliminary page's draft — conditional on
 * the item's revision, like the editor's token.
 *
 * Relative imports with `.ts` extensions, no `"server-only"`: tests and scripts
 * load it under plain Node.
 */

export interface ChatProposalRow {
  id: string;
  subjectKind: ProposalSubjectKind;
  subjectId: string;
  proposal: FieldProposal;
  baseRevision: Revision;
  chatId: string | null;
  createdBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  expiresAt: Date;
  expired: boolean;
}

export interface ChatProposalOptions {
  db?: Db;
}

export interface NewChatProposal {
  subjectKind: ProposalSubjectKind;
  subjectId: string;
  proposal: FieldProposal;
  baseRevision: Revision;
  chatId: string | null;
  createdBy: string | null;
}

export async function createChatProposal(input: NewChatProposal, options: ChatProposalOptions = {}): Promise<string> {
  const proposal = fieldProposalSchema.parse(input.proposal);
  const db = options.db ?? (await getDb());
  const [row] = await db
    .insert(chatProposals)
    .values({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      proposal,
      baseRevision: input.baseRevision,
      chatId: input.chatId?.slice(0, 200) ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: chatProposals.id });
  return row.id;
}

/** `chat_proposals.chat_id` for a proposal made over MCP, which has no chat (MCP access spec §3.3). */
export const MCP_PROPOSAL_CHAT_ID = "mcp";

/** An open proposal an assistant made over MCP, as `/admin/refresh` lists it. */
export interface AssistantProposalRow {
  id: string;
  toolId: string;
  toolName: string;
  proposal: FieldProposal;
  proposedBy: string | null;
  createdAt: Date;
}

/**
 * Open (undecided, unexpired) proposals made over MCP — `chat_id` is the
 * marker the MCP `propose_change` writes (MCP access spec §3.3) — about tools
 * that still exist, oldest first. `/admin/refresh` lists them under "Proposals
 * from assistants", where they are accepted or rejected with the same cards
 * and the same `POST /api/chat-proposals` as the chat's own.
 */
export async function listOpenAssistantProposals(
  chatId: string,
  options: ChatProposalOptions & { limit?: number } = {}
): Promise<AssistantProposalRow[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ row: chatProposals, toolName: tools.name, proposedBy: user.name })
    .from(chatProposals)
    .innerJoin(tools, eq(chatProposals.subjectId, tools.id))
    .leftJoin(user, eq(chatProposals.createdBy, user.id))
    .where(
      and(
        eq(chatProposals.chatId, chatId),
        eq(chatProposals.subjectKind, "tool"),
        isNull(chatProposals.decidedAt),
        sql`${chatProposals.expiresAt} > now()`
      )
    )
    .orderBy(chatProposals.createdAt)
    .limit(options.limit ?? 100);
  return rows.flatMap(({ row, toolName, proposedBy }) => {
    const proposal = fieldProposalSchema.safeParse(row.proposal);
    if (!proposal.success) return [];
    return [{ id: row.id, toolId: row.subjectId, toolName, proposal: proposal.data, proposedBy, createdAt: row.createdAt }];
  });
}

export async function getChatProposals(ids: readonly string[], options: ChatProposalOptions = {}): Promise<ChatProposalRow[]> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ row: chatProposals, expired: sql<boolean>`${chatProposals.expiresAt} <= now()` })
    .from(chatProposals)
    .where(inArray(chatProposals.id, valid));
  const out: ChatProposalRow[] = [];
  for (const { row, expired } of rows) {
    const proposal = fieldProposalSchema.safeParse(row.proposal);
    if (!proposal.success || !isOneOf(PROPOSAL_SUBJECT_KIND, row.subjectKind)) continue;
    out.push({
      id: row.id,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      proposal: proposal.data,
      baseRevision: row.baseRevision,
      chatId: row.chatId,
      createdBy: row.createdBy,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      expiresAt: row.expiresAt,
      expired: Boolean(expired),
    });
  }
  return valid.flatMap((id) => out.filter((row) => row.id === id));
}

/**
 * Record a decision (or a conflict's re-based card). Accepted and rejected
 * rows are closed (`decided_at`); a conflict stays open for the admin to decide
 * again. Only an open row moves.
 */
export async function saveChatProposal(
  id: string,
  update: { proposal: FieldProposal; baseRevision?: Revision; decidedBy: string | null },
  options: ChatProposalOptions = {}
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const proposal = fieldProposalSchema.parse(update.proposal);
  const closes = proposal.decision === "accepted" || proposal.decision === "rejected";
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(chatProposals)
    .set({
      proposal,
      ...(update.baseRevision ? { baseRevision: update.baseRevision } : {}),
      ...(closes ? { decidedBy: update.decidedBy, decidedAt: sql`now()` } : {}),
    })
    .where(and(eq(chatProposals.id, id), isNull(chatProposals.decidedAt)))
    .returning({ id: chatProposals.id });
  return rows.length > 0;
}

// ── The pending item's draft ────────────────────────────────────────

export interface PendingDraft {
  id: string;
  name: string;
  status: string;
  research: ResearchResult | null;
  revision: Revision;
}

/** A pending item's stored research and its revision (`extract(epoch from updated_at)`). */
export async function loadPendingDraft(id: string, options: ChatProposalOptions = {}): Promise<PendingDraft | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({
      id: pendingTools.id,
      name: pendingTools.name,
      status: pendingTools.status,
      research: pendingTools.research,
      revision: revisionOf(pendingTools.updatedAt),
    })
    .from(pendingTools)
    .where(eq(pendingTools.id, id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    research: row.research == null ? null : parseResearchResult(row.research),
    revision: String(row.revision),
  };
}

export type PendingDraftWrite = { ok: true; revision: Revision } | { ok: false; reason: "conflict" | "not_found" | "not_editable" };

/**
 * Write `research` over a **researched** pending item's result, only while the
 * item is still at `expectedRevision` — so a change the admin accepts in the
 * chat cannot overwrite an edit made on the preliminary page meanwhile.
 */
export async function writePendingResearch(
  id: string,
  expectedRevision: Revision,
  research: ResearchResult,
  options: ChatProposalOptions = {}
): Promise<PendingDraftWrite> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const valid = researchResultSchema.parse(research);
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(pendingTools)
    .set({ research: valid })
    .where(
      and(
        eq(pendingTools.id, id),
        eq(pendingTools.status, "researched"),
        sql`${revisionOf(pendingTools.updatedAt)} = ${expectedRevision}`
      )
    )
    .returning({ revision: revisionOf(pendingTools.updatedAt) });
  if (rows[0]) return { ok: true, revision: String(rows[0].revision) };
  const current = await loadPendingDraft(id, { db });
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "researched") return { ok: false, reason: "not_editable" };
  return { ok: false, reason: "conflict" };
}
