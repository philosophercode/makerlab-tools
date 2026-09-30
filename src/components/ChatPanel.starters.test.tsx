import { http, HttpResponse } from "msw";
import { render, screen, userEvent, waitFor } from "../../test/utils/render";
import { server } from "../../test/msw/server";

/**
 * Starter answers in the chat: a chip whose question has a pre-run answer
 * shows it at once through `setMessages` — no `sendMessage`, so no model
 * call — and says so to the server for Usage Insight; a chip without one is
 * asked live; the conversation then continues live with the cached answer in
 * the history. `useChat` is mocked as in `ChatFab.test.tsx`.
 */

const pathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

const sendMessage = vi.fn();
const setMessages = vi.fn();
type Msg = { id: string; role: "user" | "assistant"; parts: Array<{ type: string; text?: string }> };
let messages: Msg[] = [];
let lastOptions: { transport?: unknown } | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn((options: { transport?: unknown }) => {
    lastOptions = options;
    return { messages, sendMessage, setMessages, status: "ready", error: undefined };
  }),
}));

import { ChatFab, preloadChatPanel } from "./ChatFab";
import { ToolChatStarters } from "./ToolChatStarters";

const QUESTIONS = ["What resins can I print with?", "How do I wash and cure a print?"];
const CACHED = {
  id: "starter-answer",
  role: "assistant",
  parts: [{ type: "step-start" }, { type: "text", text: "Standard, Tough and Flexible resin." }],
};

let gets: URL[] = [];
let posts: unknown[] = [];

beforeAll(async () => {
  await preloadChatPanel();
});

beforeEach(() => {
  sendMessage.mockClear();
  setMessages.mockClear();
  messages = [];
  lastOptions = undefined;
  gets = [];
  posts = [];
  pathnameMock.mockReturnValue("/tools/form-4");
  server.use(
    http.get(/\/api\/chat\/starters/, ({ request }) => {
      const url = new URL(request.url);
      gets.push(url);
      return HttpResponse.json({ answers: url.searchParams.get("toolId") === "form-4" ? [{ question: QUESTIONS[0], message: CACHED }] : [] });
    }),
    http.post(/\/api\/chat\/starters$/, async ({ request }) => {
      posts.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    })
  );
});

async function openWithChips() {
  render(
    <>
      <ToolChatStarters slug="form-4" id="tool-uuid" questions={QUESTIONS} />
      <ChatFab />
    </>
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Open the MakerLAB Assistant" }));
  await waitFor(() => expect(gets).toHaveLength(1));
}

describe("starter chips with a pre-run answer", () => {
  it("asks for this tool's cached answers when the chips show", async () => {
    await openWithChips();
    expect(gets[0].searchParams.get("toolId")).toBe("form-4");
    expect(gets[0].searchParams.get("locale")).toBe("en");
  });

  it("shows the cached answer at once, with no model call, and counts it", async () => {
    await openWithChips();
    await userEvent.setup().click(screen.getByRole("button", { name: QUESTIONS[0] }));

    await waitFor(() => expect(setMessages).toHaveBeenCalled());
    expect(sendMessage).not.toHaveBeenCalled();
    const update = setMessages.mock.calls[0][0] as (current: Msg[]) => Msg[];
    const next = update([]);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: QUESTIONS[0] }] });
    expect(next[1]).toMatchObject({ role: "assistant", parts: CACHED.parts });
    expect(next[1].id).not.toBe(CACHED.id);
    await waitFor(() => expect(posts).toEqual([{ question: QUESTIONS[0], locale: "en", toolId: "form-4" }]));
  });

  it("asks live when the chip has no cached answer", async () => {
    await openWithChips();
    await userEvent.setup().click(screen.getByRole("button", { name: QUESTIONS[1] }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: QUESTIONS[1] }));
    expect(setMessages).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("asks for the general chips' answers off a tool page", async () => {
    pathnameMock.mockReturnValue("/");
    render(<ChatFab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open the MakerLAB Assistant" }));
    await waitFor(() => expect(gets).toHaveLength(1));
    expect(gets[0].searchParams.has("toolId")).toBe(false);
  });

  it("continues live: a follow-up is sent through the normal route with the cached answer in the history", async () => {
    messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: QUESTIONS[0] }] },
      { ...CACHED, id: "a1", role: "assistant" } as Msg,
    ];
    render(
      <>
        <ToolChatStarters slug="form-4" id="tool-uuid" questions={QUESTIONS} />
        <ChatFab />
      </>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open the MakerLAB Assistant" }));
    expect(screen.getByText("Standard, Tough and Flexible resin.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "Which one is strongest?");
    await user.keyboard("{Enter}");
    expect(sendMessage).toHaveBeenCalledWith({ text: "Which one is strongest?" });

    const transport = lastOptions?.transport as {
      prepareSendMessagesRequest: (o: { id: string; messages: unknown[]; trigger: string; messageId: undefined }) => { body: { messages: Msg[]; toolId?: string } };
    };
    const { body } = transport.prepareSendMessagesRequest({ id: "c", messages, trigger: "submit-message", messageId: undefined });
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(body.messages[1].parts).toEqual(CACHED.parts);
    expect(body.toolId).toBe("form-4");
  });
});
