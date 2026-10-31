// @vitest-environment node
import { describeTurnCache } from "./turn-cache-log";

describe("describeTurnCache", () => {
  it("totals each step's input and the share the cache served", () => {
    const line = describeTurnCache([
      { usage: { inputTokens: 7400, outputTokens: 40, inputTokenDetails: { cacheReadTokens: 6900 } } },
      { usage: { inputTokens: 7700, outputTokens: 340, inputTokenDetails: { cacheReadTokens: 7300 } } },
    ]);
    expect(line).toBe(
      "[chat] prompt cache: 2 steps, 14200/15100 input tokens cached (94%), 380 output; per step 6900/7400, 7300/7700"
    );
  });

  it("reads the SDK's older field, and counts a step with no cache report as a miss", () => {
    expect(describeTurnCache([{ usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 500 } }])).toBe(
      "[chat] prompt cache: 1 step, 500/1000 input tokens cached (50%), 10 output; per step 500/1000"
    );
    expect(describeTurnCache([{ usage: { inputTokens: 1000, outputTokens: 10 } }])).toContain("0/1000 input tokens cached (0%)");
  });

  it("says nothing when no step reported its input", () => {
    expect(describeTurnCache([])).toBeNull();
    expect(describeTurnCache([{ usage: {} }])).toBeNull();
  });
});
