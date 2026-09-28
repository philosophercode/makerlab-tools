"use client";

import { useTranslations } from "next-intl";
import type { KioskTicketCounts } from "@/lib/kiosk/types";
import { cn } from "@/lib/utils";
import { KIOSK_TYPE } from "./kiosk-type";

/**
 * Open tickets as one large number — `open` plus `in_progress`, the `/admin`
 * tile's figures (kiosk spec §2) — with how many are being worked on beside
 * it, so "7" reads as a lab looking after its machines (§12). A count that
 * could not be read is "—" and "Not available", never 0 (§5.3).
 */
export function TicketCount({ tickets }: { tickets: KioskTicketCounts | null }) {
  const t = useTranslations("kiosk");
  const total = tickets ? tickets.open + tickets.inProgress : null;

  return (
    // The heading comes first for a screen reader; the figure is drawn first.
    <section
      aria-labelledby="kiosk-tickets"
      className="flex flex-row-reverse items-end justify-end gap-[3vmin] border border-border bg-card p-[2.5vmin]"
    >
      <div className="flex min-w-0 flex-col gap-[1vmin] pb-[0.8vmin]">
        <h2 id="kiosk-tickets" className={KIOSK_TYPE.label}>
          {t("ticketsHeading")}
        </h2>
        {tickets ? (
          <p className={KIOSK_TYPE.small}>
            {t("ticketsWorking", { count: tickets.inProgress })}
            <span className="text-muted-foreground"> · {t("ticketsWaiting", { count: tickets.open })}</span>
          </p>
        ) : (
          <p className={cn(KIOSK_TYPE.small, "text-muted-foreground")}>{t("ticketsUnavailable")}</p>
        )}
      </div>
      <p data-kiosk-tickets={total ?? "unavailable"} className={KIOSK_TYPE.figure}>
        {total ?? "—"}
      </p>
    </section>
  );
}
