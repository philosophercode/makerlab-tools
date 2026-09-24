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
 * Who sees the way into `/admin` — since 2026-09-23 an entry in the header's
 * profile menu rather than a link in the bar. The refusal behind it is the `/admin` layout
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

describe("AdminLink — as a profile-menu item", () => {
  it("renders as a menuitem outside the tab order, with the menu's class", () => {
    render(<AdminLink role="admin" menuItem className="profile-menu-item" />);

    const item = screen.getByRole("menuitem", { name: "ADMIN" });
    expect(item).toHaveAttribute("href", ADMIN_HREF);
    expect(item).toHaveAttribute("tabindex", "-1");
    expect(item).toHaveClass("profile-menu-item");
    expect(item).not.toHaveClass("primary-nav-admin");
  });

  it("still renders nothing for a role with no admin surface", () => {
    const { container } = render(<AdminLink role="user" menuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells the menu when it is chosen", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<AdminLink role="super_admin" menuItem onClick={onClick} />);

    await user.click(screen.getByRole("menuitem", { name: "ADMIN" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
