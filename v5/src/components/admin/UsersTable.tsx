import { isSuperAdminFloor } from "../../lib/auth/super-admins";
import type { UserRecord } from "../../lib/data/users";
import type { AdminActionError, AdminActionResult } from "../../app/admin/users/action-result";
import { UsersRoster, type RosterRow } from "./UsersRoster";
import type { UserFilterState } from "./users-filters";

/**
 * The roster on `/admin/users` (spec §5.2, §6).
 *
 * A server component, and deliberately not `async`: everything it needs is
 * already in its props, so it renders synchronously and a component test can
 * mount it with the ordinary i18n wrapper. It works out what each row may do —
 * the floor list is server configuration, so it is read here, never in the
 * browser — and hands plain rows to `UsersRoster`, the client `DataTable`. The
 * server actions travel down as props — see `RoleSelect` for why.
 *
 * **It works out which rows cannot change, and says so.** The same two
 * guarantees the server enforces (`actions.ts`): an address on the super-admin
 * floor, and the last super admin standing. The count comes from the list this
 * component was already handed rather than a second query, and the answer is
 * only presentation — the action re-derives both before it writes.
 */

export interface UsersTableProps {
  users: UserRecord[];
  /** The viewer, so their own row can be marked and their ban refused. */
  currentUserId: string | null;
  /** The filters the URL arrived with (`parseUserFilters`). */
  initial?: UserFilterState;
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  setBanned: (input: {
    userId: string;
    banned: boolean;
    reason?: string;
  }) => Promise<AdminActionResult>;
}

export function UsersTable({ users, currentUserId, initial, setRole, setBanned }: UsersTableProps) {
  // Who would still hold `super_admin` if a given row lost it. Banned super
  // admins are not counted: they resolve to anonymous and can undo nothing.
  const activeSuperAdmins = users.filter(
    (person) => person.role === "super_admin" && !person.banned
  ).length;

  const rows: RosterRow[] = users.map((person) => {
    const floor = isSuperAdminFloor(person.email);
    const lastSuperAdmin =
      person.role === "super_admin" && !person.banned && activeSuperAdmins === 1;
    const isSelf = Boolean(currentUserId) && person.id === currentUserId;

    const roleReason: AdminActionError | null = floor
      ? "protected_floor"
      : lastSuperAdmin
        ? "last_super_admin"
        : null;
    // No "last super admin" here: whoever is reading this page holds
    // `users.manage`, so banning somebody else cannot leave the lab without a
    // director. `actions.ts` says the same in one comment.
    const banReason: AdminActionError | null = floor
      ? "protected_floor"
      : isSelf
        ? "self_ban"
        : null;

    return {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      banned: person.banned,
      banReason: person.banReason,
      // ISO, locale-neutral: a formatted date would render differently on the
      // server and the client, and a roster read by one admin does not need it.
      joined: person.createdAt.toISOString().slice(0, 10),
      isSelf,
      roleLockedReason: roleReason,
      banLockedReason: banReason,
    };
  });

  return <UsersRoster rows={rows} initial={initial} setRole={setRole} setBanned={setBanned} />;
}
