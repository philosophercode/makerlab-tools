import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { ScheduleBoard } from "../../../../components/admin/ScheduleBoard";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listSchedules } from "../../../../lib/data/maintenance-schedules";
import { listToolUnitOptions } from "../../../../lib/data/tool-options";
import { labToday } from "../../../../lib/lab-time";
import { dueState } from "../../../../lib/maintenance/interval";
import { completeSchedule, createSchedule, editSchedule, setScheduleStatus } from "../schedule-actions";

/**
 * `/admin/maintenance/schedules` — where the lab's recurring tasks are set up
 * (recurring maintenance spec §6, amendment 2026-10-06). The Maintenance
 * section's **Recurring tasks** tab (admin sections spec 2026-10-07); the
 * tasks due are worked on the Shift checklist tab and the overview.
 *
 * Requires `maintenance.manage`, like the queue, and says so when refused.
 * Nothing is cached: the list is what is due right now. The actions travel
 * down as props and each checks the permission itself.
 */

export const metadata = {
  title: "Recurring tasks",
};

export default async function AdminSchedulesPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "maintenance.manage")) return <AdminNotice kind="forbidden" />;

  const today = labToday();
  const [schedules, toolOptions] = await Promise.all([listSchedules(), listToolUnitOptions()]);
  const active = schedules.filter((schedule) => schedule.status === "active");
  const overdue = active.filter((schedule) => dueState(schedule.nextDueOn, today) === "overdue").length;
  const paused = schedules.filter((schedule) => schedule.status === "paused").length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="schedules"
        title={t("schedules.title")}
        lede={t("schedules.lede")}
        facts={[
          t("facts.tasksActive", { count: active.length }),
          t("facts.tasksOverdue", { count: overdue }),
          paused > 0 && t("facts.tasksPaused", { count: paused }),
        ]}
      />
      <ScheduleBoard
        schedules={schedules}
        tools={toolOptions}
        today={today}
        create={createSchedule}
        edit={editSchedule}
        setStatus={setScheduleStatus}
        complete={completeSchedule}
      />
    </section>
  );
}
