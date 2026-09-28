"use client";

import { useTranslations } from "next-intl";
import type { KioskDownMachine } from "@/lib/kiosk/types";
import { cn } from "@/lib/utils";
import { ToolImage } from "../ToolImage";
import { KioskGlyph } from "./KioskGlyph";
import { KIOSK_TYPE } from "./kiosk-type";

/** Cards shown before "+N more down": a screen is read at a glance, not scrolled. */
export const DOWN_VISIBLE = 6;

/**
 * Which machines are down (kiosk spec §6): a card per tool with its photo,
 * name and "1 of 2 down", or — when nothing is — "All machines running" with
 * how many are in service. Never an empty panel.
 */
export function DownMachines({ down, unitsInService }: { down: KioskDownMachine[]; unitsInService: number }) {
  const t = useTranslations("kiosk");
  const shown = down.slice(0, DOWN_VISIBLE);
  const hidden = down.length - shown.length;

  return (
    <section aria-labelledby="kiosk-machines" className="flex min-h-0 flex-col gap-[2vmin]">
      <h2 id="kiosk-machines" className={KIOSK_TYPE.label}>
        {t("machinesHeading")}
      </h2>
      {down.length === 0 ? (
        <div data-kiosk-state="all-running" className="flex flex-col gap-[1.5vmin] border border-border bg-card p-[3vmin]">
          <p className={cn(KIOSK_TYPE.headline, "flex items-center gap-[2vmin]")}>
            <KioskGlyph tone="ok" className="text-[0.7em]" />
            {t("allRunning")}
          </p>
          <p className={cn(KIOSK_TYPE.body, "text-muted-foreground")}>{t("unitsInService", { count: unitsInService })}</p>
        </div>
      ) : (
        <>
          <ul className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(min(100%,34vmin),1fr))] gap-[1.5vmin]">
            {shown.map((machine) => (
              <li key={machine.toolSlug} className="flex min-w-0 items-center gap-[2vmin] border border-border bg-card p-[1.5vmin]">
                <ToolImage src={machine.imageSrc} name={machine.toolName} sizes="12vmin" className="size-[11vmin] shrink-0" />
                <div className="flex min-w-0 flex-col gap-[0.8vmin]">
                  <p className={cn(KIOSK_TYPE.body, "line-clamp-2 font-medium")}>{machine.toolName}</p>
                  <p className={cn(KIOSK_TYPE.small, "flex items-baseline gap-[1vmin]")}>
                    <KioskGlyph tone={machine.state === "under_maintenance" ? "warn" : "bad"} />
                    <span>{downLine(t, machine)}</span>
                  </p>
                  <p className={cn(KIOSK_TYPE.small, "text-muted-foreground")}>{stateWord(t, machine)}</p>
                </div>
              </li>
            ))}
          </ul>
          {hidden > 0 ? <p className={cn(KIOSK_TYPE.small, "text-muted-foreground")}>{t("moreDown", { count: hidden })}</p> : null}
        </>
      )}
    </section>
  );
}

type T = ReturnType<typeof useTranslations>;

function downLine(t: T, machine: KioskDownMachine): string {
  return machine.unitsDown >= machine.unitsTotal
    ? t("allDown", { total: machine.unitsTotal })
    : t("downCount", { down: machine.unitsDown, total: machine.unitsTotal });
}

function stateWord(t: T, machine: KioskDownMachine): string {
  if (machine.state === "under_maintenance") return t("stateUnderMaintenance");
  if (machine.state === "out_of_service") return t("stateOutOfService");
  return t("stateMixed");
}
