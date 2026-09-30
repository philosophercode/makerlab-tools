import "server-only";

import type { Identity } from "../auth/identity";
import { actionById } from "../actions/registry";
import { listChatActionProposals, type ActionProposalRecord } from "../data/action-proposals";
import { fenceUntrusted, inlineText, OTHERS_TEXT_NOTE } from "../web/fence";

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
      return `not applied: the record changed in the meantime${driftWords(row)} — nothing changed`;
    case "cancelled":
      return "dismissed by the person — nothing changed";
  }
}

/** "(role is now super_admin)" — the stored conflict's current values, flattened. */
function driftWords(row: ActionProposalRecord): string {
  const drifted = Array.isArray(row.result?.drifted) ? (row.result.drifted as { field?: unknown; now?: unknown }[]) : [];
  const parts = drifted.slice(0, 4).map((d) => `${inlineText(d.field, 40)} is now ${d.now === null ? "empty" : inlineText(d.now, 80)}`);
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

export function proposalOutcomesSection(rows: readonly ActionProposalRecord[]): string {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, SHOWN).map((row) => {
    const tool = actionById(row.actionId)?.toolName ?? row.actionId;
    // Quoted and flattened: a ticket title is a visitor's words, and one with
    // a line break must not add a fake "confirmed and done" line.
    const subject = inlineText(row.preview.subjectName ?? row.subjectId, 120);
    return `- ${tool} on ${subject}: ${statusWords(row)}`;
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
