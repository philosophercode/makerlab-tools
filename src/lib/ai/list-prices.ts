/**
 * Gateway list prices, USD per million tokens, for the backfill scripts' dry-run
 * estimates (`manuals:eval-questions`, `tools:skills`). Read from the Gateway's
 * model list on 2026-10-08. An estimate only: the Gateway's reported cost is the
 * real figure, and a flex call costs less than its list price.
 */
export interface ListPrice {
  input: number;
  output: number;
}

const LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  "openai/gpt-6-luna": { input: 0.1, output: 0.5 },
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20 },
  "anthropic/claude-fable-5.1": { input: 10, output: 50 },
};

/** `modelId`'s list price, or null for a model not listed here. */
export function listPriceFor(modelId: string): ListPrice | null {
  return LIST_PRICES[modelId] ?? null;
}

/** Dollars for these tokens at `modelId`'s list price; null when it has none here. */
export function estimateUsd(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const price = listPriceFor(modelId);
  return price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
}
