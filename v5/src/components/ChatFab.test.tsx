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
    parts: Array<{ type: string; text?: string; state?: string; data?: unknown }>;
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

// The ceiling message offers sign-in, which hands the browser to Google. Mock
// the helper so nothing navigates; its own behaviour is covered in
// `lib/auth/sign-in-client.test.ts`.
const startGoogleSignIn = vi.fn<(callbackURL: string) => Promise<boolean>>(
  async () => true
);
vi.mock("../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/sign-in-client")>();
  return {
    ...actual,
    startGoogleSignIn: (callbackURL: string) => startGoogleSignIn(callbackURL),
  };
});

// The copy of a photo the model sees is drawn on a canvas, which jsdom does not
// have. Its own behaviour is covered in `lib/chat/downscale-image.test.ts`; here
// each test decides whether the browser could encode the photo.
const downscaleForVision = vi.hoisted(() =>
  vi.fn<(file: Blob) => Promise<string | null>>(async () => null)
);
vi.mock("../lib/chat/downscale-image", () => ({
  downscaleForVision: (file: Blob) => downscaleForVision(file),
}));

// Imported after the mocks above are hoisted.
import { ChatFab } from "./ChatFab";
import { ToolChatStarters } from "./ToolChatStarters";
import type { IntakeTablePayload } from "../lib/intake/types";

beforeEach(() => {
  // These mocks are module-scoped, so their call history survives between
  // tests — clear it explicitly (the setup's restoreAllMocks doesn't reset
  // standalone vi.fn() instances).
  sendMessage.mockClear();
  setMessages.mockClear();
  startGoogleSignIn.mockClear();
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

  it("surfaces the actual error message when useChat returns an error", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")],
      error: new Error("The AI service is temporarily overloaded."),
    });
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    // The real message is shown verbatim, not the generic fallback.
    expect(
      screen.getByText("The AI service is temporarily overloaded.")
    ).toBeInTheDocument();
  });

  it("falls back to the generic error text when the error has no message", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")],
      error: new Error(""),
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

  it("bounds earlier photos in the request it sends", () => {
    render(<ChatFab />);
    const { transport } = lastUseChatOptions as {
      transport: {
        prepareSendMessagesRequest: (options: {
          id: string;
          messages: unknown[];
          trigger: string;
          messageId: string | undefined;
        }) => { body: { messages: Array<{ parts: Array<{ type: string }> }> } };
      };
    };
    const photo = (n: number) => ({
      type: "file",
      mediaType: "image/jpeg",
      filename: `p${n}.jpg`,
      url: `data:image/jpeg;base64,P${n}`,
    });

    const { body } = transport.prepareSendMessagesRequest({
      id: "chat-1",
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "earlier" }, ...[1, 2, 3, 4, 5, 6].map(photo)],
        },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
        { id: "u2", role: "user", parts: [{ type: "text", text: "a follow-up" }] },
      ],
      trigger: "submit-message",
      messageId: undefined,
    });

    const earlierPhotos = body.messages[0].parts.filter((p) => p.type === "file");
    expect(earlierPhotos).toHaveLength(4);
  });
});

// ── Citation stripping (#22) ───────────────────────────────────────
//
// The assistant grounds answers with inline <cite index="…">…</cite> markup.
// react-markdown has no raw-HTML plugin, so without stripping these would
// render as literal text. Assert the tags are removed but the prose survives.
describe("ChatFab — <cite> tag stripping", () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
  }

  it("removes a <cite> tag (with attributes) while keeping the cited prose", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [
        userMsg("u1", "how do I cut acrylic?"),
        assistantMsg(
          "a1",
          'Use the laser cutter <cite index="1-9">after safety training</cite> first.'
        ),
      ],
    });
    render(<ChatFab />);
    await open(user);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Use the laser cutter after safety training first."
    );
    expect(dialog.textContent).not.toContain("<cite");
    expect(dialog.textContent).not.toContain("</cite>");
    expect(dialog.textContent).not.toContain("index=");
  });

  it("removes multiple <cite> tags in one message", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [
        assistantMsg(
          "a1",
          '<cite index="1">First</cite> and <cite>second</cite> point.'
        ),
      ],
    });
    render(<ChatFab />);
    await open(user);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("First and second point.");
    expect(dialog.textContent).not.toContain("cite");
  });

  it("leaves a message without citations untouched", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [assistantMsg("a1", "Just plain advice, no sources.")],
    });
    render(<ChatFab />);
    await open(user);

    expect(
      screen.getByText("Just plain advice, no sources.")
    ).toBeInTheDocument();
  });
});

