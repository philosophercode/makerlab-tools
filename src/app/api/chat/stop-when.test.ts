// @vitest-environment node
import { CHAT_MAX_STEPS, chatStopWhen, repliesEndTheTurn } from "./stop-when";

/**
 * When a chat turn stops (parity spec amendment 2026-10-07 "Suggested
 * replies"): at ten steps, or once a step that only offered suggested replies
 * follows the answer's text. Pure: steps in, a decision out.
 */

function step(text: string, ...tools: string[]) {
  return { text, toolCalls: tools.map((toolName) => ({ toolName })) };
}

describe("repliesEndTheTurn", () => {
  it("ends the turn when the answer is written and the step only offered replies", () => {
    expect(repliesEndTheTurn({ steps: [step("What are you cutting?", "suggest_replies")] })).toBe(true);
    expect(repliesEndTheTurn({ steps: [step("", "search_tools"), step("Which one?", "suggest_replies")] })).toBe(true);
    // The text came a step before the replies.
    expect(repliesEndTheTurn({ steps: [step("Two cutters fit."), step("", "suggest_replies")] })).toBe(true);
  });

  it("carries on when nothing is written yet: the answer follows", () => {
    expect(repliesEndTheTurn({ steps: [step("", "suggest_replies")] })).toBe(false);
    expect(repliesEndTheTurn({ steps: [step("  \n", "suggest_replies")] })).toBe(false);
  });

  it("carries on when the step also called another tool, whose result the model has not seen", () => {
    expect(repliesEndTheTurn({ steps: [step("Which one?", "suggest_replies", "show_tool")] })).toBe(false);
  });

  it("leaves every other step to the default loop", () => {
    expect(repliesEndTheTurn({ steps: [] })).toBe(false);
    expect(repliesEndTheTurn({ steps: [step("Hello.")] })).toBe(false);
    expect(repliesEndTheTurn({ steps: [step("Looking.", "search_tools")] })).toBe(false);
  });
});

describe("chatStopWhen", () => {
  it("stops at ten steps as before, and on suggested replies", async () => {
    expect(CHAT_MAX_STEPS).toBe(10);
    const [byCount, byReplies] = chatStopWhen();
    const nine = Array.from({ length: 9 }, () => step("", "search_tools"));
    expect(await byCount({ steps: nine as never })).toBe(false);
    expect(await byCount({ steps: [...nine, step("", "search_tools")] as never })).toBe(true);
    expect(byReplies).toBe(repliesEndTheTurn);
  });
});
