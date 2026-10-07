import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { LogCompletedForm } from "../../../components/admin/LogCompletedForm";
import { MaintenanceQueue } from "../../../components/admin/MaintenanceQueue";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listMaintenanceQueue } from "../../../lib/data/maintenance";
import { countDueSchedules } from "../../../lib/data/maintenance-schedules";
import { listToolUnitOptions } from "../../../lib/data/tool-options";
import { listAssignableStaff } from "../../../lib/data/users";
import { labToday } from "../../../lib/lab-time";
import { logCompletedMaintenance, updateTicket } from "./actions";

/**
 * `/admin/maintenance` — the Maintenance section's **Tickets** tab (admin
 * sections spec 2026-10-07): the ticket queue (spec §5.6, §6). The recurring
 * tasks due, which opened this page from 2026-10-06, are on the **Shift
 * checklist** tab and the overview; the facts line still counts the overdue
 * and due-today ones.
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
  title: "Maintenance",
};

export default async function AdminMaintenancePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "maintenance.manage")) return <AdminNotice kind="forbidden" />;

  // The roster read is the assignee list, not an authorization input: assigning
  // a ticket grants nobody anything (see `listAssignableStaff`).
  const today = labToday();
  const [tickets, staff, toolOptions, taskCounts] = await Promise.all([
    listMaintenanceQueue(),
    listAssignableStaff(),
    listToolUnitOptions(),
    // Recurring tasks overdue or due today, for the facts line (the list is the Shift checklist's).
    countDueSchedules(today),
  ]);

  const open = tickets.filter((ticket) => ticket.status === "open").length;
  const inProgress = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const urgent = tickets.filter(
    (ticket) => (ticket.status === "open" || ticket.status === "in_progress") && (ticket.priority === "high" || ticket.priority === "critical")
  ).length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="maintenance"
        title={t("maintenanceTitle")}
        lede={t("maintenanceLede")}
        facts={[
          t("facts.open", { count: open }),
          t("facts.inProgress", { count: inProgress }),
          t("facts.urgent", { count: urgent }),
          t("facts.tickets", { count: tickets.length }),
          taskCounts.overdue > 0 && t("facts.tasksOverdue", { count: taskCounts.overdue }),
          taskCounts.dueToday > 0 && t("facts.tasksDueToday", { count: taskCounts.dueToday }),
        ]}
      />

      {/* Work already done, recorded as a resolved ticket (parity spec §11 answer 5). */}
      <LogCompletedForm tools={toolOptions} action={logCompletedMaintenance} />

      <MaintenanceQueue
        tickets={tickets}
        staff={staff.map((person) => ({ id: person.id, name: person.name }))}
        action={updateTicket}
      />
    </section>
  );
}
