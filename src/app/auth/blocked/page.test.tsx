/**
 * The blocked-address page (auth spec amendment 2026-09-25): the twin of
 * `/auth/rejected`, held to the same rule — explain, say what still works,
 * offer a way out.
 */
import AuthBlockedPage from "./page";
import { render, screen } from "../../../../test/utils/render";

describe("/auth/blocked", () => {
  it("says this address cannot sign in, naming the site from config", () => {
    render(<AuthBlockedPage />);

    expect(screen.getByRole("heading", { name: "This account can't sign in to MakerLab Tools" })).toBeInTheDocument();
    expect(screen.getByText(/has blocked this address/)).toBeInTheDocument();
  });

  it("says browsing and asking questions still work, and links back to the catalog", () => {
    render(<AuthBlockedPage />);

    expect(
      screen.getByText(/browse the whole catalog and ask the assistant questions without signing in/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the catalog" })).toHaveAttribute("href", "/");
  });
});
