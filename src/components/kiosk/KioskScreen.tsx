"use client";

import { useFormatter, useTranslations } from "next-intl";
import { burnInOffset, rotationIndex, staleness } from "@/lib/kiosk/derive";
import type { KioskSnapshot } from "@/lib/kiosk/types";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { BrandLogo } from "../BrandLogo";
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
 * Three layouts (`kiosk-wall` / `kiosk-scroll` / `kiosk-phone` in
 * `styles/ui.css`): a landscape screen with room for it all — the TV, a
 * laptop, an iPad on its side — is two columns on one screen with no
 * scrolling; an upright iPad stacks the machines over the ticket count and the
 * featured item beside the QR code; a phone is one column that scrolls, with
 * a small QR code and a link.
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
  // An older payload (a screen open across a deploy) has no `onShift`: nobody shown.
  const onShift = snapshot?.onShift ?? [];

  return (
    <div
      data-kiosk=""
      data-theme="dark"
      data-staleness={state}
      dir={dir}
      className={cn("ui fixed inset-0 overflow-hidden bg-background font-sans text-foreground", KIOSK_LAYOUT_VARS)}
    >
      <div
        data-kiosk-shift={`${x},${y}`}
        style={{ transform: `translate(${x}px, ${y}px)` }}
        className={cn(
          "flex h-full flex-col gap-(--kiosk-gap) transition-transform duration-[2000ms] ease-in-out",
          // The screen's edge: never under a notch, a rounded corner or the home bar.
          "pt-[max(var(--kiosk-gutter),env(safe-area-inset-top))] pr-[max(var(--kiosk-gutter),env(safe-area-inset-right))]",
          "pb-[max(var(--kiosk-gutter),env(safe-area-inset-bottom))] pl-[max(var(--kiosk-gutter),env(safe-area-inset-left))]",
          "kiosk-scroll:overflow-x-hidden kiosk-scroll:overflow-y-auto kiosk-scroll:overscroll-contain kiosk-scroll:*:shrink-0"
        )}
      >
        <header
          className={cn(
            "flex shrink-0 items-center justify-between gap-[3vmin] border-b border-border pb-[2vmin]",
            // An upright phone has no room for one line: the name, then the hours and the clock.
            "max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:pb-3"
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-[2.5vmin] gap-y-2 max-sm:gap-x-4">
            {/* Two lines of type and the seal, so taller than the one-line
                logo it replaced: 76px tall on a 1080p screen, 36px at least. */}
            <BrandLogo className="h-[clamp(36px,7vmin,150px)] text-foreground" />
            <h1 className={cn(KIOSK_TYPE.label, "text-foreground")}>
              <span className="sr-only">{siteConfig.name} — </span>
              {t("title")}
            </h1>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-[3vmin] max-sm:flex-wrap max-sm:justify-between max-sm:gap-4">
            {/* Who is on shift (on-shift spec 2026-10-07): first name and last
                initial, or nothing at all when nobody is. */}
            {onShift.length > 0 ? (
              <p data-kiosk-on-shift="" className="flex min-w-0 flex-col items-end gap-[0.6vmin] max-sm:items-start">
                <span className={KIOSK_TYPE.label}>{t("onShiftLabel")}</span>
                <span className={cn(KIOSK_TYPE.small, "flex items-center gap-[1vmin] font-mono uppercase")}>
                  <KioskGlyph tone="ok" />
                  {format.list(onShift, { type: "conjunction" })}
                </span>
              </p>
            ) : null}
            <p className="flex min-w-0 flex-col items-end gap-[0.6vmin] max-sm:items-start">
              <span className={KIOSK_TYPE.label}>{t("hoursLabel")}</span>
              <span className={cn(KIOSK_TYPE.small, "font-mono uppercase")}>{snapshot?.lab.hoursText ?? siteConfig.labHours}</span>
            </p>
            <p className={cn(KIOSK_TYPE.clock, "shrink-0")}>
              <span className="sr-only">{t("clockLabel")} </span>
              <time dateTime={new Date(now).toISOString()} suppressHydrationWarning>
                {time(now)}
              </time>
            </p>
          </div>
        </header>

        {snapshot ? (
          <main data-kiosk-main="" className={KIOSK_GRID}>
            <DownMachines
              down={snapshot.down}
              unitsInService={snapshot.unitsInService}
              className="[grid-area:machines] kiosk-wall:overflow-hidden"
            />
            <TicketCount tickets={snapshot.tickets} className="[grid-area:tickets] kiosk-scroll:self-start" />
            <AskQr qrSvg={qrSvg} askUrl={askUrl} className="[grid-area:qr] kiosk-wall:self-start" />
            <FeaturedPanel item={item} className="[grid-area:featured] kiosk-wall:self-end" />
          </main>
        ) : (
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[4vmin] text-center">
            <div className="flex flex-col gap-[1.5vmin]">
              <p className={KIOSK_TYPE.headline}>{t("unavailableTitle")}</p>
              <p className={cn(KIOSK_TYPE.body, "text-muted-foreground")}>{t("unavailableBody")}</p>
            </div>
            <AskQr qrSvg={qrSvg} askUrl={askUrl} />
          </main>
        )}

        <footer
          className={cn(
            KIOSK_TYPE.label,
            "mt-auto flex min-h-[clamp(28px,4.6vmin,100px)] shrink-0 flex-wrap items-center justify-between gap-[2vmin]"
          )}
        >
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

/**
 * The sizes each layout gives the panels. The panels read these custom
 * properties and never ask which layout they are in.
 */
const KIOSK_LAYOUT_VARS = cn(
  "[--kiosk-gutter:max(16px,3vmin)] [--kiosk-gap:max(12px,2.2vmin)]",
  // The QR code: at least 30% of the screen's short side (§6).
  "[--kiosk-qr:clamp(200px,32vmin,720px)]",
  // Down-machine cards: as many columns as fit at this width.
  "[--kiosk-card-min:min(100%,34vmin)] [--kiosk-thumb:clamp(48px,11vmin,240px)] [--kiosk-featured-thumb:clamp(64px,16vmin,320px)]",
  "kiosk-wall:[--kiosk-featured-thumb:clamp(64px,12vmin,240px)]",
  // A phone is read at arm's length from the person's own hand, and is
  // already a phone: the QR code is small and a link sits beside it.
  "kiosk-phone:[--kiosk-qr:112px] kiosk-phone:[--kiosk-card-min:min(100%,280px)] kiosk-phone:[--kiosk-thumb:56px] kiosk-phone:[--kiosk-featured-thumb:72px]"
);

/**
 * Where the panels sit. Wall: the machines and the ticket count on the left,
 * the QR code and the featured item on the right, all on one screen. Upright
 * iPad: the machines across the top, then the ticket count and the featured
 * item beside the QR code. Phone: one column, the QR code last.
 */
const KIOSK_GRID = cn(
  "grid min-h-0 gap-[calc(var(--kiosk-gap)*1.3)]",
  "kiosk-wall:flex-1 kiosk-wall:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] kiosk-wall:grid-rows-[auto_minmax(0,1fr)_auto]",
  "kiosk-wall:[grid-template-areas:'machines_qr'_'machines_featured'_'tickets_featured']",
  "kiosk-scroll:grid-cols-[minmax(0,1fr)_auto] kiosk-scroll:grid-rows-[auto_auto_1fr]",
  "kiosk-scroll:[grid-template-areas:'machines_machines'_'tickets_qr'_'featured_qr']",
  "kiosk-phone:grid-cols-1 kiosk-phone:grid-rows-none",
  "kiosk-phone:[grid-template-areas:'machines'_'tickets'_'featured'_'qr']"
);
