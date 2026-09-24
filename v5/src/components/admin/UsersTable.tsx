import { useTranslations } from "next-intl";
import { isSuperAdminFloor } from "../../lib/auth/super-admins";
import type { UserRecord } from "../../lib/data/users";
import type { AdminActionError, AdminActionResult } from "../../app/admin/users/action-result";
import { BanToggle } from "./BanToggle";
import { RoleSelect } from "./RoleSelect";

/**
 * The roster on `/admin/users` (spec §5.2, §6).
 *
 * A server component, and deliberately not `async`: everything it needs is
 * already in its props, so it renders synchronously and a component test can
 * mount it with the ordinary i18n wrapper. The two interactive cells are client
 * islands, and the server actions they call travel down as props — see
 * `RoleSelect` for why.
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
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  setBanned: (input: {
    userId: string;
    banned: boolean;
    reason?: string;
  }) => Promise<AdminActionResult>;
}

export function UsersTable({ users, currentUserId, setRole, setBanned }: UsersTableProps) {
  const t = useTranslations("admin");

  if (users.length === 0) {
    // Spec §6: an empty state names what is missing and what would change it.
    // Reaching this means nobody has ever signed in, which on a fresh
    // deployment is the normal first state rather than a fault.
    return <p className="admin-empty td-empty">{t("noUsers")}</p>;
  }

  // Who would still hold `super_admin` if a given row lost it. Banned super
  // admins are not counted: they resolve to anonymous and can undo nothing.
  const activeSuperAdmins = users.filter(
    (person) => person.role === "super_admin" && !person.banned
  ).length;

  return (
    <div className="admin-table-scroll">
      <table className="admin-table" aria-label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("columnPerson")}</th>
            <th scope="col">{t("columnRole")}</th>
            <th scope="col">{t("columnAccess")}</th>
            <th scope="col">{t("columnJoined")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((person) => {
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
            // `users.manage`, so banning somebody else cannot leave the lab
            // without a director. `actions.ts` says the same in one comment.
            const banReason: AdminActionError | null = floor
              ? "protected_floor"
              : isSelf
                ? "self_ban"
                : null;

            return (
              <tr key={person.id} className={person.banned ? "is-banned" : undefined}>
                <th scope="row">
                  <span className="admin-person-name">
                    {person.name}
                    {isSelf ? <span className="admin-tag">{t("you")}</span> : null}
                  </span>
                  {/* The one surface in the app that shows an address: telling
                      two accounts apart is the whole job here (spec §8). */}
                  <span className="admin-person-email">{person.email}</span>
                </th>
                <td>
                  <RoleSelect
                    userId={person.id}
                    personName={person.name}
                    role={person.role}
                    disabledReason={roleReason}
                    action={setRole}
                  />
                </td>
                <td>
                  {person.banned ? (
                    <p className="admin-banned-note">
                      {person.banReason
                        ? t("bannedWithReason", { reason: person.banReason })
                        : t("banned")}
                    </p>
                  ) : null}
                  <BanToggle
                    userId={person.id}
                    personName={person.name}
                    banned={person.banned}
                    disabledReason={banReason}
                    action={setBanned}
                  />
                </td>
                {/* ISO, in the mono treatment the design system gives every
                    other timestamp. Locale-neutral on purpose: a roster read by
                    one admin does not need a localized date, and a formatted
                    one would render differently on the server and the client. */}
                <td className="admin-date">{person.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
