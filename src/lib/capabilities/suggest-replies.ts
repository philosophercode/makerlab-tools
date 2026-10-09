import { z } from "zod";
import {
  MAX_REPLIES,
  MAX_REPLY_LENGTH,
  MIN_REPLIES,
  SUGGEST_REPLIES_TOOL,
  cleanReplies,
  repliesAreDistinct,
} from "../chat/suggested-replies";
import type { Capability, CapabilityTool } from "./types";

/**
 * The `suggested-replies` capability (assistant–GUI parity spec, amendment
 * 2026-10-07 "Suggested replies"). The owner, looking at "What material or
 * project are you looking to cut?" on his phone: "For these kinda answers can
 * you make like text suggestions to click in bubbles" — and then: "Be sparing
 * with the suggested answers only when there's 2-3 choices easy to respond."
 *
 * `suggest_replies` is **display only**: the model passes two or three short
 * replies, and the chat draws them as bubbles under the latest answer
 * (`components/chat/SuggestedReplies.tsx`); a tap sends that text as the
 * student's next message.
 *
 * - **Nothing happens on the server.** `run` checks and returns the replies;
 *   it reads nothing, writes nothing, costs nothing and does not taint a turn.
 *   The chat reads the call's output from the tool part, as it streamed.
 * - **For everybody**, anonymous visitors included, and **chat only**: a
 *   bubble has no meaning over MCP.
 * - **Validated here, checked again when drawn**: 2–3 replies, each trimmed,
 *   1–40 characters, no two the same ignoring case (`lib/chat/suggested-replies.ts`).
 * - **Once per reply**: `CHAT_TOOL_CAPS.suggest_replies = 1`, and a step whose
 *   only call was this one, after the answer was written, ends the turn
 *   (`app/api/chat/stop-when.ts`), so the bubbles add no model step.
 */

export { SUGGEST_REPLIES_TOOL };

const input = z.object({
  replies: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(MAX_REPLY_LENGTH)
        .describe("One reply of a few words, as the student would say it.")
    )
    .min(MIN_REPLIES)
    .max(MAX_REPLIES)
    .refine(repliesAreDistinct, { message: "Each reply must be different." })
    .describe("Two or three short replies, one per option your answer asked the student to choose between."),
});
type Input = z.infer<typeof input>;

/** What the call returns: the replies as the chat will show them. */
export interface SuggestRepliesResult {
  ok: boolean;
  replies: string[];
}

export const suggestReplies: CapabilityTool<Input, SuggestRepliesResult> = {
  name: SUGGEST_REPLIES_TOOL,
  description:
    "Show two or three short replies the student can tap under your answer; a tap sends that text as their next message. Use it sparingly: only when your answer ends by asking them to pick between two or three clear, easy options. Never for next steps, open-ended questions, factual answers or anything about safety.",
  inputSchema: input,
  kind: "read",
  chatOnly: true,
  async run({ replies }) {
    const shown = cleanReplies(replies);
    return { ok: shown.length > 0, replies: shown };
  },
};

const SUGGESTED_REPLIES_SECTION = `## Suggested replies

Use \`${SUGGEST_REPLIES_TOOL}\` sparingly; most turns should not. Call it only when your answer ends by asking the student to choose between two or three clear, easy options — which of two machines, which material from a short list. Give two or three replies of a few words each, as the student would say them, in the language you answer in ("Acrylic sign", "Engraved wood"), and never what they just said. The chat shows them as buttons under your answer and a tap sends one as the student's next message, so your text must still ask the question on its own. Call it once, last in your turn. Not for next steps, open-ended questions or factual answers, and never for safety, training or permission: no "Yes, it's safe" or "Skip the training".`;

export const suggestedReplies: Capability = {
  id: "suggested-replies",
  promptFragment: () => SUGGESTED_REPLIES_SECTION,
  tools: [suggestReplies as CapabilityTool<unknown, unknown>],
};
