import { citationRef } from "../manuals/citation-ref.ts";

/**
 * What a chat turn looked at, for Usage Insight (usage insight spec §5.1):
 * the manual passages `search_manual` returned — with the document id and page
 * a citation link does not carry — and the tool each search was scoped to.
 *
 * Keyed on the turn's `TurnState` (`chat/taint.ts`), the one object the route
 * builds per request and the chat adapter shares by reference with every
 * tool's copy of the context, so the log lives exactly as long as the turn.
 * MCP calls have no turn and log nothing here. Nothing in it names a person.
 */

export interface PassageUsage {
  documentId: string;
  toolId: string | null;
  page: number;
  /**
   * What the answer links it by — `#cite-<ref>`, the form the chat prompt asks
   * for (manual text spec amendment 2026-09-28) — built exactly as
   * `search_manual` built the one it returned.
   */
  ref: string;
}

interface TurnUsage {
  /** By the passage's PDF url — what a citation links to. */
  passages: Map<string, PassageUsage>;
  /** Tools a `search_manual` call was scoped to. */
  scopedToolIds: Set<string>;
}

const turns = new WeakMap<object, TurnUsage>();

function usageOf(turn: object): TurnUsage {
  let usage = turns.get(turn);
  if (!usage) {
    usage = { passages: new Map(), scopedToolIds: new Set() };
    turns.set(turn, usage);
  }
  return usage;
}

/** Record the passages a manual search returned this turn (those with a URL: only they can be cited). */
export function logManualPassages(
  turn: object | undefined,
  passages: readonly { documentId: string; toolId: string | null; pageStart: number; pdfUrl: string | null }[]
): void {
  if (!turn) return;
  const usage = usageOf(turn);
  for (const passage of passages) {
    if (!passage.pdfUrl || usage.passages.has(passage.pdfUrl)) continue;
    usage.passages.set(passage.pdfUrl, {
      documentId: passage.documentId,
      toolId: passage.toolId,
      page: passage.pageStart,
      ref: citationRef(passage.documentId, passage.pageStart),
    });
  }
}

/** Record the tool a manual search was scoped to. */
export function logScopedTool(turn: object | undefined, toolId: string | null | undefined): void {
  if (!turn || !toolId) return;
  usageOf(turn).scopedToolIds.add(toolId);
}

export function turnUsage(turn: object | undefined): { passages: ReadonlyMap<string, PassageUsage>; scopedToolIds: string[] } {
  const usage = turn ? turns.get(turn) : undefined;
  return { passages: usage?.passages ?? new Map(), scopedToolIds: [...(usage?.scopedToolIds ?? [])] };
}
