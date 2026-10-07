/**
 * The domain-rejected page (auth design spec §5, §6; amendment 2026-10-07).
 *
 * The assertions are deliberately about the *shape of the way out*: the page
 * names the address Google returned and says why in one line, offers "Use a
 * different Google account", says browsing and asking still work, and links
 * back to the catalog. A page that only says "no" is the failure mode these
 * tests exist to catch.
 */
import type { ReactElement } from "react";
import AuthRejectedPage from "./page";
import { RefusedSignInView } from "../../../components/account/RefusedSignIn";
import { render, screen } from "../../../../test/utils/render";
import { siteConfig } from "../../../lib/site-config";

vi.mock("../../../lib/auth/refused-sign-in-cookie", () => ({ readRefusedSignIn: async () => null }));

const REFUSED = { email: "someone@gmail.com", retryPath: "/tools/form-4" };

function renderView(refused: typeof REFUSED | null = REFUSED) {
  return render(<RefusedSignInView reason="domain" refused={refused} domain="cornell.edu" />);
}

describe("/auth/rejected", () => {
  it("names the institution the app signs in with, from config", () => {
    renderView();

    // Default site-config values (env unset): "Cornell Tech" / "MakerLAB Tools".
    expect(siteConfig.institution).toBe("Cornell Tech");
    expect(screen.getByRole("heading", { name: "That account isn't a Cornell Tech account" })).toBeInTheDocument();
  });

  it("says which address was refused, and why, in one line", () => {
    renderView();

    const line = screen.getByTestId("refused-line");
    expect(line).toHaveTextContent(
      "someone@gmail.com can't be used: MakerLAB Tools only accepts Cornell Tech accounts (addresses ending in @cornell.edu)."
    );
    // The address stands out, and wraps on a phone rather than overflowing.
    expect(screen.getByText("someone@gmail.com").tagName).toBe("STRONG");
    expect(screen.getByText("someone@gmail.com")).toHaveClass("break-all");
  });

  it("says 'This Google account' when it does not know the address", () => {
    renderView(null);

    expect(screen.getByTestId("refused-line")).toHaveTextContent(/^This Google account can't be used: /);
  });

  it("offers a different Google account as the way out", () => {
    renderView();

    expect(screen.getByRole("button", { name: "Use a different Google account" })).toBeEnabled();
  });

  it("says browsing and asking questions still work without signing in", () => {
    renderView();

    expect(
      screen.getByText(/browse the whole catalog and ask the assistant questions without signing in/i)
    ).toBeInTheDocument();
  });

  it("links back to the catalog rather than dead-ending", () => {
    renderView();

    expect(screen.getByRole("link", { name: "Browse the catalog" })).toHaveAttribute("href", "/");
  });

  it("shows no form and no error until something fails", () => {
    const { container } = renderView();

    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the page without the address while the cookie is read", () => {
    // The page reads a cookie, so it streams; its fallback is the same page
    // with the address-free line, never an empty screen.
    const element = AuthRejectedPage() as ReactElement<{ fallback: ReactElement }>;
    render(element.props.fallback);
    expect(screen.getByTestId("refused-line")).toHaveTextContent(/^This Google account can't be used: /);
    expect(screen.getByRole("button", { name: "Use a different Google account" })).toBeInTheDocument();
  });
});
