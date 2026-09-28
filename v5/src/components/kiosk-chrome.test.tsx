import { render, screen, waitFor } from "../../test/utils/render";
import { useChatLauncher } from "./ChatLauncherContext";
import { AskParamOpener } from "./AskParamOpener";
import { isKioskPath } from "./kiosk-path";
import { SiteChrome } from "./SiteChrome";

/**
 * The root layout around `/kiosk` (kiosk spec §3.1, §5.4): the site's chrome
 * steps aside on the kiosk, and `?ask=1` — what the kiosk's QR code carries —
 * opens the assistant on the phone that scanned it.
 */

const pathname = vi.fn<() => string>(() => "/");
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useSearchParams: () => search,
}));

function ChatState() {
  const { isOpen } = useChatLauncher();
  return <p data-testid="chat">{isOpen ? "open" : "closed"}</p>;
}

beforeEach(() => {
  pathname.mockReturnValue("/");
  search = new URLSearchParams();
});

describe("isKioskPath", () => {
  it.each([
    ["/kiosk", true],
    ["/kiosk/", true],
    ["/kiosk/booth", true],
    ["/kiosks", false],
    ["/", false],
    ["/admin", false],
    [null, false],
  ])("%s → %s", (path, expected) => {
    expect(isKioskPath(path)).toBe(expected);
  });
});

describe("SiteChrome", () => {
  it("draws the header everywhere else", () => {
    render(
      <SiteChrome>
        <header>site header</header>
      </SiteChrome>
    );
    expect(screen.getByText("site header")).toBeInTheDocument();
  });

  it("draws nothing on the kiosk, which has its own top bar and demo chip", () => {
    pathname.mockReturnValue("/kiosk");
    render(
      <SiteChrome>
        <header>site header</header>
      </SiteChrome>
    );
    expect(screen.queryByText("site header")).not.toBeInTheDocument();
  });
});

describe("AskParamOpener", () => {
  it("opens the assistant when the page was reached with ?src=kiosk&ask=1", async () => {
    search = new URLSearchParams("src=kiosk&ask=1");
    render(
      <>
        <AskParamOpener />
        <ChatState />
      </>
    );
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("open"));
  });

  it("leaves it closed without the parameter — ?src=kiosk alone is presentation only", () => {
    search = new URLSearchParams("src=kiosk");
    render(
      <>
        <AskParamOpener />
        <ChatState />
      </>
    );
    expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  });

  it("never opens a chat on the kiosk itself", () => {
    pathname.mockReturnValue("/kiosk");
    search = new URLSearchParams("ask=1");
    render(
      <>
        <AskParamOpener />
        <ChatState />
      </>
    );
    expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  });
});
