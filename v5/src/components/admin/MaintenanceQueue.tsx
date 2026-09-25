"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MaintenanceQueueEntry } from "../../lib/data/maintenance";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../../lib/db/schema/vocabulary";
import type { UpdateTicketAction } from "../../app/admin/maintenance/action-result";
import { QueueList } from "../system/queue/QueueList";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { ReviewCard } from "../system/review/ReviewCard";
import { TicketControls } from "./TicketControls";

/**
 * The ticket queue on `/admin/maintenance` (spec §5.6), on the shared
 * `QueueList` (UI system phase 4): search and Status / Priority facets over
 * every ticket, open ones on the page, resolved and closed behind the
 * disclosure.
 *
 * **Cards, not a table.** A ticket carries a description somebody typed and a
 * resolution somebody will type, and neither fits a cell. Each is a
 * `ReviewCard` — title, status and priority as glyphs, the machine and who
 * reported it on the meta line — with the controls under the words they act
 * on, which is what lets this be worked on a phone next to the machine.
 *
 * Everything is a prop (the action included), so a component test mounts it.
 */

export interface MaintenanceQueueProps {
  tickets: MaintenanceQueueEntry[];
  /** Who a ticket can be handed to — admin roles only (`listAssignableStaff`). */
  staff: ReadonlyArray<{ id: string; name: string }>;
  action: UpdateTicketAction;
}

/** The two statuses that mean "somebody still has to do something". */
const OPEN_STATUSES = new Set(["open", "in_progress"]);

export const TICKET_STATUS_TONE: Record<string, StatusTone> = {
  open: "active",
  in_progress: "warn",
  resolved: "ok",
  closed: "muted",
};

export const PRIORITY_TONE: Record<string, StatusTone> = {
  critical: "bad",
  high: "bad",
  medium: "warn",
  low: "idle",
};

export function MaintenanceQueue({ tickets, staff, action }: MaintenanceQueueProps) {
  const t = useTranslations("admin.maintenance");

  return (
    <QueueList
      items={tickets}
      getId={(ticket) => ticket.id}
      isOpen={(ticket) => OPEN_STATUSES.has(ticket.status)}
      searchText={(ticket) =>
        [ticket.title, ticket.toolName, ticket.unitLabel, ticket.description, ticket.reportedByName, ticket.assignedToName].join(" ")
      }
      facets={[
        {
          id: "status",
          label: t("fieldStatus"),
          values: MAINTENANCE_STATUS,
          valueLabel: (value) => t(`status.${value}`),
          matches: (ticket, value) => ticket.status === value,
        },
        {
          id: "priority",
          label: t("fieldPriority"),
          values: MAINTENANCE_PRIORITY,
          valueLabel: (value) => t(`priority.${value}`),
          matches: (ticket, value) => ticket.priority === value,
        },
      ]}
      labels={{
        list: t("queueLabel"),
        filters: t("filtersLabel"),
        search: t("search"),
        searchPlaceholder: t("searchPlaceholder"),
        settled: (count) => t("settledToggle", { count }),
        empty: t("empty"),
        emptyOpen: t("emptyOpen"),
      }}
      renderItem={(ticket) => <TicketCard ticket={ticket} staff={staff} action={action} />}
    />
  );
}

function TicketCard({
  ticket,
  staff,
  action,
}: {
  ticket: MaintenanceQueueEntry;
  staff: ReadonlyArray<{ id: string; name: string }>;
  action: UpdateTicketAction;
}) {
  const t = useTranslations("admin.maintenance");
  const open = OPEN_STATUSES.has(ticket.status);
  const urgent = open && (ticket.priority === "high" || ticket.priority === "critical");

  return (
    <ReviewCard
      label={ticket.title}
      headingLevel={3}
      tone={!open ? "settled" : urgent ? "safety" : "default"}
      marks={
        <>
          <StatusGlyph tone={TICKET_STATUS_TONE[ticket.status] ?? "idle"} label={t(`status.${ticket.status}`)} />
          {ticket.priority ? (
            <StatusGlyph tone={PRIORITY_TONE[ticket.priority] ?? "idle"} label={t(`priority.${ticket.priority}`)} />
          ) : null}
        </>
      }
      meta={
        <>
          {/* The machine, and how to get to it: a unit lives on its tool's
              page, which is also where the editor opens (§5.3(b)). */}
          {ticket.toolSlug ? (
            <Link className="text-primary-ink hover:underline" href={`/tools/${ticket.toolSlug}`}>
              {ticket.toolName}
            </Link>
          ) : (
            <span>{ticket.toolName || t("noTool")}</span>
          )}
          {ticket.unitLabel ? <span>{ticket.unitLabel}</span> : null}
          {ticket.type ? <span>{t(`type.${ticket.type}`)}</span> : null}
          {/* ISO, locale-neutral, identical on the server and the client. */}
          <span className="tabular-nums">{t("reportedOn", { date: ticket.dateReported || isoDay(ticket.createdAt) })}</span>
          {ticket.dateResolved ? <span className="tabular-nums">{t("resolvedOn", { date: ticket.dateResolved })}</span> : null}
        </>
      }
    >
      <p className="m-0 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{ticket.reportedByName ? t("reportedBy", { name: ticket.reportedByName }) : t("reportedAnonymously")}</span>
        {/* The one thing an admin does with a ticket they do not understand is
            ask the person who filed it (§8 — this page and nowhere else). */}
        {ticket.reportedByEmail ? (
          <a className="font-mono text-primary-ink hover:underline" href={`mailto:${ticket.reportedByEmail}`}>
            {ticket.reportedByEmail}
          </a>
        ) : null}
      </p>

      {/* Somebody typed this into a textarea; their line breaks are part of what they said. */}
      {ticket.description ? <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">{ticket.description}</p> : null}

      <TicketControls ticket={ticket} staff={staff} action={action} />
    </ReviewCard>
  );
}

function isoDay(at: Date): string {
  return new Date(at).toISOString().slice(0, 10);
}
