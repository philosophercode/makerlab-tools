import { render, screen, userEvent } from "../../test/utils/render";

/**
 * The chat's performance contract (performance plan, quick win 9 and "Load
 * the chat code only when the chat is opened"):
 *
 * - while an answer streams, only the streaming message re-renders — the
 *   earlier turns are memoised;
 * - the chat's code is not part of the page: ChatFab loads it on first open,
 *   through `React.lazy` (not mocked here).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

type Msg = { id: string; role: "user" | "assistant"; parts: Array<{ type: string; text: string }> };
let messages: Msg[] = [];
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages, sendMessage: vi.fn(), setMessages: vi.fn(), status: "streaming", error: undefined }),
}));

// Counts ChatMessage renders: `citedPassages` runs once per render of a message.
const citedCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("./chat/manual-citations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chat/manual-citations")>();
  return {
    ...actual,
    citedPassages: (...args: Parameters<typeof actual.citedPassages>) => {
      citedCalls.count += 1;
      return actual.citedPassages(...args);
    },
  };
});

import { ChatFab } from "./ChatFab";
import { ChatPanel } from "./ChatPanel";
import { useChatLauncher } from "./ChatLauncherContext";

function OpenOnMount() {
  const { open, isOpen } = useChatLauncher();
  if (!isOpen) queueMicrotask(() => open());
  return null;
}

describe("streaming renders (quick win 9)", () => {
  it("re-renders only the streaming message on each chunk, not the whole conversation", async () => {
    const history: Msg[] = Array.from({ length: 10 }, (_, n) => ({
      id: `m${n}`,
      role: n % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `turn ${n}` }],
    }));
    messages = history;
    const view = render(
      <>
        <OpenOnMount />
        <ChatPanel />
      </>
    );
    await screen.findByText("turn 9");

    citedCalls.count = 0;
    const chunks = 20;
    for (let chunk = 1; chunk <= chunks; chunk += 1) {
      // The AI SDK replaces only the streaming (last) message's object.
      const streaming: Msg = { id: "m9", role: "assistant", parts: [{ type: "text", text: `turn 9 ${"x".repeat(chunk)}` }] };
      messages = [...history.slice(0, 9), streaming];
      view.rerender(
        <>
          <OpenOnMount />
          <ChatPanel />
        </>
      );
    }

    // One message render per chunk; unmemoised it was one per message per chunk (200).
    expect(citedCalls.count).toBe(chunks);
  });
});

describe("the chat's code loads on open", () => {
  it("draws the launcher without the panel, then loads and opens it on click", async () => {
    messages = [];
    const user = userEvent.setup();
    render(<ChatFab />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open MakerLAB AI" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
