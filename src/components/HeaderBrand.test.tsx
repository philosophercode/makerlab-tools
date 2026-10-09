import { readFileSync } from "node:fs";
import { act } from "react";
import { render, screen } from "../../test/utils/render";
import { HeaderBrand } from "./HeaderBrand";
import { setLandingLockupOnScreen } from "./home/landing-lockup-store";

/**
 * The header's lockup steps aside on `/` while the page's own big lockup is
 * on screen, so the logo shows once (student home spec, amendment "One page:
 * the list at rest"). Everywhere else it is as it was.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = "/";
  setLandingLockupOnScreen(true);
});

function brand() {
  // Concealed, it is still a link a keyboard reaches, with its name.
  return screen.getByRole("link", { name: "MakerLAB AI" });
}

it("is concealed on the home page while the page's lockup is on screen, keeping its place and its link", () => {
  render(<HeaderBrand />);
  expect(brand()).toHaveAttribute("data-concealed");
  expect(brand()).toHaveAttribute("href", "/");
  expect(brand()).toHaveClass("brand-lockup");
  expect(brand().querySelector('[data-slot="brand-wordmark"]')).not.toBeNull();
});

it("comes back on the home page once the page's lockup has scrolled away", () => {
  render(<HeaderBrand />);
  act(() => setLandingLockupOnScreen(false));
  expect(brand()).not.toHaveAttribute("data-concealed");
  act(() => setLandingLockupOnScreen(true));
  expect(brand()).toHaveAttribute("data-concealed");
});

it("shows on every other page", () => {
  for (const path of ["/about", "/projects", "/tools/form-4", "/admin"]) {
    pathname.current = path;
    const { unmount } = render(<HeaderBrand />);
    expect(brand()).not.toHaveAttribute("data-concealed");
    unmount();
  }
});

it("is transparent rather than hidden, and shows when focused (globals.css)", () => {
  const css = readFileSync("src/styles/globals.css", "utf8");
  const rule = css.match(/\.brand-lockup\[data-concealed\] \{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/opacity: 0/);
  expect(rule).not.toMatch(/visibility|display/);
  expect(css).toMatch(/\.brand-lockup\[data-concealed\]:focus-visible \{\s*opacity: 1;/);
});
