import { getTranslations } from "next-intl/server";
import { AdminActions } from "../../components/admin/AdminActions";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { DueTasks } from "../../components/admin/DueTasks";
import { openIssues } from "../../components/admin/checklist-issues";
import { RowStatus } from "../../components/admin/RowStatus";
import { NeedToKnowList, OverviewBlock, OverviewRowList } from "../../components/admin/overview/OverviewBlocks";
import { healthRows, needToKnow, needToKnowCount, waitingRows, waitingTotal } from "../../components/admin/overview/overview-model";
import { OnShiftPanel } from "../../components/on-shift/OnShiftPanel";
import { EmptyState } from "../../components/system/EmptyState";
import { countLoadersFor, surfacesFor } from "../../lib/admin/surfaces";
import { can } from "../../lib/auth/permissions";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { isLegacyMcpTokenSet } from "../../lib/auth/mcp-caller";
import { adminBackupNotice } from "../../lib/cron/backup-freshness";
import { loadAdminOverview } from "../../lib/data/admin-overview";
import { listMaintenanceQueue } from "../../lib/data/maintenance";
import { countDueSchedules, listDueSchedules } from "../../lib/data/maintenance-schedules";
import { listUnitsDown } from "../../lib/data/units-down";
import { dataSubstrate } from "../../lib/db/client";
import { labToday } from "../../lib/lab-time";
import { updateTicket } from "./maintenance/actions";
import { MAINTENANCE_PATH } from "./maintenance/action-result";
import { completeSchedule } from "./maintenance/schedule-actions";
import { CHECKLIST_PATH, SCHEDULES_PATH } from "./maintenance/schedule-result";