// ── Pending tool-call status ───────────────────────────────────────
//
// While a tool call is mid-flight (state !== "output-available") and the
// assistant message has no text yet, the UI shows a per-tool status line.
describe("ChatFab — pending tool-call status", () => {
  function toolMsg(id: string, toolType: string, state = "input-available") {
    return {
      id,
      role: "assistant" as const,
      parts: [{ type: toolType, state }],
    };
  }

  async function openWith(messages: UseChatReturn["messages"]) {
    const user = userEvent.setup();
    useChatReturn = baseReturn({ messages });
    render(<ChatFab />);
    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
  }

  it("shows the unit-lookup label for a pending get_unit_details call", async () => {
    await openWith([
      userMsg("u1", "is Prusa #1 ok?"),
      toolMsg("a1", "tool-get_unit_details"),
    ]);
    expect(
      screen.getByText("🔍 Looking up unit details…")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tool running")).toBeInTheDocument();
  });

  it("shows the ticket-filing label for a pending report_issue call", async () => {
    await openWith([toolMsg("a1", "tool-report_issue")]);
    expect(
      screen.getByText("📝 Filing maintenance ticket…")
    ).toBeInTheDocument();
  });

  it("shows the identifying label for a pending identify_tools call", async () => {
    await openWith([toolMsg("a1", "tool-identify_tools")]);
    expect(screen.getByText("Identifying the equipment…")).toBeInTheDocument();
  });

  it("shows the searching label for a pending exa_search call", async () => {
    await openWith([toolMsg("a1", "tool-exa_search")]);
    expect(screen.getByText("🔍 Searching the web…")).toBeInTheDocument();
  });

  it("shows the reading label for a pending read_page call", async () => {
    await openWith([toolMsg("a1", "tool-read_page")]);
    expect(screen.getByText("📄 Reading the page…")).toBeInTheDocument();
  });

  it("shows a generic working label for any other pending tool", async () => {
    await openWith([toolMsg("a1", "tool-search_tools")]);
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
  });
});

// ── The intake table (data platform spec §5.4) ─────────────────────
describe("ChatFab — intake table", () => {
  const payload: IntakeTablePayload = {
    kind: "intake-table",
    batchId: "0b7e3f7e-5c1a-4f64-9d2e-6a1b2c3d4e5f",
    warnings: [],
    items: [
      {
        id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        batchId: "0b7e3f7e-5c1a-4f64-9d2e-6a1b2c3d4e5f",
        status: "identified",
        name: "Bambu Lab X1-Carbon Combo",
        brand: "Bambu Lab",
        categoryHint: "3D Printing",
        locationHint: null,
        serialNumber: null,
        duplicateOf: null,
        duplicateResolution: null,
        photos: [],
        confidenceLevel: null,
        researchError: null,
        researchRequestedAt: null,
        hasWorkflowRun: false,
        createdByName: "Niti Parikh",
        createdAt: "2026-09-23T12:00:00.000Z",
        updatedAt: "2026-09-23T12:00:00.000Z",
      },
    ],
  };

  it("renders a data-intake-table part as the intake table card", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [
        userMsg("u1", "add this printer"),
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "tool-identify_tools", state: "output-available" },
            { type: "data-intake-table", data: payload },
            { type: "text", text: "Untick anything you don't want, then press Research." },
          ],
        },
      ],
    });
    render(<ChatFab />);
    await user.click(screen.getByRole("button", { name: "Open MakerLab assistant" }));

    const card = screen.getByRole("region", { name: "Identified equipment" });
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Bambu Lab X1-Carbon Combo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Research selected (1)" })).toBeEnabled();
    // The bubble gives the card the full column, as it does for an identification card.
    expect(card.closest("li")).toHaveClass("chat-msg-has-card");
  });

  it("renders a message that carries only the table", async () => {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [
        { id: "a1", role: "assistant", parts: [{ type: "data-intake-table", data: payload }] },
      ],
    });
    render(<ChatFab />);
    await user.click(screen.getByRole("button", { name: "Open MakerLab assistant" }));

    expect(screen.getByRole("region", { name: "Identified equipment" })).toBeInTheDocument();
  });
});

