import { exaSearchCost } from "../ai/exa";
import { gatewayCallReport } from "../ai/gateway-usage";
import type { StepLike } from "../ai/tool-caps";

/**
 * What one chat turn cost, for a demo pass's ledger (demo pass spec
 * 2026-10-07 §5.3). Pure.
 *
 * - **Each model step** at the cost the Gateway reported for it
 *   (`providerMetadata.gateway.cost`, `ai/gateway-usage.ts`).
 * - **A step that reported none** at an estimate from its tokens, at a rate
 *   set deliberately above the chat model's price, so a missing figure can
 *   only make a pass run out sooner, never later.
 * - **Exa searches** at the price each result reported (`ai/exa.ts`).
 * - **Side costs** the turn logged (`chat/turn-spend.ts`): the manual search's
 *   embedding and reranking.
 */

/** Dollars per million input tokens for a step with no reported cost. */
export const FALLBACK_INPUT_USD_PER_MILLION = 3;
/** Dollars per million output tokens for a step with no reported cost. */
export const FALLBACK_OUTPUT_USD_PER_MILLION = 15;

/** The parts of an AI SDK step this reads. */
export interface CostedStep extends StepLike {
  providerMetadata?: unknown;
  usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined };
}

export interface TurnCost {
  /** Dollars. */
  usd: number;
  /** Steps priced from their tokens because the Gateway reported no cost. */
  estimatedSteps: number;
}

export function turnCostUsd(steps: readonly CostedStep[], sideCostUsd = 0): TurnCost {
  let usd = 0;
  let estimatedSteps = 0;
  for (const step of steps) {
    const reported = gatewayCallReport(step.providerMetadata).cost;
    if (reported !== null && reported >= 0) {
      usd += reported;
      continue;
    }
    estimatedSteps += 1;
    usd += tokenEstimate(step.usage);
  }
  usd += exaSearchCost(steps);
  if (Number.isFinite(sideCostUsd) && sideCostUsd > 0) usd += sideCostUsd;
  return { usd, estimatedSteps };
}

function tokenEstimate(usage: CostedStep["usage"]): number {
  const input = finite(usage?.inputTokens);
  const output = finite(usage?.outputTokens);
  return (input * FALLBACK_INPUT_USD_PER_MILLION + output * FALLBACK_OUTPUT_USD_PER_MILLION) / 1_000_000;
}

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
