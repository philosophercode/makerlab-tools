import { render, screen, within } from "../../../test/utils/render";
import { surfacesFor } from "../../lib/admin/surfaces";
import { AdminNav } from "./AdminNav";

/**
 * The admin section bar (UI system spec §8.1; admin sections spec
 * 2026-10-07): six sections, each linked to the first surface in it the
 * viewer may open, only sections the viewer has something in, the section of
 * the page you are on marked, and no waiting counts (owner decision
 * 2026-09-25).
 */

const pathname = vi.hoisted(() => ({ value: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const itemsFor = (role: "admin" | "super_admin") => surfacesFor({ role }).map(({ key, href, section }) => ({ key, href, section }));

beforeEach(() => {
  pathname.value = "/admin";
});

const linkNames = () =>
  within(screen.getByRole("navigation", { name: "Admin sections" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

it("shows a director the six sections, in order", () => {
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(linkNames()).toEqual(["Overview", "Maintenance", "Inventory", "People", "Insights", "Settings"]);
  expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/admin/users");
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin/settings");
});

it("opens a SuperMaker's People on Student projects, not the roster", () => {
  render(<AdminNav items={itemsFor("admin")} />);
  expect(linkNames()).toEqual(["Overview", "Maintenance", "Inventory", "People", "Insights", "Settings"]);
  expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/admin/projects");
});

it("leaves out a section the viewer has nothing in", () => {
  render(<AdminNav items={itemsFor("admin").filter((item) => item.section !== "people")} />);
  expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
});

it("marks Inventory on QR labels, an Inventory tab", () => {
  pathname.value = "/admin/inventory/qr";
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
});

it("marks Inventory on the import page: importing a list is part of Add equipment", () => {
  pathname.value = "/admin/intake/imports/new";
  render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.queryByRole("link", { name: "Import a list" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
});

it("marks Settings on the MCP page and on AI agents", () => {
  pathname.value = "/admin/proposals";
  const { unmount } = render(<AdminNav items={itemsFor("super_admin")} />);
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  unmount();
  pathname.value = "/admin/settings/ai-agents";
  render(<AdminNav items={itemsFor("admin")} />);
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
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