// ── Photo upload + attachment hint ─────────────────────────────────
//
// Selecting an image uploads it to /api/uploads, shows a removable preview,
// and on submit appends a parseable [Attached photos: …] hint that the chat
// route turns into report_issue photo_attachment_ids.
describe("ChatFab — photo uploads", () => {
  let origCreate: typeof URL.createObjectURL;
  let origRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    origCreate = URL.createObjectURL;
    origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    vi.unstubAllGlobals();
  });

  it("uploads an image and includes its attachment hint in the sent message", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            attachmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
            previewUrl: null,
            name: "broken.png",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "broken.png", {
      type: "image/png",
    });
    await user.upload(fileInput, file);

    // Preview + remove control appear once the upload resolves.
    expect(
      await screen.findByRole("button", { name: "Remove broken.png" })
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/uploads",
      expect.objectContaining({ method: "POST" })
    );

    const input = screen.getByRole("textbox", { name: "Ask the lab console" });
    await user.type(input, "the printer is broken");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const arg = sendMessage.mock.calls[0][0] as { text: string };
    expect(arg.text).toContain("the printer is broken");
    expect(arg.text).toContain(
      "[Attached photos: attachment_id=3f2504e0-4f89-41d3-9a0c-0305e82c3301 name=broken.png]"
    );
  });

  it("surfaces an upload error and does not add a preview", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "File too large (max 18MB)" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File([new Uint8Array([1])], "huge.png", { type: "image/png" })
    );

    expect(
      await screen.findByText("File too large (max 18MB)")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove / })
    ).not.toBeInTheDocument();
  });

  it("says photo uploads are unavailable when no blob store is configured", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "blob_not_configured" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
      )
    );
    render(<ChatFab />);

    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File([new Uint8Array([1])], "bed.png", { type: "image/png" })
    );

    // Translated, not the route's English prose — a student never sees an
    // English-only string (Article 6).
    expect(
      await screen.findByText(
        "Photo uploads are unavailable right now. You can still send your message without a photo."
      )
    ).toBeInTheDocument();
    // And the conversation is still usable without one.
    expect(
      screen.getByRole("textbox", { name: "Ask the lab console" })
    ).toBeEnabled();
  });

  async function attachPhotoAndSend(
    user: ReturnType<typeof userEvent.setup>,
    message: string
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              attachmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
              previewUrl: null,
              name: "plate.jpg",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    render(<ChatFab />);
    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File([new Uint8Array([1, 2, 3])], "plate.jpg", { type: "image/jpeg" })
    );
    await screen.findByRole("button", { name: "Remove plate.jpg" });
    await user.type(
      screen.getByRole("textbox", { name: "Ask the lab console" }),
      message
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
  }

  it("sends the photo itself with the message, so the model can see it", async () => {
    // Intake spec §6.1: the stored upload is the record and the downscaled copy
    // is what the model looks at. Both go out on the same message.
    downscaleForVision.mockClear();
    downscaleForVision.mockResolvedValue("data:image/jpeg;base64,SMALL");
    const user = userEvent.setup();

    await attachPhotoAndSend(user, "what printer is this?");

    expect(downscaleForVision).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const arg = sendMessage.mock.calls[0][0] as {
      text: string;
      files?: unknown[];
    };
    expect(arg.text).toContain(
      "[Attached photos: attachment_id=3f2504e0-4f89-41d3-9a0c-0305e82c3302 name=plate.jpg]"
    );
    expect(arg.files).toEqual([
      {
        type: "file",
        mediaType: "image/jpeg",
        filename: "plate.jpg",
        url: "data:image/jpeg;base64,SMALL",
      },
    ]);
  });

  it("still sends the upload hint when the browser cannot encode the photo", async () => {
    downscaleForVision.mockResolvedValue(null);
    const user = userEvent.setup();

    await attachPhotoAndSend(user, "what printer is this?");

    expect(sendMessage).toHaveBeenCalledWith({
      text: expect.stringContaining(
        "[Attached photos: attachment_id=3f2504e0-4f89-41d3-9a0c-0305e82c3302 name=plate.jpg]"
      ),
    });
  });
});

/**
 * The allowance ceiling (auth design spec §6).
 *
 * `useChat` surfaces the route's 429 as an Error whose message is the raw
 * response body, so these tests feed exactly that. What matters is the shape of
 * what the visitor sees: an assistant message with a way forward — never an
 * error row, never a toast.
 */
