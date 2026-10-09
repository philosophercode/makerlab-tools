/**
 * Tool-scoped citations (manual text spec amendment 2026-10-06 "An answer
 * cites only its machine's documents"): which machines an answer is about,
 * and whether a cited passage belongs to one of them.
 *
 * An answer is about:
 *
 * - **the focused tool**, on a tool page. `search_manual` is pinned to it
 *   there, whatever the model passes;
 * - otherwise **the machines this turn's searches were scoped to**: the
 *   `tool` the model named, or the machines it compared (`compare_tools`);
 * - **any machine** when a search compared machines across the whole lab
 *   (`all_machines`). Then every citation is labelled with its machine, and
 *   none is "another machine's".
 *
 * A cited passage whose machine is not one of these is **another machine's
 * document**. The chat never shows it as this machine's: it relabels it with
 * that machine's name (`components/chat/manual-citations.ts`), Usage Insight
 * counts it as a cross-tool citation (`usage/from-turn.ts`), and the eval's
 * `cites_only_tool` and `citations_resolve` fail it.
 *
 * Pure, no imports: the chat UI, Usage Insight and the eval share it.
 */

/** What one `search_manual` call was scoped to. */
export interface ManualSearchScope {
  /** The catalogue ids of the machines searched (one, or the compared few). */
  toolIds: readonly string[];
  /** It searched every machine's documents, to compare machines across the lab. */
  wide: boolean;
}

/**
 * The machines an answer may cite: the focused tool, else the machines the
 * turn's searches were scoped to. Null means any machine (a lab-wide
 * comparison, or a search too old to say what it was scoped to).
 */
export function answerToolIds(
  focusedToolId: string | null | undefined,
  scopes: readonly ManualSearchScope[]
): ReadonlySet<string> | null {
  if (focusedToolId) return new Set([focusedToolId]);
  if (scopes.some((scope) => scope.wide)) return null;
  return new Set(scopes.flatMap((scope) => scope.toolIds));
}

/**
 * Whether a passage of machine `toolId` is another machine's document for an
 * answer about `allowed`. A passage with no machine is never this machine's.
 */
export function isOtherMachine(toolId: string | null | undefined, allowed: ReadonlySet<string> | null): boolean {
  if (allowed === null) return false;
  return !toolId || !allowed.has(toolId);
}

/**
 * The scope of one recorded `search_manual` output, or null when it carries
 * none (an output from before scopes were recorded, or not a search result).
 */
export function searchScopeOf(output: unknown): ManualSearchScope | null {
  const value = output as { toolIds?: unknown; comparing?: unknown } | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.toolIds)) return null;
  const toolIds = value.toolIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return { toolIds, wide: value.comparing === "all" };
}

/**
 * The scopes of the turn's `search_manual` outputs that returned passages
 * (`status: "ok"`; only they can be cited). An output that records no scope
 * counts as a wide search, so an answer from before scopes were recorded is
 * never relabelled.
 */
export function searchScopes(outputs: readonly unknown[]): ManualSearchScope[] {
  return outputs
    .filter((output) => (output as { status?: unknown } | null)?.status === "ok")
    .map((output) => searchScopeOf(output) ?? { toolIds: [], wide: true });
}
