import { EXA_SEARCH_TOOL } from "../../../lib/ai/exa";
import { activeToolsWithinCaps, type StepLike } from "../../../lib/ai/tool-caps";
import { MAKE_ILLUSTRATION_TOOL } from "../../../lib/capabilities/illustrations";
import { REPORT_ISSUE_TOOL } from "../../../lib/capabilities/maintenance";
import { SHOW_TOOL_TOOL } from "../../../lib/capabilities/tool-cards";
import { READ_PAGE_TOOL } from "../../../lib/capabilities/web";
import { SUGGEST_REPLIES_TOOL } from "../../../lib/chat/suggested-replies";
import { CHAT_MAX_EXA_SEARCHES, CHAT_MAX_PAGE_READS, CHAT_MAX_TICKETS_PER_TURN } from "../../../lib/intake/limits";

/**
 * The chat's per-turn web caps (gateway spec §3.2–3.3). Anthropic's server
 * tools carried their own `maxUses`; `exa_search` and `read_page` do not, so
 * the route counts the calls already made in `prepareStep` and drops a tool
 * from `activeTools` for the rest of the turn once it reaches its cap. Every
 * other tool stays active.
 *
 * A provider-executed `exa_search` may run more than once inside one Gateway
 * call, and those runs are only counted after that step — so one step can
 * overshoot by what it ran internally. The cap bounds calls across our steps;
 * see `lib/ai/tool-caps.ts`.
 *
 * The same "between steps" limit applies to `read_page`: one step can hold
 * several parallel calls, all executed before `prepareStep` runs again. So
 * `read_page` also counts its own calls per turn and refuses past the cap
 * without fetching (`lib/capabilities/web.ts`); this only withdraws it.
 */
export const CHAT_TOOL_CAPS: Readonly<Record<string, number>> = {
  [EXA_SEARCH_TOOL]: CHAT_MAX_EXA_SEARCHES,
  [READ_PAGE_TOOL]: CHAT_MAX_PAGE_READS,
  // Counted inside the tool as well, like read_page (security fix 2026-10-05).
  [REPORT_ISSUE_TOOL]: CHAT_MAX_TICKETS_PER_TURN,
  // One row of tool cards per reply (amendment 2026-10-07 "Images in the chat"),
  // also counted inside the tool.
  [SHOW_TOOL_TOOL]: 1,
  // One illustration per reply (gateway spec amendment 2026-10-07): it costs
  // money. Counted inside the tool as well, for parallel calls in one step.
  [MAKE_ILLUSTRATION_TOOL]: 1,
  // One row of suggested replies per reply (parity spec amendment 2026-10-07
  // "Suggested replies"); the chat draws only the last call's anyway.
  [SUGGEST_REPLIES_TOOL]: 1,
};

/** `prepareStep` for a turn offering `toolNames`: every tool still under its cap. */
export function chatPrepareStep(toolNames: readonly string[]) {
  return ({ steps }: { steps: readonly StepLike[] }) => ({
    activeTools: activeToolsWithinCaps(toolNames, steps, CHAT_TOOL_CAPS),
  });
}
