import { isSuperAdminFloor } from "../../lib/auth/super-admins";
import type { UserRecord } from "../../lib/data/users";
import type { AdminActionError, AdminActionResult, RemoveUserAction } from "../../app/admin/users/action-result";
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
 * **It works out which rows cannot change, and says so.** The same guarantees
 * the server enforces (`actions.ts`): an address on the super-admin floor
 * cannot be demoted or removed, the last super admin standing cannot be either,
 * and nobody removes themselves (auth spec amendment 2026-09-25). The count
 * comes from the list this component was already handed rather than a second
 * query, and the answer is only presentation — the action re-derives all of
 * them before it writes.
 */

export interface UsersTableProps {
  users: UserRecord[];
  /** The viewer, so their own row can be marked and its removal refused. */
  currentUserId: string | null;
  /** The filters the URL arrived with (`parseUserFilters`). */
  initial?: UserFilterState;
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  removeUser: RemoveUserAction;
}

export function UsersTable({ users, currentUserId, initial, setRole, removeUser }: UsersTableProps) {
  // Who would still hold `super_admin` if a given row lost it. Banned super
  // admins — a state only a hand-written UPDATE can make now — are not
  // counted: they resolve to anonymous and can undo nothing.
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
    // Yourself first: it is the reason that applies to the viewer's own row
    // whatever else is true of it.
    const removeReason: AdminActionError | null = isSelf
      ? "self_remove"
      : floor
        ? "protected_floor"
        : lastSuperAdmin
          ? "last_super_admin"
          : null;

    return {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      // ISO, locale-neutral: a formatted date would render differently on the
      // server and the client, and a roster read by one admin does not need it.
      joined: person.createdAt.toISOString().slice(0, 10),
      isSelf,
      roleLockedReason: roleReason,
      removeLockedReason: removeReason,
    };
  });

  return <UsersRoster rows={rows} initial={initial} setRole={setRole} removeUser={removeUser} />;
}
