import "server-only";

import type { UIMessage } from "ai";
import type { Role } from "../auth/roles";
import { audienceFor, usageLocale } from "./events";
import { fromTurn, type TurnStep } from "./from-turn";
import { scheduleUsage } from "./schedule";
import { turnUsage } from "./turn-log";

/**
 * The chat route's one call into Usage Insight (usage insight spec §3.3,
 * §5.1), from `streamText`'s `onFinish`: turn what the finished turn did into
 * events and record them after the response. **Nothing escapes**: this runs
 * inside the model stream's callback, and a thrown error there must never
 * reach the student's answer.
 *
 * Only the role is read from the identity, to pick the audience bucket; the
 * user id, the chat id and the address never reach an event. `demo` marks a
 * demo pass's turn (demo pass spec 2026-10-07 §5.5): its events are the `demo`
 * audience, and a question it could not answer is counted but kept out of the
 * Unanswered queue, which is the lab's to work.
 */
export function recordChatTurnUsage(input: {
  steps: readonly (TurnStep & { text?: string })[];
  messages: readonly UIMessage[];
  role: Role | null | undefined;
  demo?: boolean;
  focusedToolId?: string | null;
  locale?: unknown;
  turn?: object;
}): void {
  try {
    const log = turnUsage(input.turn);
    const audience = audienceFor(input.role, { demo: input.demo });
    const { events, gap } = fromTurn({
      steps: input.steps,
      text: input.steps.map((step) => step.text ?? "").join("\n"),
      lastUserText: lastUserText(input.messages),
      focusedToolId: input.focusedToolId ?? null,
      passages: log.passages,
      scopedToolIds: log.scopedToolIds,
      wideSearch: log.wideSearch,
      audience,
      locale: usageLocale(input.locale),
    });
    scheduleUsage(events, gap && audience !== "demo" ? [gap] : []);
  } catch (err) {
    console.warn("[usage] could not read the finished turn", err instanceof Error ? err.message : err);
  }
}

/** The text of the conversation's last user message. */
export function lastUserText(messages: readonly UIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return "";
  return (last.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join(" ")
    // The photo hint the client appends is an upload id, not the question.
    .replace(/\[Attached photos:[^\]]*\]/gi, "")
    .trim();
}
