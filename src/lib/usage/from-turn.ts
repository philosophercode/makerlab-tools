import type { GapKind, UsageAudience } from "../db/schema/vocabulary.ts";
import { CITE_HREF_PREFIX, linkPosition } from "../manuals/citation-ref.ts";
import { answerToolIds, isOtherMachine } from "../manuals/citation-scope.ts";
import { answerDeclaresAbsence } from "./absence.ts";
import type { UsageEvent, UsageGapInput } from "./events.ts";
import { classifyQuestion } from "./question-kind.ts";
import { scrubQuestion } from "./scrub.ts";
import type { PassageUsage } from "./turn-log.ts";

/**
 * A finished chat turn → its usage events (usage insight spec §5.1). Pure.
 *
 * - one `chat_turn`, with the question's kind (`question-kind.ts`);
 * - one `tool_asked` per distinct tool the turn was about: the tool page the
 *   student was on, every tool `get_tool_details` found, every tool a
 *   `search_manual` was scoped to;
 * - one `manual_cited` per passage the answer actually linked to — the same
 *   test the chat's Sources use (`components/chat/manual-citations.ts`): a
 *   link to the `#cite-<ref>` of a passage `search_manual` returned this turn
 *   (what the prompt asks the model to write), or to its exact URL. A passage
 *   from another machine's document than the one the answer is about
 *   (`manuals/citation-scope.ts`) is recorded with `source: "cross_tool"`
 *   (manual text spec amendment 2026-10-06);
 * - at most one `gap`, when §5.2 says the turn could not answer, with the
 *   student's last message scrubbed for the Unanswered queue.
 *
 * Nothing here reads who asked: the audience bucket comes in as a value.
 */

/** `manual_cited.source` for a citation of another machine's document. */
export const CROSS_TOOL_SOURCE = "cross_tool";

/** The part of a step this reads: the tool results' names and outputs. */
export interface TurnStep {
  toolResults?: readonly { toolName: string; output?: unknown }[];
}

export interface TurnInput {
  steps: readonly TurnStep[];
  /** The answer's text, every step's text joined. */
  text: string;
  /** The student's last message, unscrubbed (scrubbed here before it goes anywhere). */
  lastUserText: string;
  focusedToolId?: string | null;
  passages: ReadonlyMap<string, PassageUsage>;
  scopedToolIds: readonly string[];
  /** A search this turn compared every machine in the lab: no citation is cross-tool. */
  wideSearch?: boolean;
  audience: UsageAudience;
  locale?: string | null;
}

export interface TurnUsageOutput {
  events: UsageEvent[];
  gap: UsageGapInput | null;
}

function outputsOf(steps: readonly TurnStep[], toolName: string): Record<string, unknown>[] {
  return steps.flatMap((step) =>
    (step.toolResults ?? [])
      .filter((result) => result.toolName === toolName && result.output && typeof result.output === "object")
      .map((result) => result.output as Record<string, unknown>)
  );
}

/**
 * The passages (by URL) `text` links to as Markdown — by `](#cite-<ref>)` or
 * by `](url)` — each once, however many times or ways it is linked.
 */
export function citedUrls(text: string, passages: ReadonlyMap<string, Pick<PassageUsage, "ref">>): string[] {
  return [...passages]
    .filter(([url, { ref }]) => (ref && linkPosition(text, `${CITE_HREF_PREFIX}${ref}`) >= 0) || linkPosition(text, url) >= 0)
    .map(([url]) => url);
}

export function fromTurn(input: TurnInput): TurnUsageOutput {
  const base = { surface: "chat" as const, audience: input.audience, locale: input.locale ?? null };
  const events: UsageEvent[] = [{ ...base, kind: "chat_turn", questionKind: classifyQuestion(input.lastUserText) }];

  const details = outputsOf(input.steps, "get_tool_details");
  const found = details.filter((d) => d.found === true && typeof d.id === "string").map((d) => d.id as string);
  const notFound = details.some((d) => d.found === false);

  const asked = new Set<string>();
  if (input.focusedToolId) asked.add(input.focusedToolId);
  for (const id of found) asked.add(id);
  for (const id of input.scopedToolIds) asked.add(id);
  for (const toolId of asked) events.push({ ...base, kind: "tool_asked", toolId });

  const cited = citedUrls(input.text, input.passages);
  const allowed = answerToolIds(input.focusedToolId, [{ toolIds: input.scopedToolIds, wide: input.wideSearch === true }]);
  for (const url of cited) {
    const passage = input.passages.get(url)!;
    events.push({
      ...base,
      kind: "manual_cited",
      toolId: passage.toolId,
      manualDocumentId: passage.documentId,
      page: passage.page,
      ...(isOtherMachine(passage.toolId, allowed) ? { source: CROSS_TOOL_SOURCE } : {}),
    });
  }

  const searches = outputsOf(input.steps, "search_tools");
  const manualSearches = outputsOf(input.steps, "search_manual");
  let gapKind: GapKind | null = null;
  if (notFound && found.length === 0) gapKind = "not_in_catalog";
  else if (searches.length > 0 && searches.every((s) => Number(s.count ?? 0) === 0) && found.length === 0) gapKind = "no_search_results";
  else if (manualSearches.some((s) => s.status === "no_results") && cited.length === 0) gapKind = "no_manual_passage";
  else if (cited.length === 0 && answerDeclaresAbsence(input.text)) gapKind = "honest_absence";

  let gap: UsageGapInput | null = null;
  const question = scrubQuestion(input.lastUserText);
  if (gapKind && question) {
    const toolId = input.focusedToolId ?? input.scopedToolIds[0] ?? null;
    events.push({ ...base, kind: "gap", toolId, source: gapKind });
    gap = { kind: gapKind, question, toolId, audience: input.audience, surface: "chat", locale: base.locale };
  }
  return { events, gap };
}
