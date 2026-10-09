/**
 * Dollars a chat turn spent outside its model steps (demo pass spec
 * 2026-10-07 §5.3): the manual search's embedding and reranking calls, which
 * `search_manual` makes inside a tool and whose cost the step's own Gateway
 * figure does not include. A demo pass is charged them with the rest.
 *
 * Keyed on the turn's `TurnState` (`chat/taint.ts`) like `usage/turn-log.ts`:
 * the one object the route builds per request and every tool's context shares
 * by reference, so the tally lives exactly as long as the turn. MCP calls have
 * no turn and log nothing. Plain Node, no imports.
 */

const spends = new WeakMap<object, number>();

/** Add `usd` to the turn's tally. Nothing for a missing turn or an unreported, negative or non-finite cost. */
export function logTurnSpend(turn: object | undefined, usd: number | null | undefined): void {
  if (!turn || typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
  spends.set(turn, (spends.get(turn) ?? 0) + usd);
}

/** The turn's tally so far, in dollars. */
export function turnSpend(turn: object | undefined): number {
  return turn ? (spends.get(turn) ?? 0) : 0;
}
