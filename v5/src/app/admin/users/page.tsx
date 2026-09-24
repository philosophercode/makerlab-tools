import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { UsersTable } from "../../../components/admin/UsersTable";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listUsers } from "../../../lib/data/users";
import { siteConfig } from "../../../lib/site-config";
import { setUserBanned, setUserRole } from "./actions";

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

export default async function AdminUsersPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "users.manage")) return <AdminNotice kind="forbidden" />;

  const users = await listUsers();

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("usersTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments, and a next-intl placeholder with no argument
            renders literally (Article 6 — this has been a real bug here). */}
        <p className="admin-lede">{t("usersLede")}</p>
      </header>

      <UsersTable
        users={users}
        currentUserId={identity.userId}
        setRole={setUserRole}
        setBanned={setUserBanned}
      />
    </section>
  );
}
