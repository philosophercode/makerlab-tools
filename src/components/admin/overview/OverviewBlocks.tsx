import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "../../system/EmptyState";
import { Glyph, StatusGlyph } from "../../system/StatusGlyph";
import type { ResolveIssueAction } from "../checklist-issues";
import type { NeedToKnow, OverviewRow } from "./overview-model";
import { TakeTicketButton } from "./TakeTicketButton";

/**
 * The overview's blocks (admin sections spec 2026-10-07; the review's
 * "Today" mock-up): a mono heading over a hairline with an optional link on
 * the right, then rows. The main column's blocks (Need to know) sit on the
 * page; the side column's (Waiting for a decision, Inventory health) are
 * plates. Server components; the one control in them, **Take it**, is its
 * own island.
 */

export function OverviewBlock({
  id,
  title,
  link,
  plate = false,
  children,
}: {
  id: string;
  title: string;
  link?: { href: string; label: string };
  plate?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("ui flex flex-col gap-2", plate && "border border-border bg-card p-4")}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h3 id={`${id}-heading`} className="m-0 font-mono text-label font-medium tracking-[0.08em] uppercase">
          {title}
        </h3>
        {link ? (
          <Link href={link.href} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase underline-offset-4 hover:text-foreground hover:underline">
            {link.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Need to know: urgent tickets, tickets that name no machine, overdue recurring tasks. */
export function NeedToKnowList({
  need,
  me,
  takeTicket,
  checklistHref,
  maintenanceHref,
}: {
  need: NeedToKnow;
  /** The viewer, for Take it. Null: no Take it (no account id). */
  me: { id: string; name: string } | null;
  takeTicket: ResolveIssueAction;
  checklistHref: string;
  maintenanceHref: string;
}) {
  const t = useTranslations("admin.overview");
  const tp = useTranslations("admin.maintenance.priority");

  if (need.urgent === null) return <EmptyState tone="bad">{t("needUnreadable")}</EmptyState>;
  const nothing = need.urgent.length === 0 && need.unlinked === 0 && !need.overdueTasks;
  if (nothing) return <EmptyState>{t("needNothing")}</EmptyState>;

  return (
    <ul aria-label={t("needHeading")} className="m-0 flex list-none flex-col p-0">
      {need.urgent.map((ticket) => (
        <Row
          key={ticket.id}
          tone={ticket.priority === "critical" ? "bad" : "warn"}
          title={ticket.title}
          detail={[
            ticket.where,
            tp(ticket.priority),
            ticket.assigned ? ticket.assignedToName || t("someone") : t("nobodyYet"),
            ticket.dateReported && t("since", { date: ticket.dateReported }),
          ]
            .filter(Boolean)
            .join(" · ")}
          action={
            !ticket.assigned && me ? (
              <TakeTicketButton ticketId={ticket.id} title={ticket.title} me={me} action={takeTicket} />
            ) : (
              <Link href={maintenanceHref} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label={t("openFor", { title: ticket.title })}>
                {t("open")}
              </Link>
            )
          }
        />
      ))}
      {need.moreUrgent > 0 ? (
        <li className="border-b border-border py-2 text-sm">
          <Link href={maintenanceHref} className="text-primary-ink hover:underline">
            {t("moreUrgent", { count: need.moreUrgent })}
          </Link>
        </li>
      ) : null}
      {need.overdueTasks ? (
        <Row
          tone="bad"
          title={t("overdueTasks", { count: need.overdueTasks })}
          detail={t("overdueTasksDetail")}
          action={
            <Link href={checklistHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("openChecklist")}
            </Link>
          }
        />
      ) : null}
      {need.unlinked > 0 ? (
        <Row
          tone="warn"
          title={t("unlinked", { count: need.unlinked })}
          detail={t("unlinkedDetail")}
          action={
            <Link href={maintenanceHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("openTickets")}
            </Link>
          }
        />
      ) : null}
    </ul>
  );
}

function Row({ tone, title, detail, action }: { tone: "bad" | "warn"; title: string; detail: string; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border py-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <Glyph tone={tone} className="mt-1 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-medium">{title}</span>
          {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
        </div>
      </div>
      <div className="ms-7 shrink-0 sm:ms-0">{action}</div>
    </li>
  );
}

/** A side block's rows: a glyph, the label (a link), the number at the end, and an optional second line. */
export function OverviewRowList({ rows, label, empty }: { rows: readonly OverviewRow[]; label: string; empty: string }) {
  const t = useTranslations("admin.overview");
  if (rows.length === 0) return <p className="m-0 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-2 last:border-b-0">
          <Glyph tone={row.tone} />
          <Link href={row.href} className="text-sm hover:underline">
            {row.label}
          </Link>
          <span className={cn("font-mono text-sm tabular-nums", row.value === 0 ? "text-muted-foreground" : row.tone === "active" ? "text-primary-ink" : "")}>
            {row.value === null ? <StatusGlyph tone="bad" label={t("unreadable")} compact /> : row.value}
          </span>
          {row.detail ? <span className="col-start-2 col-end-4 text-xs text-muted-foreground">{row.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
