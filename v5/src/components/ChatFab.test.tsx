import { render, screen, userEvent } from "../../test/utils/render";

// ── Mocks ──────────────────────────────────────────────────────────
//
// `next/navigation`: ChatFab reads `usePathname()` to derive the optional
// `toolId` (matches `/tools/:slug`). Default to "/" (no tool context); a
// per-test override re-mocks it for the tool-page case.
const pathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

// `@ai-sdk/react`: ChatFab destructures exactly
//   { messages, sendMessage, setMessages, status, error }
// from `useChat(...)`. We mock the hook and shape its return per-test via
// `useChatReturn`, capturing the `{ transport, onData }` options the
// component passes in so we can assert how the request is wired.
const sendMessage = vi.fn();
const setMessages = vi.fn();

interface UseChatReturn {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<{ type: string; text?: string; state?: string }>;
  }>;
  sendMessage: typeof sendMessage;
  setMessages: typeof setMessages;
  status: "ready" | "submitted" | "streaming" | "error";
  error: Error | undefined;
}

let useChatReturn: UseChatReturn;
let lastUseChatOptions: unknown;

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn((options: unknown) => {
    lastUseChatOptions = options;
    return useChatReturn;
  }),
}));

function baseReturn(overrides: Partial<UseChatReturn> = {}): UseChatReturn {
  return {
    messages: [],
    sendMessage,
    setMessages,
    status: "ready",
    error: undefined,
    ...overrides,
  };
}

function userMsg(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text", text }] };
}

function assistantMsg(id: string, text: string) {
  return { id, role: "assistant" as const, parts: [{ type: "text", text }] };
}

// Imported after the mocks above are hoisted.
import { ChatFab } from "./ChatFab";

beforeEach(() => {
  // These mocks are module-scoped, so their call history survives between
  // tests — clear it explicitly (the setup's restoreAllMocks doesn't reset
  // standalone vi.fn() instances).
  sendMessage.mockClear();
  setMessages.mockClear();
  pathnameMock.mockReturnValue("/");
  useChatReturn = baseReturn();
  lastUseChatOptions = undefined;
});

describe("ChatFab", () => {
  it("is closed by default — only the FAB shows, no dialog", () => {
    render(<ChatFab />);

    expect(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the chat panel when the FAB is clicked", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Title + general greeting visible in the empty state.
    expect(
      screen.getByRole("heading", { name: "MAKERLAB ASSISTANT" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("How can I help you today?")
    ).toBeInTheDocument();
  });

  it("closes the panel via the close button", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders user and assistant messages from useChat", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [
        userMsg("u1", "How do I use the laser cutter?"),
        assistantMsg("a1", "First, complete the safety training."),
      ],
    });
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    expect(
      screen.getByText("How do I use the laser cutter?")
    ).toBeInTheDocument();
    // Assistant text is rendered through ReactMarkdown but the text content
    // is still present in the DOM.
    expect(
      screen.getByText("First, complete the safety training.")
    ).toBeInTheDocument();
  });

  it("submitting the composer calls sendMessage with the typed text", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    const input = screen.getByRole("textbox", { name: "Ask the lab console" });
    await user.type(input, "Where is the 3D printer?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ text: "Where is the 3D printer?" });
  });

  it("clears the input after a successful submit", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    const input = screen.getByRole("textbox", {
      name: "Ask the lab console",
    }) as HTMLInputElement;
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(input.value).toBe("");
  });

  it("does not send when the composer is empty", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    // Send button is disabled with an empty draft, so clicking is a no-op.
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends a suggestion chip's label when clicked", async () => {
    const user = userEvent.setup();
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    await user.click(
      screen.getByRole("button", { name: "Find a machine for a project" })
    );

    expect(sendMessage).toHaveBeenCalledWith({
      text: "Find a machine for a project",
    });
  });

  it("shows the typing indicator while streaming", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "hello")],
      status: "streaming",
    });
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    // Typing indicator appears because the last message is from the user.
    expect(
      screen.getByLabelText("Assistant is typing")
    ).toBeInTheDocument();
    // Composer is disabled while loading.
    expect(
      screen.getByRole("textbox", { name: "Ask the lab console" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("renders the error row when useChat returns an error", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")],
      error: new Error("boom"),
    });
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    expect(
      screen.getByText("Something went wrong. Try again.")
    ).toBeInTheDocument();
  });

  it("clears the conversation via the new-chat button", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")],
    });
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    await user.click(screen.getByRole("button", { name: "Start new chat" }));

    // clearChat() delegates to the mocked setMessages([]).
    expect(setMessages).toHaveBeenCalledWith([]);
  });

  it("shows the tool-specific greeting on a /tools/:slug route", async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue("/tools/laser-cutter");
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    expect(
      screen.getByText(
        "Ask about this tool — I have its specs, materials, and resource links."
      )
    ).toBeInTheDocument();
  });

  // The request body wiring (locale + toolId) lives in the transport's
  // `prepareSendMessagesRequest`, which only runs inside the real `useChat`
  // at send time. With `useChat` mocked, we instead assert the component
  // passes a transport (and onData handler) into the hook — the request-body
  // forwarding itself is covered by the chat-route integration tests.
  it("passes a transport and onData handler into useChat", () => {
    render(<ChatFab />);

    expect(lastUseChatOptions).toBeTruthy();
    const opts = lastUseChatOptions as {
      transport?: unknown;
      onData?: unknown;
    };
    expect(opts.transport).toBeDefined();
    expect(typeof opts.onData).toBe("function");
  });
});
