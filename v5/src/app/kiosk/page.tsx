import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import "./kiosk.css";
import { KioskScreen } from "../../components/kiosk/KioskScreen";
import { authBaseUrl } from "../../lib/auth/config";
import { kioskAskUrl } from "../../lib/kiosk/params";
import { kioskQrSvg } from "../../lib/kiosk/qr";
import { loadKioskSnapshot, withAskUrl } from "../../lib/kiosk/snapshot";
import type { KioskSnapshot } from "../../lib/kiosk/types";
import { labTimezone } from "../../lib/lab-time";
import { requestOrigin } from "../../lib/request-origin";
import { siteConfig } from "../../lib/site-config";
import { kioskLocale, kioskMessages } from "./kiosk-locale";

export const metadata: Metadata = {
  title: `Lab status — ${siteConfig.name}`,
  description: `What is running in the ${siteConfig.institution} MakerLAB right now.`,
  robots: { index: false },
};

/**
 * `viewport-fit=cover` lets the screen paint under a phone's notch and home
 * bar, and the kiosk's padding keeps the text clear of them with
 * `env(safe-area-inset-*)`. The browser chrome is the screen's own dark.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f0f0f",
};

/**
 * `/kiosk` — the lab status screen (kiosk spec, phase 1). Public and
 * read-only: no sign-in, no cookie read or set, nothing a visitor to the
 * catalogue could not already see except the open-ticket count.
 *
 * The first snapshot is rendered here, in full, so the screen is never blank;
 * `KioskScreen` then polls `/api/kiosk`. When the database cannot be read on
 * this first render the page still renders — "Lab status is unavailable right
 * now" with the QR code, which needs no data (§5.3) — and the poll picks the
 * status up when it comes back.
 *
 * It renders in the default locale whatever the browser asks for, because a
 * wall screen is read by everybody; `?lang=` picks another for the booth (§6).
 */
export default async function KioskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const locale = kioskLocale(params.lang);
  const origin = requestOrigin(await headers()) ?? authBaseUrl();
  const askUrl = kioskAskUrl(origin);

  const [{ snapshot, renderedAt }, qrSvg, messages] = await Promise.all([
    readSnapshot(origin),
    kioskQrSvg(askUrl),
    kioskMessages(locale.code),
  ]);

  return (
    <NextIntlClientProvider locale={locale.code} messages={messages} timeZone={labTimeZone()}>
      <KioskScreen
        initial={snapshot}
        renderedAt={renderedAt}
        qrSvg={qrSvg}
        askUrl={askUrl}
        timeZone={labTimeZone()}
        dir={locale.dir}
      />
    </NextIntlClientProvider>
  );
}

/** The first snapshot, or null when it could not be read, and the server's clock when it was asked. */
async function readSnapshot(origin: string): Promise<{ snapshot: KioskSnapshot | null; renderedAt: number }> {
  try {
    const snapshot = withAskUrl(await loadKioskSnapshot(), origin);
    return { snapshot, renderedAt: Date.now() };
  } catch (err) {
    console.error("[kiosk] first render without a snapshot", err);
    return { snapshot: null, renderedAt: Date.now() };
  }
}

/** `LAB_TIMEZONE` when `Intl` knows it, else UTC — the fallback `labToday` takes. */
function labTimeZone(): string {
  const timeZone = labTimezone();
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}
