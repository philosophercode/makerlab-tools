import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MaintenanceQueueEntry } from "../../lib/data/maintenance";
import type { UpdateTicketAction } from "../../app/admin/maintenance/action-result";
import { TicketControls } from "./TicketControls";

/**
 * The ticket queue on `/admin/maintenance` (spec §5.6).
 *
 * A server component with no `async` and no data access of its own, for the
 * reason `UsersTable` is: everything is a prop, so a
 * component test mounts it with the ordinary i18n wrapper.
 *
 * **Cards, not a table.** A ticket carries a description somebody typed and a
 * resolution somebody will type, and neither fits a cell. The card also puts
 * the controls under the words they act on, which is what lets this be worked
 * on a phone standing next to the machine.
 *
 * **Open work is the page; settled work is behind a disclosure.** Somebody with
 * ten minutes wants the twenty tickets that are still open, in the order the
 * read already put them — but "what did we do about the last one of these" is
 * the question a resolution field exists to answer, so the closed ones are one
 * click away rather than gone.
 */

export interface MaintenanceQueueProps {
  tickets: MaintenanceQueueEntry[];
  /** Who a ticket can be handed to — admin roles only (`listAssignableStaff`). */
  staff: ReadonlyArray<{ id: string; name: string }>;
  action: UpdateTicketAction;
}

/** The two statuses that mean "somebody still has to do something". */
const OPEN_STATUSES = new Set(["open", "in_progress"]);

export function MaintenanceQueue({ tickets, staff, action }: MaintenanceQueueProps) {
  const t = useTranslations("admin.maintenance");

  if (tickets.length === 0) {
    // Spec §6: an empty state names what is missing and what would fill it.
    return <p className="admin-empty td-empty">{t("empty")}</p>;
  }

  const open = tickets.filter((ticket) => OPEN_STATUSES.has(ticket.status));
  const settled = tickets.filter((ticket) => !OPEN_STATUSES.has(ticket.status));

  return (
    <div className="admin-queue">
      {open.length === 0 ? (
        <p className="admin-empty td-empty">{t("emptyOpen")}</p>
      ) : (
        <ul className="admin-queue-list" aria-label={t("queueLabel")}>
          {open.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} staff={staff} action={action} />
          ))}
        </ul>
      )}

      {settled.length > 0 ? (
        <details className="admin-queue-settled">
          <summary>{t("settledToggle", { count: settled.length })}</summary>
          <ul className="admin-queue-list">
            {settled.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} staff={staff} action={action} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
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

  return (
    <li className={`admin-queue-card is-${ticket.status}`}>
      <header className="admin-queue-card-head">
        <h3>{ticket.title}</h3>
        <span className={`admin-state is-${ticket.status}`}>{t(`status.${ticket.status}`)}</span>
        {ticket.priority ? (
          <span className={`admin-priority is-${ticket.priority}`}>
            {t(`priority.${ticket.priority}`)}
          </span>
        ) : null}
      </header>

      <p className="admin-queue-meta">
        {/* The machine, and how to get to it. There is no page for a unit of
            its own — a unit lives on its tool's page, which is also where the
            editor opens for anybody holding `tools.edit` (§5.3(b)). */}
        {ticket.toolSlug ? (
          <Link href={`/tools/${ticket.toolSlug}`}>{ticket.toolName}</Link>
        ) : (
          <span>{ticket.toolName || t("noTool")}</span>
        )}
        {ticket.unitLabel ? <span className="admin-unit-label">{ticket.unitLabel}</span> : null}
        {ticket.type ? <span>{t(`type.${ticket.type}`)}</span> : null}
      </p>

      <p className="admin-queue-meta">
        {ticket.reportedByName ? (
          <span>{t("reportedBy", { name: ticket.reportedByName })}</span>
        ) : (
          <span>{t("reportedAnonymously")}</span>
        )}
        {/* The one thing an admin does with a ticket they do not understand is
            ask the person who filed it (§8 — this page and nowhere else). */}
        {ticket.reportedByEmail ? (
          <a href={`mailto:${ticket.reportedByEmail}`}>{ticket.reportedByEmail}</a>
        ) : null}
        {/* ISO, locale-neutral, in the mono treatment every other stamp in
            `/admin` gets — and identical on the server and the client. */}
        <span className="admin-date">
          {t("reportedOn", { date: ticket.dateReported || isoDay(ticket.createdAt) })}
        </span>
        {ticket.dateResolved ? (
          <span className="admin-date">{t("resolvedOn", { date: ticket.dateResolved })}</span>
        ) : null}
      </p>

      {ticket.description ? <p className="admin-queue-body">{ticket.description}</p> : null}

      <TicketControls ticket={ticket} staff={staff} action={action} />
    </li>
  );
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
