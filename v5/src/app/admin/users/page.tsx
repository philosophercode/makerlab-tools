import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { UsersTable } from "../../../components/admin/UsersTable";
import { parseUserFilters } from "../../../components/admin/users-filters";
import type { SearchParams } from "../../../components/admin/inventory-filters";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listUsers } from "../../../lib/data/users";
import { siteConfig } from "../../../lib/site-config";
import { setUserBanned, setUserRole } from "./actions";
import { AllowanceGrant } from "../../../components/admin/AllowanceGrant";
import { listActiveAllowances } from "../../../lib/data/research-allowances";
import { grantSetupAllowance } from "./allowance-actions";
import type { AllowanceCandidate } from "./allowance-result";

/**
 * `/admin/users` — who is who, and how to change it (spec §5.2, §6).
 *
 * Super admin only: `users.manage` belongs to that role alone (§8). The layout
 * above let a SuperMaker in — they hold other admin permissions — so the
 * refusal for them happens here, and it says so rather than 404ing.
 *
 * Nothing on this page is cached. The roster is read per request, because the
 * point of the whole phase is that a role change is visible immediately; a
 * cached roster would show the change to everyone except the person who made
 * it. The actions call `revalidatePath` for the same reason.
 *
 * The two server actions are imported here and handed to the table, which
 * hands them to its client islands. That is what keeps `RoleSelect` free of
 * `next/headers` and the rate limiter — see its own note.
 */

export const metadata = {
  title: `People — ${siteConfig.name}`,
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "users.manage")) return <AdminNotice kind="forbidden" />;

  const users = await listUsers();
  // Setup allowances (bulk intake spec §4.2): who may research, and what they hold now.
  const researchers = users.filter((person) => !person.banned && can({ role: person.role }, "tools.add"));
  const grants = await listActiveAllowances(researchers.map((person) => person.id));
  const candidates: AllowanceCandidate[] = researchers.map((person) => {
    const own = grants.filter((grant) => grant.userId === person.id);
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      activeExtra: own.reduce((sum, grant) => sum + grant.extraItems, 0),
      activeUntil: own.length > 0 ? new Date(Math.max(...own.map((grant) => grant.expiresAt.getTime()))).toISOString() : null,
    };
  });

  const admins = users.filter((person) => person.role === "admin" || person.role === "super_admin").length;
  const banned = users.filter((person) => person.banned).length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="users"
        title={t("usersTitle")}
        lede={t("usersLede")}
        facts={[
          t("facts.people", { count: users.length }),
          t("facts.admins", { count: admins }),
          t("facts.banned", { count: banned }),
        ]}
      />

      <UsersTable
        users={users}
        currentUserId={identity.userId}
        initial={parseUserFilters(await searchParams)}
        setRole={setUserRole}
        setBanned={setUserBanned}
      />

      <AllowanceGrant candidates={candidates} grant={grantSetupAllowance} />
    </section>
  );
}
