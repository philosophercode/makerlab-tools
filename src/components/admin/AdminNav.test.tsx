import { render, screen, within } from "../../../test/utils/render";
import { surfacesFor } from "../../lib/admin/surfaces";
import { AdminNav } from "./AdminNav";

/**
 * The admin section bar (UI system spec §8.1): it links only what it is
 * handed (the layout hands it `surfacesFor(identity)`), groups by job with
 * each group a named list, marks the one page you are on — the most specific
 * match — and carries no waiting counts (owner decision 2026-09-25).
 */

const pathname = vi.hoisted(() => ({ value: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const itemsFor = (role: "admin" | "super_admin") => surfacesFor({ role }).map(({ key, href, group }) => ({ key, href, group }));

beforeEach(() => {
  pathname.value = "/admin";
});

it("links exactly a SuperMaker's surfaces, grouped by job, and not People", () => {
  render(<AdminNav items={itemsFor("admin")} />);
  const nav = screen.getByRole("navigation", { name: "Admin sections" });
  expect(within(nav).getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/admin/inventory");
  expect(within(nav).queryByRole("link", { name: "People" })).not.toBeInTheDocument();
  const queues = within(nav).getByRole("list", { name: "Queues" });
  expect(within(queues).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Maintenance",
    "Corrections",
    "Projects",
  ]);
  // People was the settings group's other member; the mirror keeps it alive.
  expect(within(nav).getByRole("list", { name: "People & settings" })).toBeInTheDocument();
});

it("offers a super admin People", () => {
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/admin/users");
});

it("leaves out a group the viewer has nothing in", () => {
  render(<AdminNav items={itemsFor("admin").filter((item) => item.group !== "queues")} />);
  expect(screen.queryByRole("list", { name: "Queues" })).not.toBeInTheDocument();
});

it("marks Intake on the import page: importing a list is part of Intake, not a surface (2026-09-25)", () => {
  pathname.value = "/admin/intake/imports/new";
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.queryByRole("link", { name: "Import a list" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Intake" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
});

it("marks the surface on one of its items' pages", () => {
  pathname.value = "/admin/refresh/abc";
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.getByRole("link", { name: "Refresh research" })).toHaveAttribute("aria-current", "page");
});

it("marks Overview on the admin home", () => {
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
});

it("carries no counts, and renders what the layout puts at its end", () => {
  render(<AdminNav items={itemsFor("super_admin")} end={<button type="button">Search</button>} />);
  const nav = screen.getByRole("navigation", { name: "Admin sections" });
  expect(nav.textContent).not.toMatch(/\d/);
  expect(within(nav).getByRole("button", { name: "Search" })).toBeInTheDocument();
});
