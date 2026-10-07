import "server-only";

import { turnSpend } from "../chat/turn-spend";
import { chargeDemoPass } from "../data/demo-signups";
import { demoPassBudgetUsd } from "./config";
import { demoPassState, type DemoPassState } from "./state";
import { turnCostUsd, type CostedStep } from "./turn-cost";

/**
 * Charge a finished chat turn to the pass that ran it (demo pass spec
 * 2026-10-07 §5.3), from `streamText`'s `onFinish`, which the SDK awaits
 * before the stream closes — so the next turn, and the chat's balance check
 * right after this one, see the new spend.
 *
 * **Never throws.** It runs inside the model stream's callback, and a failed
 * write must not reach the visitor's answer; it costs one log line and the
 * turn goes uncharged. The log names the pass id and the dollars, nothing else.
 */
export async function chargeDemoPassTurn(
  passId: string,
  steps: readonly CostedStep[],
  turn: object | undefined
): Promise<DemoPassState | null> {
  try {
    const cost = turnCostUsd(steps, turnSpend(turn));
    const ledger = await chargeDemoPass(passId, cost.usd);
    if (!ledger) return null;
    const state = demoPassState(ledger, demoPassBudgetUsd());
    console.info(
      `[demo-pass] ${passId}: turn charged $${cost.usd.toFixed(4)}${cost.estimatedSteps > 0 ? ` (${cost.estimatedSteps} step(s) estimated from tokens)` : ""}, $${state.remainingUsd.toFixed(2)} left`
    );
    return state;
  } catch (err) {
    console.warn(`[demo-pass] ${passId}: the turn could not be charged`, err instanceof Error ? err.name : "error");
    return null;
  }
}