/**
 * `/admin` — the **Overview** (admin sections spec 2026-10-07; was the tiles
 * home, and "Today" in the design review). It answers "what needs me now"
 * before anything is opened, in the order a shift meets it:
 *
 * - **Need to know**: urgent tickets (high or critical, open or in progress,
 *   nobody on it first, with **Take it**), overdue recurring tasks, and open
 *   tickets that name no machine (`maintenance.manage`).
 * - **Shift checklist**: the recurring tasks due, with Done, a note, and Mark
 *   resolved on an open issue of the same machine (`maintenance.manage`; also
 *   its own tab, `/admin/maintenance/checklist`).
 * - Beside them: **Quick actions** (Print QR labels first), **Waiting for a
 *   decision** (each count from the surface's loader, only the viewer's
 *   surfaces) and **Inventory health** (units down, then the catalogue's gaps).
 *
 * **Honest, as before.** Every number is read for the viewer's own surfaces
 * (`countLoadersFor`, the same `can()` the pages call), and a read that failed
 * is said ("Could not be read"), never shown as zero or as nothing waiting
 * (Article 4). Waiting counts live here and never in the section bar (owner
 * decision 2026-09-25).
 *
 * What a viewer sees follows their permissions, block by block: Need to know
 * and the checklist need `maintenance.manage`, Inventory health `tools.edit`,
 * each Waiting row and quick action its own page's permission.
 */

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const open = surfacesFor(identity);
  const maintains = can(identity, "maintenance.manage");
  const edits = can(identity, "tools.edit");
  const today = labToday();

  // Together, not one after the other: the backup notice is a Blob list on a
  // cold instance (performance plan, quick win 14).
  const [overview, backupNotice, tickets, dueItems, unitsDown] = await Promise.all([
    loadAdminOverview(countLoadersFor(identity), { userId: identity.userId }),
    adminBackupNotice({
      canManageUsers: can(identity, "users.manage"),
      substrate: dataSubstrate(),
    }),
    maintains ? settle("tickets", () => listMaintenanceQueue()) : Promise.resolve(null),
    maintains
      ? settle("due tasks", async () => {
          const [items, counts] = await Promise.all([listDueSchedules(today), countDueSchedules(today)]);
          return { items, active: counts.active };
        })
      : Promise.resolve(null),
    edits ? settle("units down", () => listUnitsDown()) : Promise.resolve(null),
  ]);

  const maintenanceCounts = overview.maintenance;
  const need = needToKnow(tickets, maintenanceCounts ? maintenanceCounts.tasksOverdue : null);
  const waiting = waitingRows(overview, t);
  const health = edits ? healthRows(unitsDown, overview.inventory, t) : [];
  const needCount = needToKnowCount(need);
  const checksDue = maintenanceCounts ? maintenanceCounts.tasksDueToday + maintenanceCounts.tasksOverdue : 0;
  const me = identity.userId ? { id: identity.userId, name: identity.name || identity.email || "" } : null;

  return (
    <div className="ui flex flex-col gap-6">
      <AdminPageHeader
        title={t("overview.title")}
        lede={t("overview.lede")}
        facts={[
          maintains && t("overview.factsNeed", { count: needCount }),
          maintains && maintenanceCounts && t("overview.factsChecks", { count: checksDue }),
          t("overview.factsWaiting", { count: waitingTotal(waiting) }),
        ]}
      />

      {/* MCP access spec §5.3: the retired shared secret still works for one
          release, as the public read-only tools only — and says so here. */}
      {isLegacyMcpTokenSet() ? <RowStatus tone="warn">{t("mcpTokenDeprecated")}</RowStatus> : null}

      {/* Ops spec amendment 2026-09-27: a nightly backup that stopped landing
          shows here, not only in Vercel's cron log. */}
      {backupNotice ? <RowStatus tone="warn">{t(backupNotice.key, { date: backupNotice.date })}</RowStatus> : null}

      {open.length === 0 ? <EmptyState>{t("indexNothingYet")}</EmptyState> : null}

      {/* Who's on shift (on-shift spec 2026-10-07): staff mark themselves
          here, first thing, so students can see who to ask. */}
      {can(identity, "shifts.set") ? (
        <section
          id="on-shift"
          aria-labelledby="on-shift-heading"
          className="flex flex-col gap-3 border border-border bg-card p-4 sm:grid sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] sm:gap-6"
        >
          <div className="flex flex-col gap-1">
            <h2 id="on-shift-heading" className="font-heading text-base font-medium uppercase">
              {t("onShift.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("onShift.lede")}</p>
          </div>
          <OnShiftPanel identity={identity} nameHref="/account" />
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          {maintains ? (
            <OverviewBlock
              id="need-to-know"
              title={t("overview.needHeading")}
              link={{
                href: MAINTENANCE_PATH,
                label: maintenanceCounts
                  ? t("overview.maintenanceLink", { count: maintenanceCounts.open + maintenanceCounts.inProgress })
                  : t("nav.surface.maintenance"),
              }}
            >
              <NeedToKnowList need={need} me={me} takeTicket={updateTicket} checklistHref={CHECKLIST_PATH} maintenanceHref={MAINTENANCE_PATH} />
            </OverviewBlock>
          ) : null}

          {maintains ? (
            dueItems === null ? (
              <OverviewBlock id="shift-checklist" title={t("schedules.due.heading")}>
                <EmptyState tone="bad">{t("overview.checklistUnreadable")}</EmptyState>
              </OverviewBlock>
            ) : (
              <DueTasks
                items={dueItems.items}
                today={today}
                hasSchedules={dueItems.active > 0}
                action={completeSchedule}
                schedulesHref={SCHEDULES_PATH}
                issues={tickets ? openIssues(tickets) : undefined}
                resolveIssue={updateTicket}
              />
            )
          ) : null}
        </div>

        <aside aria-label={t("overview.sideLabel")} className="flex min-w-0 flex-col gap-4">
          <OverviewBlock id="quick-actions" title={t("overview.quickHeading")} plate>
            <AdminActions role={identity.role} />
          </OverviewBlock>

          <OverviewBlock id="waiting" title={t("overview.waitingHeading")} plate>
            <OverviewRowList rows={waiting} label={t("overview.waitingHeading")} empty={t("overview.waitingNothing")} />
          </OverviewBlock>

          {edits ? (
            <OverviewBlock id="inventory-health" title={t("overview.healthHeading")} plate>
              <OverviewRowList rows={health} label={t("overview.healthHeading")} empty={t("overview.healthNothing")} />
            </OverviewBlock>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** One read that may fail on its own: logged, and null, so the rest of the overview still answers. */
async function settle<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    console.error(`[admin/overview] could not read the ${what}`, err);
    return null;
  }
}
