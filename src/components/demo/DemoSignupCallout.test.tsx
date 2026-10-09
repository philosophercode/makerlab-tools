import { render, screen } from "../../../test/utils/render";
import { DemoSignupCallout } from "./DemoSignupCallout";

/** The front page's demo pass button (demo pass spec 2026-10-07 §6). */

afterEach(() => vi.unstubAllEnvs());

describe("DemoSignupCallout", () => {
  it("links the sign-up with one sentence and a clear button", () => {
    render(<DemoSignupCallout />);
    expect(screen.getByRole("complementary", { name: "Demo pass" })).toHaveTextContent(/Get a free demo pass to chat with the lab's assistant and report a problem\. No Cornell Tech account needed\./);
    expect(screen.getByRole("link", { name: "Sign up to try the full demo" })).toHaveAttribute("href", "/demo");
  });

  it("on the home page is one small line, the same link, no box", () => {
    render(<DemoSignupCallout variant="inline" />);
    const callout = screen.getByRole("complementary", { name: "Demo pass" });
    expect(callout).toHaveAttribute("data-variant", "inline");
    // No card: the boxed look's bordered plate is not drawn.
    expect(callout.querySelector(".bg-card")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign up to try the full demo" })).toHaveAttribute("href", "/demo");
  });

  it("is gone when DEMO_PASS is off", () => {
    vi.stubEnv("DEMO_PASS", "off");
    const { container } = render(<DemoSignupCallout />);
    expect(container).toBeEmptyDOMElement();
    const inline = render(<DemoSignupCallout variant="inline" />);
    expect(inline.container).toBeEmptyDOMElement();
  });
});
