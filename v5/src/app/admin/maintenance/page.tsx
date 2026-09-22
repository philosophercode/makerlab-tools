import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { MaintenanceQueue } from "../../../components/admin/MaintenanceQueue";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listMaintenanceQueue } from "../../../lib/data/maintenance";
import { listAssignableStaff } from "../../../lib/data/users";
import { siteConfig } from "../../../lib/site-config";
import { updateTicket } from "./actions";

/**
 * `/admin/maintenance` — the ticket queue (spec §5.6, §6).
 *
 * Requires `maintenance.manage`. The layout above answered the coarse question
 * and let anyone holding an admin permission through; the exact refusal happens
 * here and is *said*, the way `/admin/users` and `/admin/inventory` say it. A
 * 404 would claim the page does not exist, which is a lie told to somebody who
 * is signed in.
 *
 * **Nothing here is cached.** A queue is a picture of what is open right now,
 * and the one thing it must not do is show a ticket somebody already closed.
 * The identity read makes this subtree dynamic anyway, and the action calls
 * `revalidatePath` for the same reason.
 *
 * **The action travels down as a prop.** A client island that imported it would
 * drag `next/headers`, the limiter and `server-only` into the browser bundle
 * and stop being testable. Handing it down is not a grant — it checks
 * `maintenance.manage` itself, because it is a POST endpoint reachable without
 * this page (§8).
 */

export const metadata = {
  title: `Maintenance — ${siteConfig.name}`,
};

export default async function AdminMaintenancePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "maintenance.manage")) return <AdminNotice kind="forbidden" />;

  // The roster read is the assignee list, not an authorization input: assigning
  // a ticket grants nobody anything (see `listAssignableStaff`).
  const [tickets, staff] = await Promise.all([listMaintenanceQueue(), listAssignableStaff()]);

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("maintenanceTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments, and a next-intl placeholder with no argument
            renders literally (Article 6 — this has been a real bug here). */}
        <p className="admin-lede">{t("maintenanceLede")}</p>
      </header>

      <MaintenanceQueue
        tickets={tickets}
        staff={staff.map((person) => ({ id: person.id, name: person.name }))}
        action={updateTicket}
      />
    </section>
  );
}
