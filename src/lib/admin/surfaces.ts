import {
  BookOpenText,
  Boxes,
  Flag,
  GalleryVerticalEnd,
  PackagePlus,
  RefreshCw,
  Share2,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { can, type Permission } from "../auth/permissions";
import type { Role } from "../auth/roles";
import { INTAKE_REVIEW_PERMISSION } from "../intake/access";

/**
 * Every admin surface, once (UI system spec §5.2, §8.1). This one list feeds
 * the `/admin` home's tiles, the section bar on every admin page and the ⌘K
 * palette, so a page added here appears in all three — and a page left out is
 * reachable from none of them, which a test catches.
 *
 * **Each entry carries its own permission**, the same one its page checks with
 * `can()`, and every list shown to a person is {@link surfacesFor} that
 * person: nobody is offered a surface that would refuse them. Showing is
 * presentation; the page's own check is the control.
 *
 * `count` names the loader in `lib/data/admin-overview.ts` whose numbers the
 * surface's tile shows. It is a name rather than a function so this module
 * stays client-safe (the palette imports it) and the database stays out of
 * the browser bundle.
 *
 * Titles are `admin.nav.surface.<key>`, groups `admin.nav.group.<group>`.
 * Client-safe: no `server-only`, nothing here touches the database.
 */

/** The jobs, in the order equipment moves through the lab. */
export const ADMIN_GROUPS = ["addEquipment", "keepFresh", "queues", "settings"] as const;
export type AdminGroup = (typeof ADMIN_GROUPS)[number];

export const SURFACE_KEYS = [
  "intake",
  "inventory",
  "refresh",
  "research",
  "maintenance",
  "corrections",
  "projects",
  "users",
  "mirror",
] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];

/** The count loaders `loadAdminOverview` runs, one per tile (see `admin-overview.ts`). */
export const COUNT_LOADERS = [
  "intake",
  "imports",
  "inventory",
  "refresh",
  "manuals",
  "maintenance",
  "corrections",
  "projects",
  "users",
  "mirror",
] as const;
export type CountLoader = (typeof COUNT_LOADERS)[number];

export interface AdminSurface {
  key: SurfaceKey;
  href: string;
  group: AdminGroup;
  /** What the page itself checks; the surface is listed only to holders. */
  permission: Permission;
  icon: LucideIcon;
  /** The overview loader behind the surface's tile. */
  count: CountLoader;
  /**
   * Loaders whose numbers the tile also carries, each read only for a viewer
   * holding its permission — Intake's tile says how many imported lists wait
   * for review (`tools.add`), since importing a list is part of Intake
   * (amendment 2026-09-25 "Admin polish").
   */
  alsoCounts?: readonly { loader: CountLoader; permission: Permission }[];
}

export const ADMIN_SURFACES: readonly AdminSurface[] = [
  // One surface for adding equipment: the queue, the imports and "Import a
  // list" are Intake's tabs and its header action, not surfaces of their own.
  {
    key: "intake",
    href: "/admin/intake",
    group: "addEquipment",
    permission: INTAKE_REVIEW_PERMISSION,
    icon: PackagePlus,
    count: "intake",
    alsoCounts: [{ loader: "imports", permission: "tools.add" }],
  },
  { key: "inventory", href: "/admin/inventory", group: "keepFresh", permission: "tools.edit", icon: Boxes, count: "inventory" },
  { key: "refresh", href: "/admin/refresh", group: "keepFresh", permission: "tools.edit", icon: RefreshCw, count: "refresh" },
  { key: "research", href: "/admin/research", group: "keepFresh", permission: "tools.edit", icon: BookOpenText, count: "manuals" },
  { key: "maintenance", href: "/admin/maintenance", group: "queues", permission: "maintenance.manage", icon: Wrench, count: "maintenance" },
  { key: "corrections", href: "/admin/corrections", group: "queues", permission: "feedback.manage", icon: Flag, count: "corrections" },
  { key: "projects", href: "/admin/projects", group: "queues", permission: "projects.moderate", icon: GalleryVerticalEnd, count: "projects" },
  { key: "users", href: "/admin/users", group: "settings", permission: "users.manage", icon: Users, count: "users" },
  { key: "mirror", href: "/admin/mirror", group: "settings", permission: "mirror.manage", icon: Share2, count: "mirror" },
];

/** The admin home. Not a surface: everybody who reaches `/admin` has it. */
export const ADMIN_HOME = "/admin";

/** The surfaces `subject` may open, in {@link ADMIN_SURFACES} order. Nobody (anonymous, a student) gets none. */
export function surfacesFor(subject: { role: Role | null | undefined } | null | undefined): AdminSurface[] {
  return ADMIN_SURFACES.filter((surface) => can(subject, surface.permission));
}

/** A surface by key. */
export function surface(key: SurfaceKey): AdminSurface {
  const found = ADMIN_SURFACES.find((entry) => entry.key === key);
  if (!found) throw new Error(`unknown admin surface: ${key}`);
  return found;
}

/**
 * The count loaders `subject`'s tiles read: each surface's own, and the extra
 * ones it carries that `subject` holds the permission for.
 */
export function countLoadersFor(subject: { role: Role | null | undefined } | null | undefined): CountLoader[] {
  return surfacesFor(subject).flatMap((entry) => [
    entry.count,
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
