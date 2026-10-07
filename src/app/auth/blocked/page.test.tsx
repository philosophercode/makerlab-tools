/**
 * The blocked-address page (auth spec amendments 2026-09-25 and 2026-10-07):
 * the twin of `/auth/rejected`, held to the same rule. It names the address,
 * says why, offers another Google account and a way back to the catalog.
 */
import type { ReactElement } from "react";
import AuthBlockedPage from "./page";
import { RefusedSignInView } from "../../../components/account/RefusedSignIn";
import { render, screen } from "../../../../test/utils/render";

vi.mock("../../../lib/auth/refused-sign-in-cookie", () => ({ readRefusedSignIn: async () => null }));

describe("/auth/blocked", () => {
  it("says this address cannot sign in, naming the site from config", () => {
    render(<RefusedSignInView reason="blocked" refused={null} domain="cornell.edu" />);

    expect(screen.getByRole("heading", { name: "This account can't sign in to MakerLAB Tools" })).toBeInTheDocument();
    expect(screen.getByText(/has blocked this address/)).toBeInTheDocument();
  });

  it("names the blocked address when it knows it", () => {
    render(
      <RefusedSignInView reason="blocked" refused={{ email: "gone@cornell.edu", retryPath: "/" }} domain="cornell.edu" />
    );

    expect(screen.getByTestId("refused-line")).toHaveTextContent(
      "gone@cornell.edu can't be used: a MakerLAB Tools administrator has blocked this address."
    );
  });

  it("offers a different Google account, says what still works, and links back to the catalog", () => {
    render(<RefusedSignInView reason="blocked" refused={null} domain="cornell.edu" />);

    expect(screen.getByRole("button", { name: "Use a different Google account" })).toBeInTheDocument();
    expect(
      screen.getByText(/browse the whole catalog and ask the assistant questions without signing in/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the catalog" })).toHaveAttribute("href", "/");
  });

  it("falls back to the same page without the address while the cookie is read", () => {
    const element = AuthBlockedPage() as ReactElement<{ fallback: ReactElement }>;
    render(element.props.fallback);
    expect(screen.getByText(/has blocked this address from signing up/)).toBeInTheDocument();
  });
});
