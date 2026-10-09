import {
  BookOpenText,
  Bot,
  Boxes,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  Flag,
  FolderTree,
  GalleryVerticalEnd,
  NotebookPen,
  PackagePlus,
  Plug,
  QrCode,
  RefreshCw,
  Settings,
  Share2,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_SURFACE_PERMISSIONS, can, type Permission } from "../auth/permissions";
import type { Role } from "../auth/roles";
import { INTAKE_REVIEW_PERMISSION } from "../intake/access";

/**
 * Every admin surface, once (UI system spec §5.2, §8.1; admin sections spec
 * 2026-10-07). This one list feeds the section bar on every admin page, the
 * tabs under each page's header, the `/admin` overview's counts and the ⌘K
 * palette, so a page added here appears in all of them, and a page left out
 * is reachable from none of them, which a test catches.
 *
 * **Six sections, by the job a person came to do** (owner's decisions,
 * 2026-10-07): Overview, Maintenance, Inventory, People, Insights, Settings.
 * The bar shows sections; each surface belongs to one, and the surfaces of a
 * section are the tabs under its pages' headers. A section's link opens the
 * first of its surfaces the viewer may open, so it is always a real page and
 * never a refusal or a hub.
 *
 * **Each entry carries its own permission**, the same one its page checks with
 * `can()`, and every list shown to a person is {@link surfacesFor} that
 * person: nobody is offered a surface that would refuse them. Showing is
 * presentation; the page's own check is the control.
 *
 * `count` names the loader in `lib/data/admin-overview.ts` whose numbers the
 * overview shows for the surface. It is a name rather than a function so this
 * module stays client-safe (the palette imports it) and the database stays
 * out of the browser bundle. A surface with nothing to count has none.
 *
 * Section titles are `admin.nav.section.<section>`, surface (tab) titles
 * `admin.nav.surface.<key>`. Client-safe: no `server-only`, nothing here
 * touches the database.
 */

/** The bar's sections, in the order a shift meets them. Overview is the home. */
export const ADMIN_SECTIONS = ["overview", "maintenance", "inventory", "people", "insights", "settings"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const SURFACE_KEYS = [
  // Maintenance
  "maintenance",
  "checklist",
  "schedules",
  // Inventory
  "inventory",
  "intake",
  "qr",
  "labNotes",
  "research",
  "refresh",
  "taxonomy",
  "corrections",
  // People
  "users",
  "projects",
  // Insights
  "insights",
  // Settings
  "settings",
  "mirror",
  "proposals",
  "agents",
] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];

/** The count loaders `loadAdminOverview` runs (see `admin-overview.ts`). */
export const COUNT_LOADERS = [
  "intake",
  "imports",
  "inventory",
  "refresh",
  "manuals",
  "taxonomy",
  "insights",
  "maintenance",
  "corrections",
  "projects",
  "proposals",
  "users",
  "mirror",
] as const;
export type CountLoader = (typeof COUNT_LOADERS)[number];

export interface AdminSurface {
  key: SurfaceKey;
  href: string;
  /** The section of the bar it belongs to. Never `overview`: the home is not a surface. */
  section: Exclude<AdminSection, "overview">;
  /**
   * What the page itself checks; the surface is listed only to holders. A
   * list means any one of them: the MCP page, which holds whatever its viewer
   * proposed, under whichever permission that was.
   */
  permission: Permission | readonly Permission[];
  icon: LucideIcon;
  /** The overview loader behind the surface's numbers, if it has any. */
  count?: CountLoader;
  /**
   * Loaders the overview also reads for this surface, each only for a viewer
   * holding its permission: Add equipment's imported lists waiting for review
   * (`tools.add`), since importing a list is part of adding equipment
   * (amendment 2026-09-25 "Admin polish").
   */
  alsoCounts?: readonly { loader: CountLoader; permission: Permission }[];
}

