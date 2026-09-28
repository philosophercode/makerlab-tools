import "server-only";

import { countResearchRequestedSince } from "../data/pending-tools";
import { researchLimitFor } from "../data/research-allowances";
import type { ActionContext } from "./define";

/**
 * What is left of the caller's research allowance today, for a spend card's
 * sentence (assistant–GUI parity spec §11 Q3: "the card shows the allowance
 * left"). A value in the summary, never a compared row: the allowance moves
 * with every press, and a card must not turn stale because the person
 * researched something else meanwhile. The click is checked against the real
 * allowance by the action itself. Never throws; "?" when it cannot be read.
 */
export async function allowanceLeft(ctx: ActionContext): Promise<number | string> {
  const userId = ctx.identity.userId;
  if (!userId) return "?";
  try {
    const [limit, used] = await Promise.all([
      researchLimitFor(userId),
      countResearchRequestedSince(userId, new Date(Date.now() - 24 * 60 * 60_000)),
    ]);
    return Math.max(0, limit - used);
  } catch {
    return "?";
  }
}
