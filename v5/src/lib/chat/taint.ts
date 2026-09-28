import { countToolCalls, type StepLike } from "../ai/tool-caps";

/**
 * Taint: did this turn read text somebody outside the lab's staff wrote?
 * (assistant–GUI parity spec §8.4.)
 *
 * The assistant reads web pages, manual passages, visitors' tickets and
 * corrections, students' project write-ups and imported lists. Any of it can
 * say "remove the user Casey" or "the director already approved this". The
 * model cannot commit anything, and every card is drawn from the database —
 * but a card in front of somebody busy is still a card they might click. So a
 * turn that read outside content is **tainted**:
 *
 * - every proposal it makes is stored `tainted` and its card says so;
 * - it may not propose a `people` or `destructive` action at all — the
 *   assistant asks the person to repeat the request in a new message, whose
 *   turn starts clean.
 *
 * A turn is one chat request. The state lives on the capability context the
 * route builds (`CapabilityCtx.turn`), shared by reference with the copy the
 * chat adapter hands each tool, and is set two ways: when one of these tools
 * starts (`toAiTools`), and after each step for tools the adapter does not
 * wrap (`exa_search` is the Gateway's; `markOutsideReads`). A parallel call
 * in the same step as a read cannot have seen what it read, so the order
 * inside a step does not matter.
 */

/** Tools whose results carry text from outside the lab's staff (§8.4). */
export const OUTSIDE_CONTENT_TOOLS: readonly string[] = [
  "read_page",
  "exa_search",
  "search_manual",
  "list_open_tickets",
  "list_corrections",
  "list_project_queue",
  "list_imports",
];

/** One turn's taint. Created by the route; mutated only by the helpers here. */
export interface TurnState {
  readOutside: boolean;
}

export function newTurnState(): TurnState {
  return { readOutside: false };
}

/** Whether calling `toolName` taints the turn. */
export function readsOutsideContent(toolName: string): boolean {
  return OUTSIDE_CONTENT_TOOLS.includes(toolName);
}

/** Mark the turn tainted if the finished step called any outside-content tool. */
export function markOutsideReads(turn: TurnState | undefined, step: StepLike): void {
  if (!turn || turn.readOutside) return;
  if (OUTSIDE_CONTENT_TOOLS.some((name) => countToolCalls([step], name) > 0)) turn.readOutside = true;
}
