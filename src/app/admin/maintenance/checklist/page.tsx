import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { DueTasks } from "../../../../components/admin/DueTasks";
import { openIssues, type ChecklistIssue } from "../../../../components/admin/checklist-issues";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listMaintenanceQueue } from "../../../../lib/data/maintenance";
import { countDueSchedules, listDueSchedules } from "../../../../lib/data/maintenance-schedules";
import { labToday } from "../../../../lib/lab-time";
import { updateTicket } from "../actions";
import { completeSchedule } from "../schedule-actions";
import { SCHEDULES_PATH } from "../schedule-result";

/**
 * `/admin/maintenance/checklist` — the **Shift checklist** (admin sections
 * spec 2026-10-07; recurring maintenance spec, amendment 2026-10-07): the
 * recurring tasks a SuperMaker works through on shift, overdue first, then
 * due today, then the next 7 days. Each has **Done** (with an optional note)
 * and, when the same machine has an open ticket, **Mark resolved** on it.
 *
 * The overview shows the same list under Need to know; this tab is the
 * Maintenance section's home for it. Requires `maintenance.manage`, like the
 * queue, and says so when refused. Nothing is cached: it is what is due now.
 * The actions travel down as props and each checks its permission itself.
 */

export const metadata = {
  title: "Shift checklist",
};

export default async function AdminChecklistPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "maintenance.manage")) return <AdminNotice kind="forbidden" />;

  const today = labToday();
  const [items, counts, issues] = await Promise.all([listDueSchedules(today), countDueSchedules(today), loadIssues()]);

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="checklist"
        title={t("schedules.due.heading")}
        lede={t("schedules.due.lede")}
        facts={[
          t("facts.tasksOverdue", { count: counts.overdue }),
          t("facts.tasksDueToday", { count: counts.dueToday }),
          t("facts.tasksSoon", { count: counts.soon }),
        ]}
      />
      <DueTasks
        items={items}
        today={today}
        hasSchedules={counts.active > 0}
        action={completeSchedule}
        schedulesHref={SCHEDULES_PATH}
        issues={issues ?? undefined}
        resolveIssue={updateTicket}
        heading={false}
      />
    </section>
  );
}

/**
 * The open tickets, for the issues on each task's machine. A read that fails
 * only costs the issues (logged); the checklist itself still answers.
 */
async function loadIssues(): Promise<ChecklistIssue[] | null> {
  try {
    return openIssues(await listMaintenanceQueue());
  } catch (err) {
    console.error("[admin/maintenance/checklist] could not read the open tickets", err);
    return null;
  }
}
