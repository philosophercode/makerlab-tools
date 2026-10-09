import { EXA_SEARCH_FALLBACK_USD, exaSearchCost } from "../ai/exa";
import { FALLBACK_INPUT_USD_PER_MILLION, FALLBACK_OUTPUT_USD_PER_MILLION, turnCostUsd, type CostedStep } from "./turn-cost";

/**
 * What a chat turn costs a demo pass (demo pass spec 2026-10-07 §5.3): the
 * Gateway's figure for each step, an estimate (deliberately high) for a step
 * that reported none, Exa's own figure, and the manual search's side costs.
 */

const step = (cost: unknown, usage = { inputTokens: 1000, outputTokens: 200 }, extra: Partial<CostedStep> = {}): CostedStep => ({
  providerMetadata: cost === undefined ? {} : { gateway: { cost } },
  usage,
  toolCalls: [],
  toolResults: [],
  ...extra,
});

describe("turnCostUsd", () => {
  it("adds up the Gateway's reported cost for every step", () => {
    expect(turnCostUsd([step("0.0123"), step(0.002)])).toEqual({ usd: 0.0143, estimatedSteps: 0 });
  });

  it("estimates a step with no reported cost from its tokens, at the high rate", () => {
    const { usd, estimatedSteps } = turnCostUsd([step(undefined, { inputTokens: 100_000, outputTokens: 10_000 })]);
    expect(estimatedSteps).toBe(1);
    expect(usd).toBeCloseTo((100_000 * FALLBACK_INPUT_USD_PER_MILLION + 10_000 * FALLBACK_OUTPUT_USD_PER_MILLION) / 1e6, 10);
    // Never free: an unreported step is charged something whenever it used tokens.
    expect(usd).toBeGreaterThan(0);
  });

  it("charges each Exa search at its reported price, and the measured price when it reports none", () => {
    const searched = step(0.001, undefined, {
      toolCalls: [{ toolName: "exa_search" }, { toolName: "exa_search" }],
      toolResults: [
        { toolName: "exa_search", output: { results: [], costDollars: { total: 0.005 } } },
        { toolName: "exa_search", output: { results: [] } },
      ],
    });
    expect(exaSearchCost([searched])).toBeCloseTo(0.005 + EXA_SEARCH_FALLBACK_USD, 10);
    expect(turnCostUsd([searched]).usd).toBeCloseTo(0.001 + 0.005 + EXA_SEARCH_FALLBACK_USD, 10);
  });

  it("adds the turn's side costs (the manual search's embedding and reranking)", () => {
    expect(turnCostUsd([step(0.01)], 0.0004).usd).toBeCloseTo(0.0104, 10);
    expect(turnCostUsd([step(0.01)], Number.NaN).usd).toBeCloseTo(0.01, 10);
  });

  it("charges nothing for nothing", () => {
    expect(turnCostUsd([])).toEqual({ usd: 0, estimatedSteps: 0 });
  });
});
