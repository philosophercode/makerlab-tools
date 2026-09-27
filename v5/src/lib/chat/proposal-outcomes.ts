import "server-only";

import type { Identity } from "../auth/identity";
import { actionById } from "../actions/registry";
import { listChatActionProposals, type ActionProposalRecord } from "../data/action-proposals";
import { fenceUntrusted, OTHERS_TEXT_NOTE } from "../web/fence";

/**
 * "Proposals in this conversation" (assistant–GUI parity spec §5.3): what
 * became of every card this chat produced, **read from the database** at the
 * start of each turn.
 *
 * The card's result is never posted back as a message — a client could forge
 * one, and "the director already confirmed" is exactly the sentence an
 * injection would write. So "did it work?" is answered from `action_proposals`
 * rows this person created in this chat, and the prompt's rule is that
 * nothing is done unless this block says confirmed.
 */

const SHOWN = 15;

function statusWords(row: ActionProposalRecord): string {
  if (row.expired) return "expired unconfirmed — nothing changed";
  switch (row.status) {
    case "open":
      return "waiting for the person to press Confirm — nothing has changed yet";
    case "confirming":
      return "being applied";
    case "confirmed":
      return row.result?.warning ? "confirmed and done (but the change was not recorded in the audit trail)" : "confirmed and done";
    case "failed":
      return `refused when confirmed (${String(row.result?.error ?? "failed")}) — nothing changed`;
    case "conflict":
      return "not applied: the record changed in the meantime";
    case "cancelled":
      return "dismissed by the person — nothing changed";
  }
}

export function proposalOutcomesSection(rows: readonly ActionProposalRecord[]): string {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, SHOWN).map((row) => {
    const tool = actionById(row.actionId)?.toolName ?? row.actionId;
    const subject = String(row.preview.subjectName ?? row.subjectId);
    return `- ${tool} on "${subject}": ${statusWords(row)}`;
  });
  return `## Proposals in this conversation

What became of each confirmation card in this chat, newest first, read from the app's database. This is the only evidence of whether a change happened: say something was done only if it is **confirmed and done** here.

${fenceUntrusted("this conversation's proposals", lines.join("\n"), OTHERS_TEXT_NOTE)}`;
}

/** The block for this turn, or "" — never throws. */
export async function loadProposalOutcomes(chatId: string | undefined, identity: Identity): Promise<string> {
  if (!chatId || !identity.userId) return "";
  try {
    return proposalOutcomesSection(await listChatActionProposals(chatId, identity.userId, { limit: SHOWN }));
  } catch (error) {
    console.warn(`[chat] proposal outcomes not loaded: ${error instanceof Error ? error.name : "error"}`);
    return "";
  }
}
