import { render, screen, userEvent } from "../../../../test/utils/render";
import { QrArrivalNotice } from "./QrArrivalNotice";

// The notice reads the query string via `useSearchParams`; nothing else from
// next/navigation is used here.
const searchParams = { value: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.value,
}));

// `ChatLauncherProvider` (from the shared render helper) owns the open state,
// so tapping the button is observable through the launcher's own consumers.
// Spy on the provider by rendering a probe alongside the notice.
import { useChatLauncher } from "../../../components/ChatLauncherContext";

function LauncherProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <div>
      <span data-testid="chat-open">{String(isOpen)}</span>
      <span data-testid="chat-seed">{pendingSeed?.text ?? ""}</span>
    </div>
  );
}

function renderNotice(query: string) {
  searchParams.value = new URLSearchParams(query);
  return render(
    <>
      <QrArrivalNotice toolName="Form 4" />
      <LauncherProbe />
    </>
  );
}

describe("QrArrivalNotice", () => {
  it("surfaces the assistant when ?src=qr is present", () => {
    renderNotice("src=qr");
    expect(
      screen.getByRole("button", { name: "Ask about this machine" })
    ).toBeInTheDocument();
    expect(screen.getByText("Ask about the Form 4")).toBeInTheDocument();
  });

  it("renders nothing without ?src=qr", () => {
    renderNotice("");
    expect(
      screen.queryByRole("button", { name: "Ask about this machine" })
    ).not.toBeInTheDocument();
  });

  it("renders nothing for a different ?src value", () => {
    renderNotice("src=email");
    expect(
      screen.queryByRole("button", { name: "Ask about this machine" })
    ).not.toBeInTheDocument();
  });

  it("surfaces but does not auto-open the assistant", () => {
    renderNotice("src=qr");
    expect(screen.getByTestId("chat-open")).toHaveTextContent("false");
    expect(screen.getByTestId("chat-seed")).toHaveTextContent("");
  });

  // The marker is written by the label generator and read here. Feed one side's
  // output into the other so the two cannot drift apart silently.
  it("recognizes the exact URL the label generator encodes", async () => {
    const { toolPageUrl } = await import("../../../../scripts/generate-qr-labels.ts");
    const encoded = new URL(toolPageUrl("https://tools.example.edu", "form-4"));

    searchParams.value = encoded.searchParams;
    render(<QrArrivalNotice toolName="Form 4" />);

    expect(encoded.pathname).toBe("/tools/form-4");
    expect(
      screen.getByRole("button", { name: "Ask about this machine" })
    ).toBeInTheDocument();
  });

  it("opens the chat seeded for this machine when tapped", async () => {
    const user = userEvent.setup();
    renderNotice("src=qr");

    await user.click(screen.getByRole("button", { name: "Ask about this machine" }));

    expect(screen.getByTestId("chat-open")).toHaveTextContent("true");
    expect(screen.getByTestId("chat-seed")).toHaveTextContent(
      "I'm standing at the Form 4 and I have a question about it."
    );
  });
});
