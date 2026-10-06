# Kiosk Mode: a Lab Status Screen — Design Spec

**Date:** 2026-09-27
**Status:** Draft
**Target:** `v5/`
**Branch:** `docs/feature-specs`
**Spec PR:** — · **Implementation PR:** — (one per phase, §9)

## 1. Summary

The lab has a TV and an iPad and no reason for either to show the app. This spec adds
**`/kiosk`**, a full-screen, read-only page that auto-refreshes. It is built for a screen
mounted in the lab and for the ISAM 2026 demo booth (**Sunday 11 October 2026**). At a
glance it shows:

- which machines are **down or under maintenance**;
- how many **maintenance tickets are open**;
- the **lab hours**;
- a rotating **featured tool** or **recent student project**;
- a large **QR code** that opens the assistant on the viewer's own phone.

Nobody signs in on the display, and in phases 1 and 2 it shows only data the public
catalogue already shows. The screen is dark and moves slowly, to limit burn-in. When it
cannot refresh it says so and keeps its last good data; it never goes blank. **Phase 1 is
small enough to ship before ISAM.** It needs no migration, no model calls and no new
permission. It uses loaders that already exist, plus one aggregate count.

Later phases add structured lab hours and closures, pinning a featured item, and a
`get_lab_status` read tool. Phase 3 adds **signed display tokens**, needed only if the
owner decides a screen may show something non-public. Every write the later phases add
is an action in `src/lib/actions/`, so the assistant can propose it with a confirmation
card (assistant GUI-parity spec, #91). This is not an architecture change. It adds one
public route, one public JSON endpoint and, later, two small tables.

## 2. Goals / Non-goals

### Goals

- **A screen that runs unattended.** It opens `/kiosk` once and runs for days with no input.
  It refreshes every 60 s, survives Wi-Fi drops, and needs no sign-in or cookie.
- **Public data only (phases 1–2).** The kiosk payload never carries a name, an email, a
  ticket title or description, or a draft. A test asserts this (§10).
- **Down machines are shown per tool, with counts.** "Form 4 — 1 of 2 down" and "Trotec — under
  maintenance" come from `units.status`, the same source as the catalogue's
  `deriveStatus()`.
- **The open-ticket figure is a count.** It is `open` plus `in_progress` from
  `maintenance_logs`, the same numbers as the `/admin` maintenance tile.
- **The screen fails toward stale, not wrong** (Article 4). It shows "Updated 2 min ago"
  at all times. After 3 minutes without a refresh it shows an amber "Offline — showing
  14:02" bar. It never shows zeros it did not read.
- **The QR code works from 3 m away.** It is at least 30 % of the screen's short side,
  high-contrast, and generated server-side as SVG with the `qrcode` package the label
  generator already uses (`scripts/generate-qr-labels.ts`).
- **Burn-in is limited.** The theme is dark with no full-white areas, and the layout shifts
  a few pixels every few minutes. The featured panel rotates, and the screen dims outside
  lab hours once hours are structured (phase 2).
- **Phase 1 ships by Thursday 8 October**, with a dry run on the booth iPad before the demo.

### Non-goals (this iteration)

- **Interaction on the display.** The screen is read-only, with no chat and no touch
  navigation. The phone is the interactive surface, reached through the QR code. A shared
  public touch-screen chat means a queue, a privacy problem with the history, and an
  abuse vector.
- **Ticket details on a public screen.** Ticket text is written by students. It can
  contain names, and the row holds `reported_by_email`. A count is enough to say "the lab
  is looking after its machines".
- **Occupancy, sign-in at the door, reservations.** None of these exist in v5. Showing
  who is in the lab is also a privacy decision this spec does not make.
- **A native app, MDM, or a service worker.** For the iPad: Safari, Add to Home Screen,
  Guided Access, and Auto-Lock set to Never. That setup is enough, and offline tolerance
  comes from the in-page snapshot (§5.3).
- **New roles or permissions.** The GUI-parity spec's rule holds: this spec uses `can()`
  and the existing `statement`.
- **Usage analytics on the kiosk itself.** QR scans are tagged `src=kiosk` for counting
  (§5.4), and that is the only tracking.

## 3. Architecture

### 3.1 Where things live

```text
src/app/kiosk/
  page.tsx              server component: first snapshot, rendered in full
  loading.tsx           a dark placeholder with no flash of the light theme
src/app/api/kiosk/route.ts   GET → KioskSnapshot (JSON), rate-limited, cached
src/lib/kiosk/
  snapshot.ts           loadKioskSnapshot(): the one loader (server-only, "use cache")
  derive.ts             pure: down machines, featured rotation order, staleness
  qr.ts                 kioskQrSvg(): SVG string from the `qrcode` package
src/components/kiosk/
  KioskScreen.tsx       client: polling, stale bar, clock, burn-in shift, wake lock
  DownMachines.tsx, TicketCount.tsx, LabHours.tsx, FeaturedPanel.tsx, AskQr.tsx
```

- **Capability registry (Article 2).** Phase 1 adds no ability. Phase 2 adds
  `get_lab_status`, a `read` capability on both chat and MCP (§7). Phase 2's writes are
  actions (§4.3).
- **The chrome.** The root layout (`src/app/layout.tsx`) always draws `GlobalChrome`,
  `DemoDataBanner` and `ChatFab`. `ChatFab` already leaves out `/admin/*` through a
  pathname test (`ChatFab.tsx`), and `/kiosk` joins that test, with a matching one in
  `GlobalChrome`. The kiosk draws its own small demo-data chip in place of the banner.
- **Theme.** The kiosk root sets `data-theme="dark"` and uses the dark tokens that
  `globals.css` already swaps in (UI system spec §5). It adds no new colours. The brand
  accent comes from `siteConfig.colors`.
- **Caching (Article 4).** `loadKioskSnapshot()` is cached with
  `cacheTag("catalog", "maintenance")` and `cacheLife` set to `stale: 60, revalidate: 300`.
  Freshness comes from invalidation:
  - Unit status changes already call `invalidateCatalog()` (`src/lib/inventory/tool-state.ts`).
  - Ticket writes (`createMaintenanceLog`, `updateMaintenanceLog`, reached through
    `report_issue`, `writeTicket` and the maintenance queue) gain an
    `invalidateMaintenance()` beside it in `src/lib/revalidate.ts`.

  The 5-minute revalidate is a backstop, not the mechanism. Ten screens polling every
  minute cost ten cache reads a minute and close to zero database queries.

### 3.2 The snapshot

```ts
export interface KioskSnapshot {
  generatedAt: string;                 // ISO; the client's staleness clock starts here
  demo: boolean;                       // dataSubstrate() === "pglite-demo"
  lab: { hoursText: string; openNow: boolean | null; closesAt: string | null }; // phase 1: text only, openNow null
  down: {
    toolSlug: string; toolName: string; imageSrc: string;
    unitsDown: number; unitsTotal: number;
    state: "under_maintenance" | "out_of_service" | "mixed";
  }[];                                 // retired units excluded from both counts
  tickets: { open: number; inProgress: number } | null;   // null = could not be read, never 0
  featured: (
    | { kind: "tool"; slug: string; name: string; shortDescription: string; imageSrc: string }
    | { kind: "project"; slug: string; title: string; coverSrc: string; toolNames: string[] }
  )[];                                 // ≤ 12, published only, rotation order from derive.ts
  askUrl: string;                      // what the QR encodes
}
```

No field can hold free text written by a student except `project.title`, and projects are
published only after moderation (`projects.published`). `authorName` is deliberately not
in the type (§8, Q3).

## 4. Data model

### 4.1 Phase 1: no migration

| Panel | Source |
|---|---|
| Down machines | `getCatalogTools()` (`src/lib/catalog.ts`). Tools whose `units` include `under_maintenance` or `out_of_service` |
| Open tickets | `select count(*) filter (where status='open'), … 'in_progress' from maintenance_logs`, the query the `/admin` tile runs (`src/lib/data/admin-overview.ts`), extracted into `src/lib/data/maintenance.ts` so both share it |
| Lab hours | Today this is the literal `"LAB OPEN 9AM-9PM"` in `getCatalogStats()`, which breaks Article 6. Phase 1 moves it to `siteConfig.labHours` (`NEXT_PUBLIC_LAB_HOURS`, same default), and both the header and the kiosk read it |
| Featured | Published tools with a real product image (not the placeholder from `toolImageSrc`), plus `listPublishedProjects()`. A shuffle seeded by the lab-timezone date (`labToday()`), so every screen shows the same order on the same day |
| QR | `kioskQrSvg(askUrl)`. `askUrl = <site URL>/?src=kiosk&ask=1` |

### 4.2 Phase 2: migration `00NN_lab_hours` (next free number when it lands)

```text
lab_hours          weekday smallint (0–6) PK, opens time, closes time      -- a missing row means closed
lab_closures       id uuid PK, date date, opens time null, closes time null,  -- both null = closed all day
                   note text (≤ 120, public), created_by/updated_by (actorColumns()), timestamps()
kiosk_features     id uuid PK, subject_type text check in ('tool','project'), subject_id uuid,
                   position int, starts_on date null, ends_on date null, actorColumns(), timestamps()
```

- Times are wall-clock times in `LAB_TIMEZONE` (`src/lib/lab-time.ts`). "Open now" is
  computed there, never from the server clock.
- The migration seeds `lab_hours` from the current "9AM–9PM" for all 7 days, so nothing
  changes visibly until an admin edits the hours.
- `siteConfig.labHours` stays as the fallback when both tables are empty.
- `kiosk_features` rows are pins that jump ahead of the daily shuffle. A pinned item that
  is later unpublished simply drops out, because the loader joins on published rows only.
- None of the three tables is mirrored to Notion (`MIRROR_ENTITY` is unchanged).

### 4.3 Actions (phase 2, per the GUI-parity spec §3.2)

| Action id | Tool name | Permission | Risk | Assistant | MCP |
|---|---|---|---|---|---|
| `lab.set_hours` | `set_lab_hours` | `tools.edit` | `catalog` | propose | propose |
| `lab.add_closure` | `add_lab_closure` | `tools.edit` | `catalog` | propose | propose |
| `lab.remove_closure` | `remove_lab_closure` | `tools.edit` | `catalog` | propose | propose |
| `kiosk.pin_featured` / `kiosk.unpin_featured` | `pin_featured` / `unpin_featured` | `tools.edit` | `catalog` | propose | propose |
| `kiosk.create_display` (phase 3) | — | `users.manage` | `people` | **never**: it reveals a token, and a secret never enters a model's context (parity spec §2) | never |
| `kiosk.revoke_display` (phase 3) | `revoke_kiosk_display` | `users.manage` | `destructive` | propose (typed name) | never |

`risk: "catalog"` fits these actions because each one changes what a public surface
shows. `tools.edit` is the SuperMaker's day-to-day permission, and the hours are day-to-day.

## 5. Behavior / flow

### 5.1 Setting up a screen

1. Staff open `https://<site>/kiosk` on the TV's browser or the iPad.
2. On the iPad: Add to Home Screen, turn on Guided Access, and set Auto-Lock to Never. The
   page also asks for a Screen Wake Lock where the browser supports it, and re-asks on
   `visibilitychange`.
3. The page renders its first snapshot on the server, so the screen is never blank.

### 5.2 Refresh loop

- `KioskScreen` calls `GET /api/kiosk` every **60 s** plus up to 10 s of jitter, so ten
  screens do not poll in step.
- On success the page swaps in the new snapshot. The featured rotation keeps its position,
  and one item shows for 20 s at a time.
- On failure or a non-200 response, the page keeps the last good snapshot and backs off:
  60 s, then 2 min, then 5 min at most.
- The page reloads itself once a day at 04:00 lab time, so a deploy reaches the screen
  without anyone touching it. The reload is skipped when the last fetch failed, since
  reloading while offline would blank the screen.

### 5.3 Stale and offline

`derive.ts` exports `staleness(generatedAt, now, online)`, which returns
`"fresh" | "stale" | "offline"`:

- **Fresh** (under 3 minutes old). The footer shows "Updated 14:02".
- **Stale** (3 minutes or older). An amber bar reads "Can't reach the server — showing
  14:02". The bar uses the warning token, not colour alone.
- **Offline** (`navigator.onLine === false`). The same bar, with "Offline".
- **Ticket count unread.** If the count could not be read (`tickets: null`), the tile shows
  "—" and "Not available". It never shows 0.
- **Database down on first render.** The page renders "Lab status is unavailable right
  now" with the QR code, because the QR code needs no data.

### 5.4 From the QR code to the phone

`/?src=kiosk&ask=1` opens the home page with the chat launcher open. This is
presentation only, the same rule as `?src=qr` in `QrArrivalNotice.tsx`. The QR code
labels open the assistant on a tool page. The kiosk opens it on the catalogue, because
the viewer is not standing at a particular machine. From there the phone chat is the normal
anonymous chat, with its existing tier (`chatTierFor("anonymous")`). The `src=kiosk`
parameter is what makes kiosk scans countable in Vercel Analytics.

### 5.5 Burn-in

- Every 5 minutes the whole layout moves by up to 8 px in x and y, cycling through a fixed
  set of offsets, with a 2 s ease.
- No element is pure white. Large type uses the dark theme's `--foreground`.
- The clock and the "Updated" line are the only fixed text. They are small and drift with
  the layout.
- Phase 2: outside lab hours the screen dims to a minimal "Closed — opens 9:00" view that
  drifts faster, with the QR code still shown.
- Phase 1 cannot know the hours, so it does not dim.

## 6. UI

**Layout (landscape, 1920×1080 design size, scales with `clamp()`):**

- Top bar: logo from `siteConfig.logo`, lab name, a large clock, and the hours. (Since
  2026-10-06 the logo is the official Cornell Tech MakerLAB one, `clamp(36px, 7vmin, 150px)`
  tall: identity spec, amendment "The official Cornell Tech MakerLAB logo".)
- Left two-thirds:
  - **Down machines.** A grid of cards with image, name and "1 of 2 down". When nothing is
    down: "All machines running", with a count of machines.
  - **Open tickets**, as one large number.
- Right third:
  - The **QR code**, with "Ask the assistant on your phone".
  - Below it, the **featured panel**: an image, a name, and a line of text.
- **Portrait (iPad upright).** The same panels stacked, with the QR code at the bottom.
  Designed at 810×1080, with no horizontal scroll.
- **States.** Loading uses `loading.tsx` (dark). Empty is "All machines running". Stale and
  offline show the bar. Error shows the unavailable message with the QR code. Demo data
  shows the chip.
- **Motion.** `prefers-reduced-motion` turns the featured rotation into a cut with no
  crossfade. It keeps the pixel shift, because the shift is too slow to read as motion.
- **Strings.** A new `kiosk` namespace in `messages/en.json`, with the other locales
  falling back to English (Article 6). The kiosk renders in the default locale, with
  `?lang=` as an override for the booth.

**Admin IA (phase 2).** A new surface, **Lab display** (`/admin/display`):

- **Placement.** Group `settings` in `ADMIN_SURFACES` (`src/lib/admin/surfaces.ts`), after
  People and the Notion mirror.
- **Permission.** `tools.edit`.
- **Tile.** It shows "Open now" or "Closed" and the number of upcoming closures.
- **Page.** A weekly hours editor, a closures list, pinned featured items, a live preview in
  a 16:9 frame, and "Open kiosk" and "Copy link".
- **Loading.** It has a `loading.tsx`, per the loading-boundaries test.
- **Phase 3.** A "Displays" section on the same page, visible only to `users.manage`.

## 7. Relationship to existing work

- **Assistant GUI parity (#91, draft).** Every phase-2 write is a registered action (§4.3),
  and none is a bare server action. If #91's phase 1 has not merged when phase 2 starts,
  phase 2 waits. Phase 1 has no writes, so it does not depend on #91.
- **QR codes (implemented).** This reuses the `qrcode` dependency and the "presentation
  only" `src=` convention.
- **UI system spec.** Uses its dark tokens. The kiosk is a separate full-bleed layout, not a
  variant of the catalogue.
- **Projects gallery.** The featured panel reads `listPublishedProjects()`, so moderation
  stays the gate.
- **`get_lab_status` (phase 2).** A `read` capability in `src/lib/capabilities/catalog.ts`.
  It returns `openNow`, today's hours, the next closure and the down machines, from the same
  loader. It answers "is the lab open Sunday?" and "is the laser cutter working?" on chat
  and MCP. It grounds the answers the assistant can only guess today.

## 8. Security and safety

- **Authorization.**
  - **Phases 1–2.** `/kiosk` and `/api/kiosk` are public, like `/` and `/tools/[id]`. Both
    read only published catalogue data and aggregate counts. No cookie is read and none is
    set.
  - **Phase 3 (only if Q2 says yes).** A display gets a random 32-byte token, which is shown
    once and stored as a SHA-256 hash in `kiosk_displays`. The token goes in the URL
    fragment (`/kiosk#k=…`), so it never reaches logs or referrers. The client sends it as a
    header, and the extra fields are served only with a valid, unrevoked token.
    `last_seen_at` records the display's heartbeat.
- **Rate limiting (Article 4).** A new tier, `ROUTE_TIERS.kiosk` at 20 requests a minute per
  IP (`getClientIp`), checked before the loader. The booth shares one IP across the screen
  and every phone, but the phones call `/api/chat`, not `/api/kiosk`.
- **External calls.** None. There are no model calls, and Blob images are served through
  `next/image` as the catalogue does.
- **Write safety.** Phase 1 has no writes. From phase 2 on, writes are actions: drafts are not
  relevant here, but every write is confirmed by a person holding `tools.edit`, and an
  assistant write is always a proposal card (parity spec §3.5).
- **Untrusted input.** The only student text on the screen is published project titles,
  which pass moderation. React escapes them, and they are clamped to two lines.
- **PII.** The type has no field for a name or email (§3.2). The loader selects columns
  explicitly, never `select *`. The open-ticket query selects only counts. The QR URL
  carries no identifier.
- **The public screen.** A screen in the lab is seen by anyone in the room, and the
  booth's by anyone at ISAM. Everything it shows is already visible to an anonymous
  visitor of the catalogue. The one addition is the open-ticket count, and the owner
  confirms it (Q1).

## 9. Phased build order

| Phase | Scope | Acceptance |
|---|---|---|
| **1 — Booth-ready** (merge by Thu 8 Oct) | `/kiosk` and `/api/kiosk`, the snapshot loader, down machines, ticket count, hours from `siteConfig.labHours`, daily featured rotation, QR code, `?src=kiosk&ask=1` opens chat, stale bar, burn-in shift, wake lock, `kiosk` tier, `invalidateMaintenance()`, `ChatFab` and `GlobalChrome` excluded | On the demo seed, `/kiosk` renders with no sign-in. Marking a unit `under_maintenance` in `/admin/inventory` shows it within 60 s, and filing a ticket raises the count within 60 s. With the network off, the page keeps its data and shows the offline bar within 3 min. A phone scanning the QR code from 3 m lands in an open chat. The payload test (§10) passes. Dry run on the booth iPad for 2 h with Guided Access |
| **2 — Hours, pins, lab status** | Migration `00NN`, the `lab.*` and `kiosk.*pin*` actions, `/admin/display`, dimming outside hours, `get_lab_status` | The owner edits the hours in the GUI, and the kiosk and header update on the next poll. "Close the lab Friday for ISAM setup" in chat gives an `add_lab_closure` card, and nothing changes until Confirm. A student has no such tool. `get_lab_status` answers "open Sunday?" from the data |
| **3 — Signed displays** (only if Q2 = yes) | `kiosk_displays`, create and revoke on `/admin/display`, the token header, and the approved extra fields | Without a token, the payload is identical to phase 2. A revoked token loses the extra fields on the next poll |

Phase 1 is independent of every in-flight branch. Phase 2's admin page and its actions can
be built in parallel once #91's phase 1 has landed.

## 10. Testing

Four layers, all offline (Article 3).

- **Unit (`derive.test.ts`, `qr.test.ts`, `snapshot.test.ts` on PGlite):**
  - down-machine grouping: retired units excluded; one of two units down reads "1 of 2";
    all units down reads as down; `in_use` is not down;
  - the featured shuffle is stable for a lab-timezone day and changes the next day, with a
    21:00 New York case that is already the next day in UTC;
  - `staleness()` at the boundaries;
  - the QR SVG decodes to `askUrl`, checked with a decoder in the test only;
  - phase 2: `openNow` across midnight, DST days and closure overrides.
- **Integration (`/api/kiosk`):**
  - 200 with the snapshot shape;
  - 429 past the tier, checked before any query;
  - a failing database gives 503 and never a zeroed snapshot;
  - **the privacy case:** seed a ticket whose description is
    "Casey (casey@cornell.edu) jammed it", a user with a title, and a draft tool. The
    serialized payload contains none of `@`, `casey`, `reported`, `description`, or the
    draft's name. This is the test that would embarrass us.
- **Component (`KioskScreen.test.tsx`):**
  - fresh, stale, offline, ticket-count-unread, empty and demo states;
  - polling with fake timers keeps the last snapshot on a failed fetch, and backs off;
  - rotation with `prefers-reduced-motion`.
- **E2E (`e2e/kiosk.spec.ts`):**
  - `/kiosk` on the demo seed, with no chat FAB and no global header;
  - landscape and portrait viewports with no horizontal scroll;
  - a unit status change in `/admin/inventory` appears after one poll, with the clock
    advanced;
  - `/?src=kiosk&ask=1` opens the chat dialog.
- **Evals (phase 2, `evals/cases/lab-status.yaml`, on demand, never gating):**

  | Case | As | Expect |
  |---|---|---|
  | `lab-open-sunday` | anonymous | `get_lab_status`; the answer matches the seeded hours |
  | `laser-working` | anonymous | `get_lab_status` or `get_tool`; says it is down when seeded down |
  | `close-friday` | staff | `add_lab_closure` proposed; not claimed done |
  | `student-close-lab` | student | no action tool; says staff do this |

## 11. Cost

- **Phase 1.** No model calls.
- **Polling.** One screen polling every minute is about 1,440 small function invocations a
  day, all but a few served from cache. That is well inside Vercel's included usage.
- **Neon.** Queried only on invalidation or every 5 minutes.
- **Booth phones.** Chat from the QR code costs what any anonymous chat costs. At an
  estimated 100–200 booth conversations, the owner may want the budget checked before
  11 Oct (Q5).
- **Phase 2.** `get_lab_status` adds one small read tool, which barely changes the tool
  prompt.

## 12. Risks

- **The iPad sleeps or leaves the page.** Mitigated by Guided Access with Auto-Lock set to
  Never, and by wake lock where supported. The dry run is part of phase 1's acceptance.
- **Booth Wi-Fi.** Mitigated by the in-page snapshot and the stale bar. The screen stays
  useful offline because the QR code still works on the phone's own data.
- **The count looks alarming.** "7 open tickets" on a public screen may read as neglect. The
  tile can show "3 being worked on" beside the count, and Q1 lets the owner hide it.
- **Down-machine staleness.** The screen is only as current as `units.status`. If staff do
  not flip units when a machine breaks, the screen confidently says "all running". The
  remedy is a separate spec on recurring and preventive maintenance and on tickets that set
  a unit's status. This spec does not fix it.
- **Scope creep toward a touch kiosk.** Rejected in §2. The phone is the interactive surface.

## 13. Open questions

| # | Question | Recommendation | Who | Blocks |
|---|---|---|---|---|
| 1 | Show the **open-ticket count** on a public screen, including at the ISAM booth? | **Answered (Isaac, 2026-09-27): yes**, in the lab and at the booth | Isaac + Luis | Phase 1 |
| 2 | Will any screen ever show **non-public** data, such as ticket titles, who is on shift, or the intake queue? | No for now. Build phase 3 only when a concrete need appears | Isaac | Phase 3 |
| 3 | Show **project author names** in the featured panel? The public gallery shows them, but a booth is a wider audience | **Answered (Isaac, 2026-09-27): yes, first name and last initial** (e.g. "Maya R.") | Isaac + Niti | Phase 1 |
| 4 | At the booth, run against **production** (live lab status) or a **demo seed** deployment? | **Answered (Isaac, 2026-09-27): production (live data)** — the same kiosk stands at the front of the MakerLab | Isaac | Phase 1 |
| 5 | Cap the **booth's chat spend**, or rely on the anonymous tier? | Check AI Gateway spend on 9 Oct and decide then. No code | Isaac | — |
| 6 | Who may **edit hours and pins**: `tools.edit` (SuperMakers) or directors only? | `tools.edit`. Hours are day-to-day | Isaac | Phase 2 |
| 7 | Does the QR code open the **catalogue with chat**, or a dedicated `/ask` page sized for phones? | Catalogue with chat for phase 1. Revisit after seeing booth behaviour | Isaac | — |

Q1, Q3 and Q4 are answered; phase 1 is unblocked. The rest travel with the spec.
