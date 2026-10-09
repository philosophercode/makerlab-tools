# The lab status screen

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## The lab status screen (`/kiosk`; kiosk spec phase 1)

A full-screen, read-only page for the TV at the front of the lab and the ISAM
booth iPad (spec `docs/specs/2026-09-27-kiosk-mode-design.md`, PR #93). No
sign-in, no migration, no model call, no new permission. Owner answers
(2026-09-27): the open-ticket count is shown, in the lab and at the booth; a
featured project's author is first name + last initial; it runs on production
data; the QR code opens the catalogue with the chat.

- **One loader, cached behind invalidation.** `src/lib/kiosk/snapshot.ts`:
  `assembleKioskSnapshot({ db, now })` reads the published catalogue, one
  grouped count of unit statuses (`data/kiosk.ts` — the catalogue folds
  `under_maintenance`/`out_of_service`/`retired` into "Offline", the kiosk needs
  them apart), `countOpenTickets` (`data/maintenance.ts`, the same statement the
  `/admin` maintenance tile now uses) and the published projects.
  `loadKioskSnapshot()` is that under `"use cache"`, tagged `catalog`,
  `projects` **and `maintenance`**, on `KIOSK_CACHE` (revalidate 5 min as a
  backstop, expire 24 h). **Every ticket write calls `invalidateMaintenance()`**
  (`writeTicket` and `report_issue`); unit-status writes already call
  `invalidateCatalog()`. A new ticket write path must do the same, or the screen
  lags five minutes.
- **Failure is not zero.** The ticket count fails alone to `null` ("—", "Not
  available"); anything else throws, so `/api/kiosk` answers 503 and the page
  renders "Lab status is unavailable right now" with the QR code. Never a zeroed
  snapshot.
- **Who is on shift** (on-shift spec 2026-10-07): `onShift: string[]` ("Alex
  M."), read by the page and `/api/kiosk` beside the cached snapshot with
  `loadOnShiftNames()` (`lib/on-shift/read.ts`), never inside it, so a shift
  leaves the screen on the first poll after its end. Shown beside the hours as
  "On shift now" over the names; nothing when nobody is on shift.
- **Privacy.** `KioskSnapshot` (`lib/kiosk/types.ts`) has no field for an email,
  a ticket's text, a draft or a full name; the loader maps field by field.
  `shortAuthorName` ("Maya Rodriguez" → "Maya R.", anything with `@` → null) runs
  on the server; the full name never reaches the client. `snapshot.test.ts`'s
  privacy case asserts the serialised payload.
- **`GET /api/kiosk`**: public, `ROUTE_TIERS.kiosk` (20/min) keyed by the hashed
  client IP — **it reads no cookie** (no `resolveIdentity`) — checked before the
  loader; `Cache-Control: no-store`; adds `askUrl` and `servedAt` outside the
  cache.
- **The screen** (`components/kiosk/KioskScreen.tsx`) polls every 60 s + ≤10 s
  jitter, backs off 1 → 2 → 5 min, keeps the last good snapshot, and measures
  staleness from **its own last good poll**, not `generatedAt` (a cached read
  keeps its fill time for minutes while still being current). The "Updated" line
  becomes an amber bar in the footer after 3 min, or at once when
  `navigator.onLine` is false. Featured rotation is clock-derived (20 s), so a
  refresh keeps its place and screens agree; a 2 s burn-in shift of ≤8 px every
  5 min; wake lock re-asked on `visibilitychange`; reload at 04:00 lab time,
  skipped while polls fail. All the timing lives in `lib/kiosk/derive.ts`,
  pure and tested at its boundaries.
- **Dark, full-bleed, no site chrome.** `ThemeScript` forces `data-theme="dark"`
  on `/kiosk` before paint without storing it; `SiteChrome` (a client wrapper
  in the root layout) drops `GlobalChrome` and `DemoDataBanner` there and
  `ChatFab` returns null (`isKioskPath`, `components/kiosk-path.ts`);
  `app/kiosk/kiosk.css` hides the root's permanent scrollbar with
  `html:has([data-kiosk])`. The logo is the lab's official one (`BrandLogo`,
  `siteConfig.logo`, the Cornell Tech MakerLAB SVG), a CSS mask filled with
  `--on-surface`, so a single-colour logo reads on dark. It is
  `clamp(36px, 7vmin, 150px)` tall, 76 px on a 1080p screen (identity spec
  amendment 2026-10-06). The QR code is drawn in
  `currentColor` on an `--on-surface` plate (no pure white). Type is `vmin` with
  `clamp()` (`kiosk-type.ts`, ceilings at the 4K value). Three layouts, named
  once as custom variants in `styles/ui.css`: `kiosk-wall` (landscape, ≥600px
  tall: two columns, one screen, no scroll), `kiosk-scroll` (everything else:
  an upright iPad puts the ticket count and featured item beside the QR code
  and scrolls inside the screen if it must) and `kiosk-phone` (<640px wide or a
  phone on its side: one column, 112px QR code plus an "Open the assistant"
  link). Panels read `--kiosk-*` custom properties set per layout on the root,
  are placed with `grid-template-areas`, and pad with `env(safe-area-inset-*)`
  (`viewport-fit=cover` on the page). `kiosk.css` also hands the h1 size back
  from globals.css's unlayered narrow-screen rule (`revert-layer`).
- **The QR code** (`lib/kiosk/qr.ts`, server-only; `qrcode` is now a runtime
  dependency) encodes `kioskAskUrl(origin)` = `<origin>/?src=kiosk&ask=1`
  (`lib/kiosk/params.ts`). `AskParamOpener` in the root layout (its own
  Suspense, so the chat button stays in the HTML) opens the chat on `?ask=1`,
  once, anywhere but the kiosk.
- **Language:** `/kiosk` ignores the cookie and `Accept-Language`; `?lang=`
  picks a supported locale (`app/kiosk/kiosk-locale.ts`), `kiosk.*` strings
  with English underneath, times in `LAB_TIMEZONE`.
- **Hours** are `siteConfig.labHours` (`NEXT_PUBLIC_LAB_HOURS`, default
  `LAB OPEN 8AM-8PM`), which the header's status strip reads too. Phase 2
  structures them.
- **Tests:** `lib/kiosk/{derive,qr,snapshot}.test.ts`, `app/api/kiosk/route.test.ts`,
  `components/kiosk/KioskScreen.test.tsx`, `components/kiosk-chrome.test.tsx`,
  `e2e/kiosk.spec.ts` (drives the poll with Playwright's clock and
  `page.route`, never the shared demo database; `KIOSK_SCREENSHOT_DIR` keeps a
  screenshot per viewport). The QR test has no decoder: it reads the modules
  back out of the SVG and compares them with `qrcode`'s matrix for `askUrl`.
