import { render, screen } from "../../../test/utils/render";
import { DemoSignupCallout } from "./DemoSignupCallout";

/** The front page's way to the sign-up (demo pass spec 2026-10-07 §6, amendment 2026-10-11). */

afterEach(() => vi.unstubAllEnvs());

describe("DemoSignupCallout", () => {
  it("links the sign-up with one question and a clear button, and says nothing about a pass", () => {
    render(<DemoSignupCallout />);
    const callout = screen.getByRole("complementary", { name: "MakerLAB AI for your makerspace" });
    expect(callout).toHaveTextContent("Interested in bringing MakerLAB AI to your makerspace?");
    expect(callout).not.toHaveTextContent(/pass/i);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/demo");
  });

  it("on the home page is one small line, the same link, no box", () => {
    render(<DemoSignupCallout variant="inline" />);
    const callout = screen.getByRole("complementary", { name: "MakerLAB AI for your makerspace" });
    expect(callout).toHaveAttribute("data-variant", "inline");
    // No card: the boxed look's bordered plate is not drawn.
    expect(callout.querySelector(".bg-card")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/demo");
  });

  it("is gone when DEMO_PASS is off", () => {
    vi.stubEnv("DEMO_PASS", "off");
    const { container } = render(<DemoSignupCallout />);
    expect(container).toBeEmptyDOMElement();
    const inline = render(<DemoSignupCallout variant="inline" />);
    expect(inline.container).toBeEmptyDOMElement();
  });
});
