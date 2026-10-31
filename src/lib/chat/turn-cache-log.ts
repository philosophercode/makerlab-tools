/**
 * The log line that says whether a chat turn's prompt came from the
 * provider's cache: per step, the input tokens and how many of them were read
 * from the cache, then the turn's totals. The chat prompt is ordered so the
 * cache can hit (stable first, per-request last, `capabilities/chat-adapter.ts`);
 * this is how to see that it does, in the deployment's logs, without the
 * Gateway's dashboard.
 *
 * Counts only — never a word of the prompt. Plain Node, no imports.
 */

/** The part of an AI SDK step's usage this reads. */
export interface UsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined };
  /** The SDK's older name for `inputTokenDetails.cacheReadTokens`. */
  cachedInputTokens?: number | undefined;
}

function cacheRead(usage: UsageLike): number {
  return usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
}

/**
 * `[chat] prompt cache: 2 steps, 14210/15102 input tokens cached (94%), 380 output; per step 6900/7400, 7310/7702`
 * — or null when no step reported its input.
 */
export function describeTurnCache(steps: readonly { usage: UsageLike }[]): string | null {
  const reported = steps.filter((step) => typeof step.usage.inputTokens === "number");
  if (reported.length === 0) return null;
  let input = 0;
  let cached = 0;
  let output = 0;
  const perStep: string[] = [];
  for (const { usage } of reported) {
    const stepInput = usage.inputTokens ?? 0;
    const stepCached = cacheRead(usage);
    input += stepInput;
    cached += stepCached;
    output += usage.outputTokens ?? 0;
    perStep.push(`${stepCached}/${stepInput}`);
  }
  const share = input > 0 ? Math.round((cached / input) * 100) : 0;
  const count = `${reported.length} step${reported.length === 1 ? "" : "s"}`;
  return `[chat] prompt cache: ${count}, ${cached}/${input} input tokens cached (${share}%), ${output} output; per step ${perStep.join(", ")}`;
}