export const ADMIN_SURFACES: readonly AdminSurface[] = [
  // ── Maintenance ──
  // The ticket queue opens the section: reported problems.
  { key: "maintenance", href: "/admin/maintenance", section: "maintenance", permission: "maintenance.manage", icon: Wrench, count: "maintenance" },
  // The Shift checklist (recurring maintenance spec, amendment 2026-10-07): the
  // recurring tasks due, worked through on shift. Also a block on the overview.
  { key: "checklist", href: "/admin/maintenance/checklist", section: "maintenance", permission: "maintenance.manage", icon: ClipboardCheck },
  // Where the recurring tasks are set up.
  { key: "schedules", href: "/admin/maintenance/schedules", section: "maintenance", permission: "maintenance.manage", icon: CalendarClock },

  // ── Inventory ──
  { key: "inventory", href: "/admin/inventory", section: "inventory", permission: "tools.edit", icon: Boxes, count: "inventory" },
  // One surface for adding equipment: the queue, the imports and "Import a
  // list" are its tabs and its header action, not surfaces of their own.
  {
    key: "intake",
    href: "/admin/intake",
    section: "inventory",
    permission: INTAKE_REVIEW_PERMISSION,
    icon: PackagePlus,
    count: "intake",
    alsoCounts: [{ loader: "imports", permission: "tools.add" }],
  },
  // QR labels stay easy to find (owner, 2026-10-07): a tab of their own, an
  // overview quick action, and a palette entry.
  { key: "qr", href: "/admin/inventory/qr", section: "inventory", permission: "tools.edit", icon: QrCode },
  { key: "labNotes", href: "/admin/inventory/lab-notes", section: "inventory", permission: "tools.edit", icon: NotebookPen },
  { key: "research", href: "/admin/research", section: "inventory", permission: "tools.edit", icon: BookOpenText, count: "manuals" },
  { key: "refresh", href: "/admin/refresh", section: "inventory", permission: "tools.edit", icon: RefreshCw, count: "refresh" },
  // Taxonomy v2 (spec 2026-09-28 §5.3): the category tree and the proposals waiting on it.
  { key: "taxonomy", href: "/admin/taxonomy", section: "inventory", permission: "taxonomy.manage", icon: FolderTree, count: "taxonomy" },
  // A correction is fixed by editing the tool, so it sits with the inventory.
  { key: "corrections", href: "/admin/corrections", section: "inventory", permission: "feedback.manage", icon: Flag, count: "corrections" },

  // ── People ──
  { key: "users", href: "/admin/users", section: "people", permission: "users.manage", icon: Users, count: "users" },
  { key: "projects", href: "/admin/projects", section: "people", permission: "projects.moderate", icon: GalleryVerticalEnd, count: "projects" },

  // ── Insights ──
  // Usage insight (usage insight spec §6): what the lab asks about, what the
  // assistant could not answer, and the value report (its own tab inside).
  { key: "insights", href: "/admin/insights", section: "insights", permission: "insights.view", icon: ChartColumn, count: "insights" },

  // ── Settings ──
  // The settings page itself: the lab screen, the catalogue cache, tokens.
  { key: "settings", href: "/admin/settings", section: "settings", permission: ADMIN_SURFACE_PERMISSIONS, icon: Settings },
  { key: "mirror", href: "/admin/mirror", section: "settings", permission: "mirror.manage", icon: Share2, count: "mirror" },
  // MCP (was "Assistant proposals"; assistant–GUI parity spec §3.8, §6): the
  // viewer's own proposals from MCP clients, and how to connect one. Anybody
  // who reaches /admin may have made one, so it is open to every admin-surface
  // permission.
  { key: "proposals", href: "/admin/proposals", section: "settings", permission: ADMIN_SURFACE_PERMISSIONS, icon: Plug, count: "proposals" },
  // AI agents: the research and intake agents, and the research budget
  // (moved from People; the budget itself is still `users.manage`).
  { key: "agents", href: "/admin/settings/ai-agents", section: "settings", permission: "tools.edit", icon: Bot },
];

/** The admin home, the Overview. Not a surface: everybody who reaches `/admin` has it. */
export const ADMIN_HOME = "/admin";

/** The surfaces `subject` may open, in {@link ADMIN_SURFACES} order. Nobody (anonymous, a student) gets none. */
export function surfacesFor(subject: { role: Role | null | undefined } | null | undefined): AdminSurface[] {
  return ADMIN_SURFACES.filter((surface) => mayOpen(subject, surface));
}

/** Whether `subject` holds `surface`'s permission (any one of a list). */
export function mayOpen(subject: { role: Role | null | undefined } | null | undefined, surface: Pick<AdminSurface, "permission">): boolean {
  const permissions: readonly Permission[] = typeof surface.permission === "string" ? [surface.permission] : surface.permission;
  return permissions.some((permission) => can(subject, permission));
}

/** A surface by key. */
export function surface(key: SurfaceKey): AdminSurface {
  const found = ADMIN_SURFACES.find((entry) => entry.key === key);
  if (!found) throw new Error(`unknown admin surface: ${key}`);
  return found;
}

/** The fields a client island needs to draw a surface's link. */
export interface AdminNavItem {
  key: SurfaceKey;
  href: string;
  section: AdminSurface["section"];
}

/** One section of the bar: where its link goes. */
export interface AdminSectionLink {
  section: AdminSection;
  href: string;
}

/**
 * The bar's sections for a viewer who may open `items`: Overview always, then
 * each section with at least one surface, linked to the first of them. A
 * section with nothing open to the viewer is not offered.
 */
export function sectionsFor(items: readonly Pick<AdminNavItem, "href" | "section">[]): AdminSectionLink[] {
  return ADMIN_SECTIONS.flatMap((section): AdminSectionLink[] => {
    if (section === "overview") return [{ section, href: ADMIN_HOME }];
    const first = items.find((item) => item.section === section);
    return first ? [{ section, href: first.href }] : [];
  });
}

/**
 * The section `pathname` is in: the section of the most specific surface the
 * path is on, `overview` on the home itself, null anywhere else.
 */
export function currentSection(pathname: string, items: readonly Pick<AdminNavItem, "href" | "section">[]): AdminSection | null {
  const href = currentHref(pathname, [ADMIN_HOME, ...items.map((item) => item.href)]);
  if (href === ADMIN_HOME) return "overview";
  return items.find((item) => item.href === href)?.section ?? null;
}

/**
 * The count loaders the overview reads for `subject`: each open surface's own,
 * and the extra ones it carries that `subject` holds the permission for.
 */
export function countLoadersFor(subject: { role: Role | null | undefined } | null | undefined): CountLoader[] {
  return surfacesFor(subject).flatMap((entry) => [
    ...(entry.count ? [entry.count] : []),
    ...(entry.alsoCounts ?? []).filter((extra) => can(subject, extra.permission)).map((extra) => extra.loader),
  ]);
}

/**
 * The href in `hrefs` that `pathname` is on: the longest one that is the path
 * or a prefix of it, so an item's page marks its surface. `/admin` itself only
 * on the home.
 */
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const match = hrefs
    .filter((href) => href !== ADMIN_HOME && (path === href || path.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return match;
  return path === ADMIN_HOME && hrefs.includes(ADMIN_HOME) ? ADMIN_HOME : null;
}
