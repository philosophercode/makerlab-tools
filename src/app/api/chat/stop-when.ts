import { stepCountIs } from "ai";
import { SUGGEST_REPLIES_TOOL } from "../../../lib/chat/suggested-replies";

/** The most model steps one chat turn may take. */
export const CHAT_MAX_STEPS = 10;

/** What the stop conditions read of a finished step. */
interface StopStep {
  text?: string;
  toolCalls?: readonly { toolName: string }[];
}

/**
 * Suggested replies end the turn (parity spec amendment 2026-10-07
 * "Suggested replies"). The model offers them last, after its answer, and the
 * tool only hands them back: a step whose only calls were `suggest_replies`,
 * in a turn that has written text, has nothing left to wait for. Another step
 * would cost a model call and hold the bubbles back, since the chat shows them
 * only once the turn has finished. Called with nothing written yet, the turn
 * carries on and the answer follows.
 */
export function repliesEndTheTurn({ steps }: { steps: readonly StopStep[] }): boolean {
  const calls = steps.at(-1)?.toolCalls ?? [];
  if (calls.length === 0 || !calls.every((call) => call.toolName === SUGGEST_REPLIES_TOOL)) return false;
  return steps.some((step) => (step.text ?? "").trim() !== "");
}

/** `stopWhen` for a chat turn: at {@link CHAT_MAX_STEPS} steps, or once the suggested replies are in. */
export function chatStopWhen() {
  return [stepCountIs(CHAT_MAX_STEPS), repliesEndTheTurn];
}
