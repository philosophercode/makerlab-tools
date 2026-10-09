import type { UIMessage } from "ai";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../../test/utils/render";
import { ChatMessage } from "./ChatMessage";
import type { ChatT } from "./chat-text";

/**
 * Suggested replies (assistant–GUI parity spec, amendment 2026-10-07): the
 * replies a `suggest_replies` call offered, drawn by `ChatMessage` as a named
 * row of bubbles when `ChatPanel` passes `onReply`. When it does is
 * `ChatPanel`'s decision, tested in `ChatFab.test.tsx`.
 */

const t = ((key: string) => key) as unknown as ChatT;

function answer(replies: unknown, state = "output-available"): UIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text: "The lab has two laser cutters. What are you looking to cut?" },
      { type: "tool-suggest_replies", toolCallId: "c1", state, input: { replies }, output: state === "output-available" ? { ok: true, replies } : undefined },
    ],
  } as unknown as UIMessage;
}

describe("suggested replies in a message", () => {
  it("draws the replies as a named group of buttons, each named by its text, under the answer", () => {
    render(<ChatMessage message={answer(["Acrylic sign", "Engraved wood", "Cardboard prototype"])} t={t} onInternalNavigate={() => {}} onReply={() => {}} />);

    const group = screen.getByRole("group", { name: "suggestedReplies" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Acrylic sign", "Engraved wood", "Cardboard prototype"]);
    expect(within(group).getByRole("button", { name: "Acrylic sign" })).toHaveClass("chat-reply-chip");
    // Last in the message, after the answer's text.
    const message = group.closest("[data-role='assistant']");
    expect(message?.lastElementChild?.lastElementChild).toBe(group);
  });

  it("sends exactly the reply's text when tapped", async () => {
    const onReply = vi.fn();
    render(<ChatMessage message={answer(["Acrylic sign", "Engraved wood"])} t={t} onInternalNavigate={() => {}} onReply={onReply} />);
    await userEvent.click(screen.getByRole("button", { name: "Engraved wood" }));
    expect(onReply).toHaveBeenCalledExactlyOnceWith("Engraved wood");
  });

  it("does nothing while a turn is starting", async () => {
    const onReply = vi.fn();
    render(<ChatMessage message={answer(["Acrylic sign", "Engraved wood"])} t={t} onInternalNavigate={() => {}} onReply={onReply} repliesDisabled />);
    const button = screen.getByRole("button", { name: "Acrylic sign" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("draws none without onReply: an older message, or a turn still running", () => {
    render(<ChatMessage message={answer(["Acrylic sign", "Engraved wood"])} t={t} onInternalNavigate={() => {}} />);
    expect(screen.getByText(/two laser cutters/)).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws no status line while the call streams, and no bubbles before it has finished", () => {
    render(<ChatMessage message={answer(["Acrylic sign", "Engraved wood"], "input-streaming")} t={t} onInternalNavigate={() => {}} onReply={() => {}} />);
    expect(screen.queryByLabelText("toolRunningAria")).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("checks a stored output again: too long, repeated or a single reply draws nothing it should not", () => {
    const { unmount } = render(
      <ChatMessage message={answer(["Acrylic sign", "ACRYLIC SIGN", "x".repeat(41), "Engraved wood"])} t={t} onInternalNavigate={() => {}} onReply={() => {}} />
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Acrylic sign", "Engraved wood"]);
    unmount();

    render(<ChatMessage message={answer(["Acrylic sign"])} t={t} onInternalNavigate={() => {}} onReply={() => {}} />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
