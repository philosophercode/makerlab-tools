import { render, screen, within } from "../../../test/utils/render";
import { surfacesFor } from "../../lib/admin/surfaces";
import { AdminSurfacesProvider } from "./AdminSurfacesContext";
import { SectionTabs } from "./SectionTabs";

/**
 * The tabs under an admin page's header (admin sections spec 2026-10-07): the
 * section's surfaces the viewer may open, the current one marked, none drawn
 * for a section with one surface or outside the admin layout.
 */

const pathname = vi.hoisted(() => ({ value: "/admin/inventory" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const itemsFor = (role: "admin" | "super_admin") => surfacesFor({ role }).map(({ key, href, section }) => ({ key, href, section }));

function renderTabs(role: "admin" | "super_admin", section: Parameters<typeof SectionTabs>[0]["section"]) {
  return render(
    <AdminSurfacesProvider items={itemsFor(role)}>
      <SectionTabs section={section} />
    </AdminSurfacesProvider>
  );
}

it("lists Inventory's tabs, QR labels among them, and marks the one you are on", () => {
  pathname.value = "/admin/inventory/qr";
  renderTabs("admin", "inventory");
  const nav = screen.getByRole("navigation", { name: "Inventory pages" });
  expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "All tools",
    "Add equipment",
    "QR labels",
    "Lab notes",
    "Manuals",
    "Check for updates",
    "Categories",
    "Page corrections",
  ]);
  expect(within(nav).getByRole("link", { name: "QR labels" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "All tools" })).not.toHaveAttribute("aria-current");
});

it("lists Maintenance's tickets, Shift checklist and recurring tasks", () => {
  pathname.value = "/admin/maintenance/checklist";
  renderTabs("admin", "maintenance");
  const nav = screen.getByRole("navigation", { name: "Maintenance pages" });
  expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Tickets", "Shift checklist", "Recurring tasks"]);
  expect(within(nav).getByRole("link", { name: "Shift checklist" })).toHaveAttribute("aria-current", "page");
});

it("names MCP and AI agents under Settings", () => {
  pathname.value = "/admin/settings";
  renderTabs("super_admin", "settings");
  const nav = screen.getByRole("navigation", { name: "Settings pages" });
  expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["General", "Notion mirror", "MCP", "AI agents"]);
});

it("offers a director the roster beside Student projects, and a SuperMaker no People tabs at all", () => {
  pathname.value = "/admin/users";
  const { unmount } = renderTabs("super_admin", "people");
  expect(within(screen.getByRole("navigation", { name: "People pages" })).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Roster",
    "Student projects",
  ]);
  unmount();
  renderTabs("admin", "people");
  expect(screen.queryByRole("navigation", { name: "People pages" })).not.toBeInTheDocument();
});

it("draws nothing outside the admin layout", () => {
  render(<SectionTabs section="inventory" />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
