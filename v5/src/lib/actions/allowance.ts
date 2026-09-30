import "server-only";

import { researchAllowanceLeft } from "../intake/allowance";
import type { ActionContext } from "./define";

/**
 * What is left of the caller's research allowance today, for a spend card's
 * sentence (assistant–GUI parity spec §11 Q3: "the card shows the allowance
 * left"). A value in the summary, never a compared row: the allowance moves
 * with every press, and a card must not turn stale because the person
 * researched something else meanwhile. The click is checked against the real
 * allowance by the action itself. Never throws; "?" when it cannot be read.
 * The count itself is `intake/allowance.ts`, shared with the intake card.
 */
export async function allowanceLeft(ctx: ActionContext): Promise<number | string> {
  return (await researchAllowanceLeft(ctx.identity.userId)) ?? "?";
}
