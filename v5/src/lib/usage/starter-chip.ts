import type { Role } from "../auth/roles.ts";
import { isUuid } from "../data/uuid.ts";
import { audienceFor, usageLocale, type UsageEvent } from "./events.ts";
import { classifyQuestion } from "./question-kind.ts";

/**
 * A starter chip answered from the cache (starter answers) counts in Usage
 * Insight the way the live turn it stands for would have: one `chat_turn` —
 * with `source: "cached"`, so a cached answer can be told from a live one —
 * then the `tool_asked` and `manual_cited` events the answer recorded when it
 * was made, stamped with the clicker's audience. Never a gap: only accepted
 * answers are cached. Pure; nothing about the person but the role's bucket.
 */

export const CACHED_TURN_SOURCE = "cached";

export function starterChipUsageEvents(input: {
  question: string;
  /** `starter_answers.usage_events` as stored — re-validated here. */
  stored: unknown;
  role: Role | null | undefined;
  locale?: unknown;
}): UsageEvent[] {
  const base = { surface: "chat" as const, audience: audienceFor(input.role), locale: usageLocale(input.locale) };
  const events: UsageEvent[] = [
    { ...base, kind: "chat_turn", source: CACHED_TURN_SOURCE, questionKind: classifyQuestion(input.question) },
  ];
  for (const raw of Array.isArray(input.stored) ? input.stored : []) {
    const event = raw as { kind?: unknown; toolId?: unknown; manualDocumentId?: unknown; page?: unknown };
    const toolId = typeof event.toolId === "string" && isUuid(event.toolId) ? event.toolId : null;
    if (event.kind === "tool_asked" && toolId) {
      events.push({ ...base, kind: "tool_asked", toolId });
    } else if (event.kind === "manual_cited" && typeof event.manualDocumentId === "string" && isUuid(event.manualDocumentId)) {
      const page = Number(event.page);
      events.push({
        ...base,
        kind: "manual_cited",
        toolId,
        manualDocumentId: event.manualDocumentId,
        page: Number.isInteger(page) && page > 0 ? page : null,
      });
    }
  }
  return events;
}
