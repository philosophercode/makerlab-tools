"use client";

import { useFormatter, useTranslations } from "next-intl";
import { burnInOffset, rotationIndex, staleness } from "@/lib/kiosk/derive";
import type { KioskSnapshot } from "@/lib/kiosk/types";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { AskQr } from "./AskQr";
import { DownMachines } from "./DownMachines";
import { FeaturedPanel } from "./FeaturedPanel";
import { KioskGlyph } from "./KioskGlyph";
import { KIOSK_TYPE } from "./kiosk-type";
import { TicketCount } from "./TicketCount";
import { useKioskPoll } from "./use-kiosk-poll";
import { useForcedDarkTheme, useNightlyReload, useNow, useOnline, useWakeLock } from "./use-screen-care";

export interface KioskScreenProps {
  /** The first snapshot, rendered on the server; null when the database could not be read. */
  initial: KioskSnapshot | null;
  /** The server's clock when it rendered (ms). */
  renderedAt: number;
  /** The QR code, made on the server (`kioskQrSvg`). */
  qrSvg: string;
  askUrl: string;
  /** The lab's timezone: the clock, "Updated" and the nightly reload read it. */
  timeZone: string;
  /** The text direction of the kiosk's locale. */
  dir?: "ltr" | "rtl";
}

/**
 * `/kiosk`, the lab status screen (kiosk spec §5, §6). Read-only, dark, and
 * built to run for days: it polls, keeps its last good data when it cannot,
 * says how old that data is, shifts a few pixels every five minutes against
 * burn-in, asks for a wake lock and reloads itself at 04:00.
 *
 * Landscape (the TV, 1920×1080) is two columns — machines and tickets left,
 * the QR code and the featured item right. Portrait (an upright iPad) is the
 * same panels stacked with the QR code last.
 */
export function KioskScreen({ initial, renderedAt, qrSvg, askUrl, timeZone, dir = "ltr" }: KioskScreenProps) {
  const t = useTranslations("kiosk");
  const format = useFormatter();
  const { snapshot, lastOkAt, failures } = useKioskPoll(initial, renderedAt);
  const now = useNow(renderedAt);
  const online = useOnline();
  useWakeLock();
  useNightlyReload(timeZone, failures);
  useForcedDarkTheme();

  const time = (ms: number) => format.dateTime(new Date(ms), { hour: "numeric", minute: "2-digit", timeZone });
  const state = staleness(lastOkAt, now, online);
  const [x, y] = burnInOffset(now);
  const featured = snapshot?.featured ?? [];
  const item = featured.length > 0 ? featured[rotationIndex(now, featured.length)] : null;

  return (
    <div
      data-kiosk=""
      data-theme="dark"
      data-staleness={state}
      dir={dir}
      className="ui fixed inset-0 overflow-hidden bg-background font-sans text-foreground"
    >
      <div
        data-kiosk-shift={`${x},${y}`}
        style={{ transform: `translate(${x}px, ${y}px)` }}
        className="flex h-full flex-col gap-[2.2vmin] p-[3vmin] transition-transform duration-[2000ms] ease-in-out portrait:overflow-y-auto"
      >
        <header className="flex shrink-0 items-center justify-between gap-[3vmin] border-b border-border pb-[2vmin]">
          <div className="flex min-w-0 items-center gap-[2.5vmin]">
            <span
              aria-hidden="true"
              className="block h-[clamp(24px,4.6vmin,64px)] w-[clamp(140px,26vmin,380px)] shrink-0 bg-foreground"
              style={{
                maskImage: `url(${siteConfig.logo})`,
                WebkitMaskImage: `url(${siteConfig.logo})`,
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "left center",
                WebkitMaskPosition: "left center",
              }}
            />
            <h1 className={cn(KIOSK_TYPE.label, "text-foreground")}>
              <span className="sr-only">{siteConfig.name} — </span>
              {t("title")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-[3vmin]">
            <p className="flex flex-col items-end gap-[0.6vmin]">
              <span className={KIOSK_TYPE.label}>{t("hoursLabel")}</span>
              <span className={cn(KIOSK_TYPE.small, "font-mono uppercase")}>{snapshot?.lab.hoursText ?? siteConfig.labHours}</span>
            </p>
            <p className={KIOSK_TYPE.clock}>
              <span className="sr-only">{t("clockLabel")} </span>
              <time dateTime={new Date(now).toISOString()} suppressHydrationWarning>
                {time(now)}
              </time>
            </p>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 gap-[3vmin] portrait:min-h-fit portrait:flex-col portrait:gap-[2vmin] landscape:flex-row">
          {snapshot ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-[3vmin] portrait:contents">
                <div className="min-h-0 flex-1 portrait:order-1 portrait:flex-none">
                  <DownMachines down={snapshot.down} unitsInService={snapshot.unitsInService} />
                </div>
                <div className="shrink-0 portrait:order-2">
                  <TicketCount tickets={snapshot.tickets} />
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[3vmin] portrait:contents">
                <AskQr qrSvg={qrSvg} askUrl={askUrl} className="shrink-0 portrait:order-4" />
                <FeaturedPanel item={item} className="flex-1 portrait:order-3 portrait:flex-none" />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-[4vmin] text-center">
              <div className="flex flex-col gap-[1.5vmin]">
                <p className={KIOSK_TYPE.headline}>{t("unavailableTitle")}</p>
                <p className={cn(KIOSK_TYPE.body, "text-muted-foreground")}>{t("unavailableBody")}</p>
              </div>
              <AskQr qrSvg={qrSvg} askUrl={askUrl} />
            </div>
          )}
        </main>

        <footer className={cn(KIOSK_TYPE.label, "flex min-h-[clamp(28px,4.6vmin,64px)] shrink-0 items-center justify-between gap-[2vmin]")}>
          {/* The "Updated" line, or in its place the amber bar — in the
              footer, so going stale never pushes the panels about. Said once,
              politely: a screen reader should hear the screen go stale, not
              the clock tick. Warning token and a glyph, never colour alone. */}
          <div role="status" aria-live="polite" className="min-w-0 flex-1">
            {state === "fresh" ? (
              <span>{t("updated", { time: time(lastOkAt) })}</span>
            ) : (
              <p
                data-kiosk-bar={state}
                className={cn(
                  KIOSK_TYPE.small,
                  "flex items-center gap-[1.2vmin] border border-warn bg-card px-[1.6vmin] py-[0.6vmin] font-sans tracking-normal normal-case text-warn"
                )}
              >
                <KioskGlyph tone="warn" />
                {t(state === "offline" ? "offlineBar" : "staleBar", { time: time(lastOkAt) })}
              </p>
            )}
          </div>
          {snapshot?.demo ? (
            <span data-kiosk-demo="" className="border border-warn px-[1vmin] py-[0.4vmin] text-warn">
              {t("demo")}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
