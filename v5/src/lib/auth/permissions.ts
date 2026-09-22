import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import type { Role } from "./roles";

/**
 * What each role may do (data platform design spec §3.5).
 *
 * **The role is a column; the grants are code.** A permissions table is what
 * you build when admins edit permissions at runtime, and the lab decided on
 * 2026-09-14 that they do not. Three roles make most rows below identical, and
 * that is the point: the declaration exists so the *next* change — "SuperMakers
 * may add tools but not publish them" — is one line reviewed in a PR rather
 * than a search through route handlers.
 *
 * The shape is Better Auth's access-control module because the admin plugin
 * expects roles described that way; passing the same `ac` / `roles` to the
 * plugin is what makes `set-role` and `ban-user` answer to this declaration
 * instead of to the library's defaults.
 *
 * **One check, everywhere.** Server actions, route handlers and capability
 * composition call {@link can}. Client components call it too, with the role
 * `/api/identity` reported, to decide whether to render a control — but hiding
 * a control is presentation. The server check is the control.
 *
 * Client-safe on purpose: `better-auth/plugins/access` is pure data, there is
 * no `server-only` import and nothing here touches the database.
 */

/**
 * Every resource and the actions defined on it.
 *
 * `...defaultStatements` brings in the admin plugin's own `user` and `session`
 * resources. They are not decoration: the plugin authorizes `set-role` against
 * `{ user: ["set-role"] }`, so a declaration that omitted them would make every
 * admin endpoint refuse everybody, including a super admin.
 *
 * `users.manage` (plural) is ours — the right to open `/admin/users` at all —
 * and is deliberately distinct from the plugin's singular `user` actions, which
 * are the individual operations that page performs.
 */
export const statement = {
  ...defaultStatements,
  projects: ["submit", "moderate"],
  catalog: ["view_drafts"],
  tools: ["add", "approve", "edit", "publish"],
  maintenance: ["manage"],
  feedback: ["manage"],
  mirror: ["manage"],
  users: ["manage"],
} as const;

export const ac = createAccessControl(statement);

/**
 * The account-management actions an admin surface performs. Impersonation is
 * excluded from every role: v5 never signs in as somebody else, and a
 * capability nobody holds is one nobody can be tricked into using.
 */
const ACCOUNT_MANAGEMENT = {
  user: ["list", "get", "set-role", "ban", "update"],
  session: ["list", "revoke"],
} as const;

/**
 * The grants, least- to most-privileged.
 *
 * - `user` — a student, or anyone signed in with an allowed address. Submitting
 *   a project is the whole of it; browsing and chatting never needed an account.
 * - `admin` — a SuperMaker. Runs the catalogue and the lab's day-to-day
 *   records, but cannot change who is who.
 * - `super_admin` — a director. Everything, including roles and bans.
 */
export const roles = {
  user: ac.newRole({
    projects: ["submit"],
  }),
  admin: ac.newRole({
    projects: ["submit", "moderate"],
    catalog: ["view_drafts"],
    tools: ["add", "approve", "edit", "publish"],
    maintenance: ["manage"],
    feedback: ["manage"],
    mirror: ["manage"],
  }),
  super_admin: ac.newRole({
    projects: ["submit", "moderate"],
    catalog: ["view_drafts"],
    tools: ["add", "approve", "edit", "publish"],
    maintenance: ["manage"],
    feedback: ["manage"],
    mirror: ["manage"],
    users: ["manage"],
    user: [...ACCOUNT_MANAGEMENT.user],
    session: [...ACCOUNT_MANAGEMENT.session],
  }),
} as const;

type Statement = typeof statement;

/**
 * `"tools.approve"`, `"users.manage"` — every resource/action pair in
 * {@link statement}, derived rather than hand-listed so a new action is a
 * compile error at every call site that has to consider it.
 */
export type Permission = {
  [R in keyof Statement & string]: `${R}.${Statement[R][number]}`;
}[keyof Statement & string];

/** Every {@link Permission} as a runtime array — the table tests enumerate. */
export const PERMISSIONS: Permission[] = Object.entries(statement).flatMap(
  ([resource, actions]) =>
    (actions as readonly string[]).map((action) => `${resource}.${action}` as Permission)
);

/** The roles that can actually hold something. `anonymous` is never one. */
export type GrantedRole = keyof typeof roles;

/** True when `role` names a role in the declaration. */
export function isGrantedRole(role: Role | null | undefined): role is GrantedRole {
  return typeof role === "string" && role in roles;
}

/**
 * Does `subject` hold `permission`?
 *
 * Takes the whole subject rather than a bare role so call sites read as
 * `can(identity, "tools.add")` and cannot accidentally pass the wrong string.
 * Null, undefined and `anonymous` all hold nothing — an absent identity is
 * never a pass — and a permission that is not in {@link statement} is false
 * rather than an exception, because a typo in a gate must fail closed.
 */
export function can(
  subject: { role: Role | null | undefined } | null | undefined,
  permission: Permission
): boolean {
  const role = subject?.role;
  if (!isGrantedRole(role)) return false;

  const request = parsePermission(permission);
  if (!request) return false;

  return roles[role].authorize(request as never).success;
}

/**
 * The permissions that make `/admin/*` worth opening at all.
 *
 * One list rather than a check per page, because two things have to agree about
 * it and they live far apart: the `AdminLink` in the header (presentation) and
 * the `/admin` layout (the refusal). A director holds `users.manage`, a
 * SuperMaker holds the catalogue ones — both see the link, and each individual
 * page still gates on the permission it actually needs.
 */
export const ADMIN_SURFACE_PERMISSIONS: Permission[] = [
  "tools.edit",
  "tools.approve",
  "projects.moderate",
  "maintenance.manage",
  "feedback.manage",
  "mirror.manage",
  "users.manage",
];

/** True when `subject` holds any {@link ADMIN_SURFACE_PERMISSIONS}. */
export function canReachAdmin(subject: { role: Role | null | undefined } | null | undefined): boolean {
  return ADMIN_SURFACE_PERMISSIONS.some((permission) => can(subject, permission));
}

/** `"tools.approve"` → `{ tools: ["approve"] }`, or null if it names nothing real. */
function parsePermission(
  permission: string
): Record<string, string[]> | null {
  if (typeof permission !== "string") return null;
  const dot = permission.indexOf(".");
  if (dot <= 0 || dot === permission.length - 1) return null;

  const resource = permission.slice(0, dot);
  const action = permission.slice(dot + 1);

  const actions = (statement as Record<string, readonly string[]>)[resource];
  if (!actions || !actions.includes(action)) return null;

  return { [resource]: [action] };
}
