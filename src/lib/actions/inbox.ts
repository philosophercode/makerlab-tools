import type { ActionProposalCardPayload } from "../capabilities/actions";
import type { ActionProposalRecord } from "../data/action-proposals";
import type { ActionPreview, ActionRisk } from "./define";

/**
 * The **Assistant proposals** inbox, as data (assistant–GUI parity spec §3.8,
 * §6): what `/admin/proposals` draws from the viewer's own MCP proposals.
 *
 * - **Open proposals become cards**, one per proposal group (what one MCP call
 *   proposed), grouped by area — the same `ActionProposalCard` the chat draws,
 *   from the same stored rows, so the inbox confirms exactly what the card in
 *   the chat would. A card never mixes groups, so bulk confirm never crosses
 *   one (§6).
 * - **Decided ones are a reference list** (the last week's): what, and how it
 *   ended.
 *
 * Pure: the page reads the rows and passes each action's risk.
 */

export interface InboxArea {
  /** The action id's area, `tools` of `tools.set_published` (`actions.inbox.area.<area>`). */
  area: string;
  cards: ActionProposalCardPayload[];
}

export interface InboxDecided {
  id: string;
  actionId: string;
  preview: ActionPreview;
  status: "confirmed" | "failed" | "conflict" | "cancelled";
  error?: string;
  decidedAt: string | null;
}

export interface InboxView {
  areas: InboxArea[];
  decided: InboxDecided[];
  /** Open and unexpired: what still waits for a click. */
  waiting: number;
}

const areaOf = (actionId: string) => actionId.split(".")[0] ?? actionId;

/**
 * Build the inbox. `areaOrder` is the registry's order of areas, so the page
 * lists them as the admin section bar does; an area it does not name goes last.
 * A row whose action is no longer registered (`riskOf` answers undefined) is
 * left out: nothing could run it.
 */
export function buildInbox(
  rows: readonly ActionProposalRecord[],
  riskOf: (actionId: string) => ActionRisk | undefined,
  areaOrder: readonly string[] = []
): InboxView {
  const groups = new Map<string, ActionProposalCardPayload>();
  const decided: InboxDecided[] = [];
  let waiting = 0;

  // Oldest first inside a card, as the chat drew it.
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const risk = riskOf(row.actionId);
    if (!risk) continue;
    const preview = row.preview as unknown as ActionPreview;
    if (row.status === "open" || row.status === "confirming") {
      if (row.status === "open" && !row.expired) waiting += 1;
      const card = groups.get(row.groupId) ?? {
        kind: "action-proposal" as const,
        groupId: row.groupId,
        actionId: row.actionId,
        risk,
        items: [],
        refused: [],
        ...(row.tainted ? { tainted: true } : {}),
      };
      card.items.push({ id: row.id, subjectId: row.subjectId, preview, expiresAt: row.expiresAt.toISOString() });
      groups.set(row.groupId, card);
      continue;
    }
    const error = typeof row.result?.error === "string" ? row.result.error : undefined;
    decided.push({
      id: row.id,
      actionId: row.actionId,
      preview,
      status: row.status,
      ...(error ? { error } : {}),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    });
  }

  const byArea = new Map<string, ActionProposalCardPayload[]>();
  // Newest card first inside an area: the one just proposed is on top.
  for (const card of [...groups.values()].reverse()) {
    const area = areaOf(card.actionId);
    byArea.set(area, [...(byArea.get(area) ?? []), card]);
  }
  const rank = (area: string) => {
    const at = areaOrder.indexOf(area);
    return at === -1 ? areaOrder.length : at;
  };
  const areas = [...byArea.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([area, cards]) => ({ area, cards }));

  decided.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  return { areas, decided, waiting };
}

/** The registry's areas in order, each once. */
export function areaOrderOf(actionIds: readonly string[]): string[] {
  return [...new Set(actionIds.map(areaOf))];
}
