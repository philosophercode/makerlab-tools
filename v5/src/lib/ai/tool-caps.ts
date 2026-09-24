/**
 * Per-turn tool caps, enforced by us (gateway spec §3.2: "Caps become ours").
 *
 * Anthropic's server tools carried their own `maxUses`; Exa through the Gateway
 * has none, and neither does a function tool like `read_page`. So the caller
 * counts the calls already made in `prepareStep` and hands the model only the
 * tools still under their cap:
 *
 * ```ts
 * prepareStep: ({ steps }) => ({
 *   activeTools: activeToolsWithinCaps(TOOL_NAMES, steps, { exa_search: 5, read_page: 5 }),
 * })
 * ```
 *
 * **What the cap bounds, exactly.** A provider-executed `exa_search` runs inside
 * the Gateway, and one Gateway call may run it more than once before it answers
 * (the model searches, reads the result, searches again — all server-side). Those
 * calls all come back in the one step's `toolCalls`, so they are counted — but
 * only after that step, which means one step can overshoot the cap by what it
 * ran internally. The cap bounds calls across our steps; the Gateway's spend
 * limit is the ceiling above it.
 *
 * **Where it applies.** Only where there *are* later steps: the chat, whose
 * client tools (`read_page`, the capability tools) make the SDK loop. It is not
 * used by the research search step, whose only tool is the provider-executed
 * `exa_search` — `generateText` makes exactly one request there, so a
 * `prepareStep` would run once, before anything was counted. That budget is
 * advisory (`research/steps.ts`). And a client tool's cap only takes effect
 * between steps: a tool that must never exceed its cap inside one step (parallel
 * calls) enforces it itself, as `read_page` does (`capabilities/web.ts`).
 *
 * Plain Node, no imports: step code uses this.
 */

/** The part of an AI SDK `StepResult` the caps read. */
export interface StepLike {
  toolCalls?: readonly { toolName: string }[];
  toolResults?: readonly { toolName: string; output?: unknown }[];
  content?: readonly unknown[];
}

/**
 * How many times `toolName` was called across `steps`, provider-executed calls
 * included. Reads `toolCalls`, falling back to the step's `content` parts when a
 * step carries no `toolCalls` list.
 */
export function countToolCalls(steps: readonly StepLike[], toolName: string): number {
  let count = 0;
  for (const step of steps) {
    if (step.toolCalls) {
      count += step.toolCalls.filter((call) => call.toolName === toolName).length;
      continue;
    }
    for (const part of step.content ?? []) {
      if (isPart(part, "tool-call") && part.toolName === toolName) count += 1;
    }
  }
  return count;
}

/**
 * The tools, of `toolNames`, still under their cap after `steps` — for
 * `prepareStep`'s `activeTools`. A tool with no cap in `caps` is always active;
 * the order of `toolNames` is kept.
 */
export function activeToolsWithinCaps<T extends string>(
  toolNames: readonly T[],
  steps: readonly StepLike[],
  caps: Partial<Record<T, number>>
): T[] {
  return toolNames.filter((name) => {
    const cap = caps[name];
    return cap === undefined || countToolCalls(steps, name) < cap;
  });
}

/** True when `part` is a content part of `type` carrying a string `toolName`. */
export function isPart(
  part: unknown,
  type: "tool-call" | "tool-result"
): part is { type: string; toolName: string; output?: unknown } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === type &&
    typeof (part as { toolName?: unknown }).toolName === "string"
  );
}
