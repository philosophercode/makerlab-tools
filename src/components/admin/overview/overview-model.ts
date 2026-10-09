import type { AdminOverview } from "../../../lib/data/admin-overview";
import type { MaintenanceQueueEntry } from "../../../lib/data/maintenance";
import type { UnitDown } from "../../../lib/data/units-down";
import type { StatusTone } from "../../system/StatusGlyph";

/**
 * What the `/admin` overview says (admin sections spec 2026-10-07; the review's
 * "Today" mock-up, renamed Overview by the owner): the rows of **Need to
 * know**, **Waiting for a decision** and **Inventory health**, built from the
 * reads the page already made. Pure and directive-free, so the rules are
 * tested without a request.
 *
 * A read that failed is said as such, never as nothing (Article 4): a `null`
 * input gives an `unreadable` row in place of the rows it would have given.
 */

/** How many urgent tickets Need to know lists before "and N more". */
export const NEED_TO_KNOW_TICKETS = 6;

export interface UrgentTicket {
  id: string;
  title: string;
  where: string;
  priority: "high" | "critical";
  status: string;
  assignedToName: string;
  assigned: boolean;
  dateReported: string;
}

export interface NeedToKnow {
  /** Open or in progress at high or critical priority, unassigned first, critical first. Null when unreadable. */
  urgent: UrgentTicket[] | null;
  /** Urgent tickets beyond {@link NEED_TO_KNOW_TICKETS}. */
  moreUrgent: number;
  /** Open tickets that name no machine and no unit. */
  unlinked: number;
  /** Recurring tasks overdue (null when unreadable or not the viewer's). */
  overdueTasks: number | null;
}

const OPEN = new Set(["open", "in_progress"]);

/**
 * Need to know, from the ticket queue (null: unreadable) and the overdue task
 * count. A demo pass's tickets are not the lab's work (demo pass spec
 * 2026-10-07 §5.4): they stay in the queue, badged, and out of this list.
 */
export function needToKnow(tickets: readonly MaintenanceQueueEntry[] | null, overdueTasks: number | null): NeedToKnow {
  if (!tickets) return { urgent: null, moreUrgent: 0, unlinked: 0, overdueTasks };
  const open = tickets.filter((ticket) => OPEN.has(ticket.status) && !ticket.demo);
  const urgent = open
    .filter((ticket) => ticket.priority === "high" || ticket.priority === "critical")
    .map<UrgentTicket>((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      // A unit named like its tool is said once.
      where: [...new Set([ticket.toolName, ticket.unitLabel].filter(Boolean))].join(" · "),
      priority: ticket.priority as UrgentTicket["priority"],
      status: ticket.status,
      assignedToName: ticket.assignedToName,
      assigned: Boolean(ticket.assignedToUserId || ticket.assignedToName),
      dateReported: ticket.dateReported,
    }))
    // Nobody on it first, then critical before high; the queue's own order breaks ties.
    .map((ticket, index) => ({ ticket, index }))
    .sort(
      (a, b) =>
        Number(a.ticket.assigned) - Number(b.ticket.assigned) ||
        Number(b.ticket.priority === "critical") - Number(a.ticket.priority === "critical") ||
        a.index - b.index
    )
    .map(({ ticket }) => ticket);
  return {
    urgent: urgent.slice(0, NEED_TO_KNOW_TICKETS),
    moreUrgent: Math.max(0, urgent.length - NEED_TO_KNOW_TICKETS),
    unlinked: open.filter((ticket) => !ticket.toolId && !ticket.unitId && !ticket.toolName).length,
    overdueTasks,
  };
}

/** How many things Need to know asks someone to look at. */
export function needToKnowCount(need: NeedToKnow): number {
  return (need.urgent?.length ?? 0) + need.moreUrgent + (need.unlinked > 0 ? 1 : 0) + (need.overdueTasks ? 1 : 0);
}

