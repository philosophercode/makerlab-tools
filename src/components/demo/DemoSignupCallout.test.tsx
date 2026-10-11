import { render, screen } from "../../../test/utils/render";
import { DemoSignupCallout } from "./DemoSignupCallout";

/** The home page's callout box (demo pass spec 2026-10-07 §6, amendment 2026-10-11). */

afterEach(() => vi.unstubAllEnvs());

describe("DemoSignupCallout", () => {
  it("is a box with a heading, one short line and a clear button, and says nothing about a pass", () => {
    render(<DemoSignupCallout />);
    const callout = screen.getByRole("complementary", { name: "MakerLAB AI for your makerspace" });
    expect(screen.getByRole("heading", { name: "Interested in bringing MakerLAB AI to your makerspace?" })).toBeInTheDocument();
    expect(callout).toHaveTextContent("Leave your details and we'll be in touch.");
    expect(callout).not.toHaveTextContent(/pass/i);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/demo");
  });

  it("is drawn as a bordered, tinted, square box that stacks under sm", () => {
    render(<DemoSignupCallout />);
    const box = screen.getByRole("complementary").firstElementChild as HTMLElement;
    // Existing tokens only: the accent ink border and the muted surface; no rounding.
    expect(box).toHaveClass("border", "border-primary-ink", "bg-muted", "flex-col", "sm:flex-row");
    expect(box.className).not.toMatch(/rounded/);
    expect(box).toContainElement(screen.getByRole("link", { name: "Sign up" }));
  });

  it("is gone when DEMO_PASS is off", () => {
    vi.stubEnv("DEMO_PASS", "off");
    const { container } = render(<DemoSignupCallout />);
    expect(container).toBeEmptyDOMElement();
  });
});
