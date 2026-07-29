/**
 * The domain-rejected page (auth design spec §5, §6).
 *
 * The assertions are deliberately about the *shape of the dead end*: the page
 * has to explain what happened, say that browsing and asking questions still
 * work without an account, and offer a link out. A page that only says "no" is
 * the failure mode this test exists to catch.
 */
import AuthRejectedPage from "./page";
import { render, screen } from "../../../../test/utils/render";
import { siteConfig } from "../../../lib/site-config";

describe("/auth/rejected", () => {
  it("names the institution the app signs in with, from config", () => {
    render(<AuthRejectedPage />);

    // Default site-config values (env unset): "Cornell Tech" / "MakerLab Tools".
    expect(siteConfig.institution).toBe("Cornell Tech");
    expect(
      screen.getByRole("heading", {
        name: "That account isn't a Cornell Tech account",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/MakerLab Tools signs in with Cornell Tech accounts only/)
    ).toBeInTheDocument();
  });

  it("says browsing and asking questions still work without signing in", () => {
    render(<AuthRejectedPage />);

    expect(
      screen.getByText(
        /browse the whole catalog and ask the assistant questions without signing in/i
      )
    ).toBeInTheDocument();
  });

  it("links back to the catalog rather than dead-ending", () => {
    render(<AuthRejectedPage />);

    expect(
      screen.getByRole("link", { name: "Browse the catalog" })
    ).toHaveAttribute("href", "/");
  });

  it("shows no sign-in dead end: nothing here 401s or blocks the page", () => {
    const { container } = render(<AuthRejectedPage />);

    // A plain informational panel — no form, no error role, no retry-only UI.
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
