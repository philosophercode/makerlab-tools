import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { countDemoSignups } from "../../../lib/data/demo-signups";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { BlockedEmailsList } from "../../../components/admin/BlockedEmailsList";
import { UsersTable } from "../../../components/admin/UsersTable";
import { parseUserFilters } from "../../../components/admin/users-filters";
import type { SearchParams } from "../../../components/admin/inventory-filters";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { canView } from "../../../lib/auth/permissions";
import { listBlockedEmails } from "../../../lib/data/blocked-emails";
import { listUsers } from "../../../lib/data/users";
import { isDemoAdmin } from "../../../lib/demo-admin/config";
import { emailFor } from "../../../lib/demo-admin/mask-email";
import { samplePeople } from "../../../lib/demo-admin/sample-people";
import { RowStatus } from "../../../components/admin/RowStatus";
import { addPerson, removeUser, setUserName, setUserRole, setUserTitle, unblockBlockedEmail } from "./actions";
import { AddPersonForm } from "../../../components/admin/AddPersonForm";

/**
 * `/admin/users` — who is who, and how to change it (spec §5.2, §6), and
 * since the auth spec amendment of 2026-09-25 who has been removed for good:
 * **Remove** on each row, and the **Blocked emails** list below the roster.
 * **Add person** puts somebody on the roster before their first sign-in.
 *
 * The People section's **Roster** tab (admin sections spec 2026-10-07). The
 * research budget (setup allowances) that used to close this page moved to
 * Settings › AI agents (`/admin/settings/ai-agents`).
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
 * The server actions are imported here and handed to the table, which hands
 * them to its client islands. That is what keeps `RoleSelect` free of
 * `next/headers` and the rate limiter — see its own note.
 */

export const metadata = {
  title: "People",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!canView(identity, "users.manage")) return <AdminNotice kind="forbidden" />;

  // The demo identity (demo admin spec 2026-10-11 §6, §7) sees the roster
  // read-only, every address masked, with twenty sample people appended —
  // made up here, never stored. Nobody else ever gets them.
  const demo = isDemoAdmin(identity);
  const [stored, blocked, demoSignups] = await Promise.all([listUsers(), listBlockedEmails(), demo ? Promise.resolve(0) : countDemoSignups()]);
  const users = demo ? [...stored, ...samplePeople()] : stored;

  const admins = users.filter((person) => person.role === "admin" || person.role === "super_admin").length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="users"
        title={t("usersTitle")}
        lede={t("usersLede")}
        facts={[
          t("facts.people", { count: users.length }),
          t("facts.admins", { count: admins }),
          t("facts.blocked", { count: blocked.length }),
        ]}
        // Visitors who signed up for a demo pass (demo pass spec 2026-10-07 §5.6).
        // Not for the demo identity: the sign-ups are real visitors' contact
        // details, and that page refuses it (`can`, not `canView`).
        actions={
          demo ? undefined : (
            <Button asChild size="sm">
              <Link href="/admin/users/demo-signups">{t("demoSignups.link", { count: demoSignups })}</Link>
            </Button>
          )
        }
      />

      {/* Super admins only, like everything on this page (`users.manage`,
          checked above and again inside the action). The demo only looks. */}
      {demo ? (
        <RowStatus tone="muted">{t("users.demoReadOnly")}</RowStatus>
      ) : (
        <AddPersonForm action={addPerson} />
      )}

      <UsersTable
        users={users}
        demo={demo}
        currentUserId={identity.userId}
        initial={parseUserFilters(await searchParams)}
        setRole={setUserRole}
        removeUser={removeUser}
        setTitle={setUserTitle}
        setName={setUserName}
      />

      <BlockedEmailsList
        rows={blocked.map((entry) => ({
          email: emailFor(identity, entry.email),
          reason: entry.reason,
          blockedByName: entry.blockedByName,
          blockedOn: entry.createdAt.toISOString().slice(0, 10),
        }))}
        unblock={unblockBlockedEmail}
      />
    </section>
  );
}
