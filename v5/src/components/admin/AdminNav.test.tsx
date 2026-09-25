import { render, screen, within } from "../../../test/utils/render";
import { ADMIN_SURFACES } from "../../lib/admin/surfaces";
import { AdminNav } from "./AdminNav";

/**
 * The admin section bar (UI system spec §7.2): it links only what it is
 * handed (the layout filters by permission), groups by job, and marks the one
 * page you are on — the most specific match, so an import page is not also
 * "Intake".
 */

const pathname = vi.hoisted(() => ({ value: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const ALL = ADMIN_SURFACES.map(({ key, href, group }) => ({ key, href, group }));

it("links exactly the surfaces it is given, grouped by job", () => {
  render(<AdminNav items={ALL.filter((item) => item.group !== "settings")} />);
  const nav = screen.getByRole("navigation", { name: "Admin sections" });
  expect(within(nav).getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/admin/inventory");
  expect(within(nav).queryByRole("link", { name: "People" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("list", { name: "Queues" })).toBeInTheDocument();
});

it("marks the most specific surface as the current page", () => {
  pathname.value = "/admin/intake/imports/new";
  render(<AdminNav items={ALL} />);
  expect(screen.getByRole("link", { name: "Import a list" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Intake" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
});

it("marks Overview on the admin home", () => {
  pathname.value = "/admin";
  render(<AdminNav items={ALL} />);
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
});