describe("ChatFab — rate-limit ceiling", () => {
  const anonymousCeiling = JSON.stringify({
    code: "rate_limited_sign_in",
    signInPath: "/api/auth/sign-in/google",
    limit: 8,
    windowMs: 3600000,
    retryAfterSeconds: 3600,
    error: "Too many requests. …sign in with your Cornell Tech account…",
  });

  const signedInCeiling = JSON.stringify({
    code: "rate_limited",
    limit: 60,
    windowMs: 3600000,
    retryAfterSeconds: 3600,
    error: "Too many requests. Please slow down.",
  });

  async function openWith(error: Error) {
    const user = userEvent.setup();
    useChatReturn = baseReturn({
      messages: [userMsg("u1", "how do I use the laser cutter?")],
      error,
    });
    render(<ChatFab />);
    await user.click(
      screen.getByRole("button", { name: "Open MakerLab assistant" })
    );
    return user;
  }

  it("renders the anonymous ceiling as an assistant message, not an error", async () => {
    await openWith(new Error(anonymousCeiling));

    const message = screen.getByText(/message limit for visitors who aren't signed in/i);
    const bubble = message.closest("li");
    expect(bubble).toHaveClass("chat-msg-assistant");
    expect(bubble).not.toHaveClass("chat-msg-error");
  });

  it("offers sign-in inside that message and starts from the current page", async () => {
    pathnameMock.mockReturnValue("/tools/form-4");
    const user = await openWith(new Error(anonymousCeiling));

    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn.closest("li")).toHaveClass("chat-msg-assistant");

    await user.click(signIn);
    expect(startGoogleSignIn).toHaveBeenCalledWith("/tools/form-4");
  });

  it("never shows the raw 429 body to the user", async () => {
    await openWith(new Error(anonymousCeiling));

    expect(screen.queryByText(/rate_limited_sign_in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/retryAfterSeconds/)).not.toBeInTheDocument();
  });

  it("tells a signed-in caller to wait, without offering sign-in again", async () => {
    await openWith(new Error(signedInCeiling));

    const message = screen.getByText(/hourly message limit/i);
    expect(message.closest("li")).toHaveClass("chat-msg-assistant");
    expect(
      screen.queryByRole("button", { name: "Sign in" })
    ).not.toBeInTheDocument();
  });

  it("still renders an ordinary streaming failure as an error row", async () => {
    await openWith(new Error("The AI service is temporarily overloaded."));

    const message = screen.getByText("The AI service is temporarily overloaded.");
    expect(message.closest("li")).toHaveClass("chat-msg-error");
  });

  it("does not mistake unrelated JSON for a ceiling", async () => {
    await openWith(new Error(JSON.stringify({ error: "Something else broke" })));

    const message = screen.getByText(/Something else broke/);
    expect(message.closest("li")).toHaveClass("chat-msg-error");
  });

  describe('tool-specific starter chips (amendment "Tool-specific starter questions")', () => {
    const FORM_4 = ["What resins can I print with?", "How do I wash and cure a print?", "How big can a part be?"];

    async function openChat() {
      await userEvent.setup().click(screen.getByRole("button", { name: "Open MakerLab assistant" }));
    }

    it("offers the tool's own questions on its page, and sends one when clicked", async () => {
      pathnameMock.mockReturnValue("/tools/form-4");
      render(
        <>
          <ToolChatStarters slug="form-4" id="tool-uuid" questions={FORM_4} />
          <ChatFab />
        </>
      );
      await openChat();

      for (const question of FORM_4) expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Find a machine for a project" })).not.toBeInTheDocument();

      await userEvent.setup().click(screen.getByRole("button", { name: "How big can a part be?" }));
      expect(sendMessage).toHaveBeenCalledWith({ text: "How big can a part be?" });
    });

    it("matches the page by the tool's id too", async () => {
      pathnameMock.mockReturnValue("/tools/tool-uuid");
      render(
        <>
          <ToolChatStarters slug="form-4" id="tool-uuid" questions={FORM_4} />
          <ChatFab />
        </>
      );
      await openChat();
      expect(screen.getByRole("button", { name: FORM_4[0] })).toBeInTheDocument();
    });

    it("keeps the generic chips for a tool with no questions of its own", async () => {
      pathnameMock.mockReturnValue("/tools/form-4");
      render(
        <>
          <ToolChatStarters slug="form-4" id="tool-uuid" questions={[]} />
          <ChatFab />
        </>
      );
      await openChat();
      expect(screen.getByRole("button", { name: "Find a machine for a project" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check training requirements" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ask about safety or policy" })).toBeInTheDocument();
    });

    it("keeps the generic chips on a page that is not that tool's", async () => {
      pathnameMock.mockReturnValue("/tools/trotec-speedy-400");
      render(
        <>
          <ToolChatStarters slug="form-4" id="tool-uuid" questions={FORM_4} />
          <ChatFab />
        </>
      );
      await openChat();
      expect(screen.getByRole("button", { name: "Find a machine for a project" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: FORM_4[0] })).not.toBeInTheDocument();
    });

    it("goes back to the generic chips when the tool page goes away", async () => {
      pathnameMock.mockReturnValue("/tools/form-4");
      const { rerender } = render(
        <>
          <ToolChatStarters slug="form-4" id="tool-uuid" questions={FORM_4} />
          <ChatFab />
        </>
      );
      await openChat();
      expect(screen.getByRole("button", { name: FORM_4[0] })).toBeInTheDocument();

      pathnameMock.mockReturnValue("/");
      rerender(<ChatFab />);
      expect(screen.getByRole("button", { name: "Find a machine for a project" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: FORM_4[0] })).not.toBeInTheDocument();
    });
  });
});
