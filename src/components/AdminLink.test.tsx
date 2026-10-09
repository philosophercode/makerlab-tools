import { ADMIN_HREF, AdminLink } from "./AdminLink";
import { render, screen, userEvent } from "../../test/utils/render";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Who sees the way into `/admin` — ADMIN in the header's bar (2026-10-07; it
 * was a profile-menu entry from 2026-09-23). The refusal behind it is the `/admin` layout
 * (`canReachAdmin` again, server-side) — hiding this link is presentation.
 */

// en.json: nav.admin = "ADMIN".
describe("AdminLink — who sees it", () => {
  it("renders nothing while identity is still resolving", () => {
    const { container } = render(<AdminLink role={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an anonymous visitor", () => {
    const { container } = render(<AdminLink role="anonymous" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an ordinary signed-in user", () => {
    // Signing in unlocks submitting a project and nothing else — there is no
    // admin surface a student holds a permission for.
    const { container } = render(<AdminLink role="user" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders for a SuperMaker, whose queues live behind the same link", () => {
    render(<AdminLink role="admin" />);
    expect(screen.getByRole("link", { name: "ADMIN" })).toHaveAttribute("href", ADMIN_HREF);
  });

  it("renders for a director", () => {
    render(<AdminLink role="super_admin" />);
    expect(screen.getByRole("link", { name: "ADMIN" })).toBeInTheDocument();
  });
});

describe("AdminLink — in the bar (2026-10-07)", () => {
  it("is a plain link in the tab order, with the bar's class unless told otherwise", () => {
    render(<AdminLink role="admin" />);

    const link = screen.getByRole("link", { name: "ADMIN" });
    expect(link).toHaveAttribute("href", ADMIN_HREF);
    expect(link).not.toHaveAttribute("tabindex");
    expect(link).not.toHaveAttribute("role");
    expect(link).toHaveClass("primary-nav-admin");
  });

  it("takes the caller's class, e.g. the bar's current-page mark", () => {
    render(<AdminLink role="admin" className="primary-nav-admin is-active" />);

    expect(screen.getByRole("link", { name: "ADMIN" })).toHaveClass("primary-nav-admin", "is-active");
  });

  it("tells the bar when it is followed, so the short bar's MENU can close", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<AdminLink role="super_admin" onClick={onClick} />);
    // Keep jsdom from navigating; the link's own handler still runs.
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop, { capture: true });

    await user.click(screen.getByRole("link", { name: "ADMIN" }));

    window.removeEventListener("click", stop, { capture: true });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