/** A row of Waiting for a decision or Inventory health. */
export interface OverviewRow {
  key: string;
  label: string;
  /** Null: the count could not be read. */
  value: number | null;
  href: string;
  tone: StatusTone;
  /** A second line: what the number is made of. */
  detail?: string;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Waiting for a decision: everything that waits on a person's yes or no,
 * from the overview loaders the viewer may read. Rows with nothing waiting are
 * left out; a loader that failed stays, as "could not be read".
 */
export function waitingRows(overview: AdminOverview, t: Translate): OverviewRow[] {
  const rows: OverviewRow[] = [];
  const add = (key: string, label: string, value: number | null | undefined, href: string) => {
    if (value === undefined) return;
    if (value === 0) return;
    rows.push({ key, label, value, href, tone: "active" });
  };
  const has = <K extends keyof AdminOverview>(key: K) => key in overview;
  if (has("intake")) add("intake", t("overview.waitingIntake"), overview.intake ? overview.intake.researched : null, "/admin/intake");
  if (has("imports")) add("imports", t("overview.waitingImports"), overview.imports ? overview.imports.ready : null, "/admin/intake/imports");
  if (has("refresh")) add("refresh", t("overview.waitingRefresh"), overview.refresh ? overview.refresh.proposed : null, "/admin/refresh");
  if (has("taxonomy")) add("taxonomy", t("overview.waitingTaxonomy"), overview.taxonomy ? overview.taxonomy.pending : null, "/admin/taxonomy");
  if (has("corrections")) add("corrections", t("overview.waitingCorrections"), overview.corrections ? overview.corrections.open : null, "/admin/corrections");
  if (has("projects")) add("projects", t("overview.waitingProjects"), overview.projects ? overview.projects.waiting : null, "/admin/projects");
  if (has("proposals")) add("proposals", t("overview.waitingProposals"), overview.proposals ? overview.proposals.open : null, "/admin/proposals");
  if (has("insights")) add("insights", t("overview.waitingInsights"), overview.insights ? overview.insights.openGaps : null, "/admin/insights");
  return rows;
}

/** The sum of the readable waiting counts. */
export function waitingTotal(rows: readonly OverviewRow[]): number {
  return rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
}

/**
 * Inventory health: machines that cannot be used, and the catalogue's gaps.
 * Units are listed by name under their count; zero rows stay, muted, so the
 * block always says the same four things.
 */
export function healthRows(units: readonly UnitDown[] | null, inventory: AdminOverview["inventory"], t: Translate): OverviewRow[] {
  const rows: OverviewRow[] = [];
  const names = (list: readonly UnitDown[]) => {
    const shown = list.slice(0, 4).map((unit) => `${unit.toolName} ${unit.unitLabel}`.trim());
    return list.length > 4 ? t("overview.andMore", { names: shown.join(" · "), count: list.length - 4 }) : shown.join(" · ");
  };
  if (units === null) {
    rows.push({ key: "unitsDown", label: t("overview.healthOutOfService"), value: null, href: "/admin/inventory", tone: "bad" });
  } else {
    const out = units.filter((unit) => unit.status === "out_of_service");
    const fixing = units.filter((unit) => unit.status === "under_maintenance");
    rows.push({
      key: "outOfService",
      label: t("overview.healthOutOfService"),
      value: out.length,
      href: "/admin/inventory",
      tone: out.length > 0 ? "bad" : "muted",
      detail: out.length > 0 ? names(out) : undefined,
    });
    rows.push({
      key: "underMaintenance",
      label: t("overview.healthUnderMaintenance"),
      value: fixing.length,
      href: "/admin/inventory",
      tone: fixing.length > 0 ? "warn" : "muted",
      detail: fixing.length > 0 ? names(fixing) : undefined,
    });
  }
  if (inventory !== undefined) {
    const stock = (key: string, label: string, value: number | null, href: string) =>
      rows.push({ key, label, value, href, tone: value === null ? "bad" : value > 0 ? "warn" : "muted" });
    stock("neverReviewed", t("overview.healthNeverReviewed"), inventory ? inventory.neverReviewed : null, "/admin/inventory?attention=never_reviewed");
    stock("noPhoto", t("overview.healthNoPhoto"), inventory ? inventory.noPhoto : null, "/admin/inventory?attention=no_photo");
    stock("noManual", t("overview.healthNoManual"), inventory ? inventory.noManual : null, "/admin/inventory?attention=no_manual");
  }
  return rows;
}
