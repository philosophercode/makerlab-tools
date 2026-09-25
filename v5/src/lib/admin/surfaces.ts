import type { Permission } from "../auth/permissions";

/**
 * Every admin surface, grouped by the job it serves (UI system spec §7, the
 * admin information architecture). One list feeds both the `/admin` home's
 * tiles and the admin navigation, so a page added without an entry here is
 * unreachable from both — and a page added *with* one appears in both.
 *
 * Each permission is checked with the same `can()` the page itself calls;
 * a surface is shown only to someone it will open for.
 *
 * `key` names the existing `admin.<key>Title` / `admin.<key>Lede` messages.
 */
export type AdminGroup = "addEquipment" | "dataQuality" | "queues" | "settings";

export interface AdminSurface {
  key: string;
  href: string;
  permission: Permission;
  group: AdminGroup;
}

export const ADMIN_GROUPS: readonly AdminGroup[] = ["addEquipment", "dataQuality", "queues", "settings"];

export const ADMIN_SURFACES: readonly AdminSurface[] = [
  { key: "intake", href: "/admin/intake", permission: "tools.approve", group: "addEquipment" },
  { key: "import", href: "/admin/intake/imports/new", permission: "tools.approve", group: "addEquipment" },
  { key: "inventory", href: "/admin/inventory", permission: "tools.edit", group: "dataQuality" },
  { key: "refresh", href: "/admin/refresh", permission: "tools.edit", group: "dataQuality" },
  { key: "research", href: "/admin/research", permission: "tools.edit", group: "dataQuality" },
  { key: "maintenance", href: "/admin/maintenance", permission: "maintenance.manage", group: "queues" },
  { key: "corrections", href: "/admin/corrections", permission: "feedback.manage", group: "queues" },
  { key: "projects", href: "/admin/projects", permission: "projects.moderate", group: "queues" },
  { key: "users", href: "/admin/users", permission: "users.manage", group: "settings" },
  { key: "mirror", href: "/admin/mirror", permission: "mirror.manage", group: "settings" },
];
