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

  it("offers to report a problem from a tool's label too", async () => {
    const user = userEvent.setup();
    renderNotice("src=qr");

    await user.click(screen.getByRole("button", { name: "Report a problem" }));

    expect(screen.getByTestId("chat-open")).toHaveTextContent("true");
    expect(screen.getByTestId("chat-seed")).toHaveTextContent("I'd like to report a problem with the Form 4.");
  });
});

// A unit's own label (QR codes spec amendment 2026-10-06): `?unit=<token>`
// names one machine, and reporting a problem with it is the first action.
describe("QrArrivalNotice — a unit's label", () => {
  const units = [
    { id: "194e4406-253b-4488-a886-5598ee56112c", name: "Form 4 // B", status: "Offline" as const },
    { id: "adf75899-7fc0-49e2-bfef-d6af0be787f5", name: "Form 4 // A", status: "Available" as const },
  ];

  function renderUnitNotice(query: string) {
    searchParams.value = new URLSearchParams(query);
    return render(
      <>
        <QrArrivalNotice toolName="Form 4" units={units} />
        <LauncherProbe />
      </>
    );
  }

  it("names the scanned unit, its tool and its status", () => {
    renderUnitNotice("src=qr&unit=194e4406");
    const notice = screen.getByRole("region", { name: "Scanned from this unit's label" });
    expect(notice).toHaveAttribute("data-qr-unit", units[0].id);
    expect(screen.getByRole("heading", { name: "Form 4 // B" })).toBeInTheDocument();
    expect(screen.getByText("A unit of the Form 4")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    // Not auto-opened: the person decides.
    expect(screen.getByTestId("chat-open")).toHaveTextContent("false");
  });

  it("starts a report for that unit in one tap", async () => {
    const user = userEvent.setup();
    renderUnitNotice("src=qr&unit=194e4406");

    await user.click(screen.getByRole("button", { name: "Report a problem with this unit" }));

    expect(screen.getByTestId("chat-open")).toHaveTextContent("true");
    expect(screen.getByTestId("chat-seed")).toHaveTextContent("I'd like to report a problem with Form 4 // B (Form 4).");
  });

  it("still lets them ask about the machine instead", async () => {
    const user = userEvent.setup();
    renderUnitNotice("src=qr&unit=adf75899");
    expect(screen.getByRole("heading", { name: "Form 4 // A" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask about this machine" }));
    expect(screen.getByTestId("chat-seed")).toHaveTextContent("I'm standing at the Form 4 and I have a question about it.");
  });

  it("names the unit from a shared link without ?src=qr, and accepts the whole id", () => {
    renderUnitNotice(`unit=${units[0].id}`);
    expect(screen.getByRole("heading", { name: "Form 4 // B" })).toBeInTheDocument();
  });

  it("shows the tool's notice when the token names none of its units", () => {
    renderUnitNotice("src=qr&unit=00000000");
    expect(screen.queryByRole("button", { name: "Report a problem with this unit" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask about the Form 4")).toBeInTheDocument();
  });

  it("renders nothing for a malformed or unknown unit without ?src=qr", () => {
    const { container } = renderUnitNotice("unit=%3Cscript%3E");
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByRole("button", { name: /Report a problem/ })).not.toBeInTheDocument();
  });

  it("recognizes the exact URL a unit's label encodes", async () => {
    const { unitQrTargetUrl } = await import("../../../lib/qr/urls");
    const encoded = new URL(unitQrTargetUrl("https://tools.example.edu", "form-4", units[0].id));
    expect(encoded.pathname).toBe("/tools/form-4");
    renderUnitNotice(encoded.searchParams.toString());
    expect(screen.getByRole("button", { name: "Report a problem with this unit" })).toBeInTheDocument();
  });
});
