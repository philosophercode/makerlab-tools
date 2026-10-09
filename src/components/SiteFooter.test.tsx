import { SiteFooter } from "./SiteFooter";
import { useChatLauncher } from "./ChatLauncherContext";
import { render, screen, userEvent, within } from "../../test/utils/render";

/** Shows what the chat launcher was asked to do, so a test can read it. */
function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <output data-testid="chat-probe">
      {isOpen ? "open" : "closed"}|{pendingSeed?.text ?? ""}
    </output>
  );
}

describe("SiteFooter", () => {
  it("links the product page, the quick start, About and MCP, and the lab's official page", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const nav = within(footer).getByRole("navigation", { name: "Site" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Product", "/product"],
      ["Quick start", "/product/quick-start"],
      ["About", "/about"],
      ["Connect an AI", "/mcp"],
    ]);
    expect(within(footer).getByRole("link", { name: "The MakerLAB at Cornell Tech" })).toHaveAttribute("href", "https://tech.cornell.edu/research/makerlab/");
  });

  // REPORT left the header on 2026-10-07; the footer keeps reporting one press
  // away on every page, the way the header's button did: the assistant opens
  // with the report seed.
  it("offers Report a problem, which opens the assistant with the report seed", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SiteFooter />
        <ChatProbe />
      </>
    );

    const nav = within(screen.getByRole("contentinfo")).getByRole("navigation", { name: "Site" });
    expect(screen.getByTestId("chat-probe")).toHaveTextContent("closed|");
    await user.click(within(nav).getByRole("button", { name: "Report a problem" }));
    expect(screen.getByTestId("chat-probe")).toHaveTextContent("open|I'd like to report a problem.");
  });

  it("starts with the lab's official logo, as decoration beside the words that name the lab", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const logo = footer.querySelector('[data-slot="brand-logo"]');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(footer.querySelector("div")?.firstElementChild).toBe(logo);
  });
});
