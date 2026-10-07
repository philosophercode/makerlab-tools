# QR Codes on Machines — Design Spec

**Date:** 2026-07-29
**Status:** Implemented — `npm run qr:labels` (status audit 2026-09-27, [`README.md`](README.md)); amended 2026-09-29, "QR labels in the app" (§12); amended 2026-10-06, "Unit labels and reporting from a unit" (§13) and "The lab's official logo on the labels" (§14)
**Target:** `v5/`
**Branch:** `v5/qr-labels`

## 1. Summary

A student standing at a jammed printer has a phone in their hand and no idea this app
exists. A sticker on the machine closes that gap: scan it, land on that machine's page with
the assistant already primed to help with *this* machine.

This is the shortest path from a physical problem to the system that solves it, and it is
the entry point the app currently lacks entirely — everything today assumes someone
navigates to a website and searches for the thing standing in front of them.

**The key simplification over v4: there is no scanner.** v4 shipped an in-app QR reader
(`html5-qrcode`, a camera permission, a scan page). None of that is needed. Every phone
camera reads QR codes natively and opens URLs. A QR code that encodes a normal tool URL
needs **zero client-side code** — the entire feature is generating labels and a small
change to how the page behaves when someone arrives from one.

## 2. Goals / Non-goals

### Goals

- Scanning a code on a machine opens that machine's page.
- Arriving from a code makes the assistant obviously available for *that* machine.
- Staff can print labels for the whole catalogue without a developer.
- Labels survive a workshop — readable at arm's length, resistant to being scuffed.
- Scans are distinguishable from other traffic, so the lab can tell whether anyone uses it.

### Non-goals (this iteration)

- **No in-app scanner.** Phone cameras do this. Shipping one means a camera permission
  prompt, a dependency, and a worse experience than the OS provides.
- **No per-unit codes.** Codes point at the *tool*, not the individual machine. Per-unit
  codes double the label count and the maintenance burden for a benefit — "this exact
  Prusa" — that the assistant can resolve by asking. *Superseded 2026-10-06 (§13):
  reporting against a unit is the main reason anyone scans, so units get labels too;
  the tool label stays.*
- **No NFC.** Cheaper to say no than to explain why the tags stopped working.
- **No dynamic redirects or short links.** A code encoding the real URL has no service to
  keep running. If URLs change, the labels are wrong — accepted, because tool IDs are Notion
  page IDs and are stable.
- **No analytics dashboard.** A query parameter that shows up in existing traffic data is
  enough to answer "is anyone scanning these?"

## 3. Architecture

Three small pieces. No new dependencies at runtime.

```
scripts/generate-qr-labels.ts        # NEW — reads the catalogue, emits a printable sheet
src/app/tools/[id]/page.tsx          # CHANGED — reads ?src=qr
src/components/ChatLauncherContext   # CHANGED — surfaces the assistant on QR arrival
```

**Label generation is a script, not a route.** Printing labels is something that happens a
few times a year, in bulk, and does not need to be a live page competing for attention in
the app. The script fetches the published catalogue, renders an HTML sheet of labels sized
for standard sticker stock, and writes it to a file. Staff open it and print.

QR encoding uses a small library at build time only (`qrcode`), added as a **devDependency**
— it never ships to the browser.

**The URL is just the tool page** with a marker:

```
https://<site>/tools/<notion-page-id>?src=qr
```

`?src=qr` does two things: it appears in existing traffic data so the lab can see whether
scanning happens, and it tells the page it was reached from a machine.

## 4. Data model

None. Tool IDs already exist and are stable Notion page IDs.

## 5. Behavior / flow

**Scanning.** Phone camera → notification → tool page. No app, no account, no permission
prompt.

**On arrival with `?src=qr`.** The page is the normal tool page, with one difference: the
assistant is surfaced rather than hidden behind a button, seeded with context for this
machine. Someone who scanned a code at a machine is overwhelmingly likely to have a question
about that machine.

**Recommend surfacing, not auto-opening.** An assistant panel that opens by itself over the
specs someone came to read is an interruption. Make it prominent and pre-seeded; let them
tap. *Worth testing both on real students before deciding — flagged in §11.*

**Printing labels.**

```bash
npm run qr:labels          # writes qr-labels.html
```

Open, print onto sticker stock, cut, apply. The sheet includes the machine name and location
under each code, so a label that gets scuffed is still identifiable by a human.

**A retired machine's code.** Points at a tool page that returns 404. Acceptable — someone
scanning a code on a machine that no longer exists learns exactly that.

## 6. UI

**The label** (print stylesheet, black on white, no colour):

```
┌─────────────────────┐
│   ▄▄▄▄▄  ▄ ▄▄▄▄▄    │
│   █ ▄ █  ▀ █ ▄ █    │   ← QR, ≥25 mm square
│   █▄▄▄█ ▀▄ █▄▄▄█    │
│                     │
│  BAMBU LAB X1-CARBON│   ← machine name
│  Main Lab / Print   │   ← location
│  Scan for help ↑    │
└─────────────────────┘
```

Minimum 25 mm square with a quiet zone, high error correction (level H) so a scuffed or
partly obscured code still reads — these live on machines that get knocked and wiped down.

**On the tool page**, arriving from a code: the assistant is visibly available with a prompt
like "Ask about this machine," in the existing technical-schematic style. New strings go
through `next-intl`, all 12 locales.

## 7. Relationship to existing work

- **v4 had this** (`src/app/scan/`, `html5-qrcode`, `scripts/qr_codes/`). Do not port it —
  the scanner is the part worth dropping.
- Independent of every other spec. Can ship any time.
- Pairs well with the ISAM demo: visitors scanning a real machine is a far better
  demonstration than a URL on a slide.

## 8. Security and safety

- **No new endpoints, no new input.** Codes encode URLs the site already serves.
- `?src=qr` is a marker only — it must never alter what data is shown, only presentation.
- Labels are public information; a QR code on a machine reveals nothing not already on the
  public catalogue.
- **Physical risk worth noting:** a printed code is trivially replaceable by someone with a
  sticker printer. The realistic mitigation is that labels carry a visible machine name and
  location, so a substituted code is noticeable. Not worth engineering further for a lab
  tool.

## 9. Phased build order

1. **`?src=qr` handling** on the tool page + the surfaced assistant. Ships alone and is
   testable without a single label.
2. **Label generation script** + `npm run qr:labels`.
3. **Print one test sheet**, scan from a realistic distance, in the lab's actual lighting,
   before printing a hundred.
4. **Roll out** to the catalogue.

Step 3 is not optional. Label size and contrast are the things that go wrong, and they go
wrong after you have printed everything.

## 10. Testing

- **Unit** — label data derivation: name, location, and URL for a tool; tools with missing
  location degrade rather than throw; unpublished tools are excluded.
- **Integration** — the script produces a sheet for the mock catalogue with the expected
  number of labels.
- **Component** — the tool page surfaces the assistant when `?src=qr` is present and does
  not when it is absent.
- **E2E** — navigating to `/tools/<id>?src=qr` shows the machine's page with the assistant
  available.
- **Manual** — actually scan a printed label with an iPhone and an Android, from about a
  metre.

**Cases that would embarrass us**: a label whose code does not resolve; `?src=qr` changing
what data is displayed; labels printed at a size that will not scan.

## 11. Open questions

1. **Auto-open the assistant, or surface it?** Recommend surfacing. Worth watching two or
   three students scan a code before deciding — this is cheap to test and easy to change.
2. **Sticker stock and printer?** Determines label dimensions, so it needs answering before
   the script's layout is fixed. *Ask the lab — they almost certainly already have a
   labelling convention.*
3. **Label every machine, or start with the ten most-used?** A partial rollout tests whether
   anyone scans before committing to a hundred labels.

## 12. Amendment 2026-09-29 — QR labels in the app

Owner request: staff add inventory, print a code for that device and tape it on the laser
cutter; anybody who sees it scans it and lands on that tool's page. §3's "label generation is
a script, not a route" is superseded: printing moves into the app, beside the inventory, so it
no longer needs a developer. The script stays (`npm run qr:labels`, now also `--pdf`).

**One URL format, one module.** `src/lib/qr/urls.ts` owns `?src=qr` and
`toolQrTargetUrl(origin, slug)` = `<origin>/tools/<slug>?src=qr` — the format §3 printed and
`QrArrivalNotice` reads. The script, the arrival notice, the admin sheets, the tool page's
dialog, the image route and the assistant all import it, so old and new labels behave the
same. The origin is `qrSiteUrl()` (`lib/qr/site-url.ts`): `NEXT_PUBLIC_SITE_URL`, else
`https://${VERCEL_PROJECT_PRODUCTION_URL}`, else `https://makerlab-ai.vercel.app` — the
production site, never the request's host, because a label outlives any preview deployment.

**Admin: `/admin/inventory/qr` ("QR labels", `tools.edit`).** Linked from the inventory's
header. Published tools only (a draft has no public page to open), with search, a category
facet, row checkboxes, the header box for "select all shown", and **Select all** / **Select
filtered**. A styler with a live preview: square presets 1″, 1.5″, 2″ (default), 3″ or a
custom width × height in inches or millimetres; the tool name, location, an extra line
(default "Scan for manual & help"), the MakerLAB wordmark and the short address, each
switchable; paper US Letter (default), A4, or **one label per page** at the label's own size
for a label printer; margin, gap and light dashed cut guides. **Print this one**, **Print
selected**, **Print all** build the PDF in the browser (`pdf-lib`, loaded on the first click)
and open the print dialog in one click (a hidden frame; where a browser refuses to print a
framed PDF it opens in a tab); **Download PDF**, and the previewed label as an SVG (physical
size in mm, wordmark inlined) or a 300 dpi PNG. The style is remembered per browser in
`localStorage` (try/catch; no table — a style is a printing preference, not a record).
Printing writes nothing, so there is no server action and no audit event.

**Layout** (`lib/qr/label-layout.ts`, pure, millimetres): the code takes what the text
leaves; under 45 % of the label's short side, text is dropped (address, location, extra line,
wordmark — never the name) and the styler says so. A code under 25 mm (§6's floor) is drawn
at error correction **M** (fewer, larger modules) and the styler warns; from 25 mm up it is
**H**. A label at least 1.4 times as wide as tall puts the text beside the code. The sheet
packs as many columns and rows as fit inside the margins with the gap between, centred;
e.g. with 10 mm margins and 4 mm gaps, 2″ labels are 12 per Letter page and 15 per A4. Type
is Helvetica (a standard PDF font; the preview measures with its real metrics), so the PDF
prints at the size the styler says when printed at 100 %.

**Tool page.** A quiet **QR code & share** control beside "Report a correction" opens a
dialog: the code, **Download PNG** / **Download SVG**, **Copy link** (the plain page address)
and, where the browser has a share sheet, **Share** (the PNG as a file where files can be
shared, else the link). Published pages only; nothing asks who is looking, so the page stays
cached.

**`GET /api/qr/[slug]?format=svg|png&size=&download=1`.** Public, published tools only (a
draft, an archived tool and an unknown slug are one 404), rate-limited per hashed IP
(`ROUTE_TIERS.qr`, 60/min, no cookie read), `Cache-Control: public, max-age=3600,
s-maxage=86400, stale-while-revalidate=604800`. SVG by default; PNG 128–2048 px (whole-pixel
modules, so at most the asked size and within one module of it); `download=1` answers as an
attachment `<slug>-qr.<ext>`.

**Assistant: `get_tool_qr_code`** (`lib/capabilities/qr.ts`). "Can I have a QR code for this
device?" — a read, offered to everybody including anonymous visitors, chat only (over MCP the
image is one GET of the route). It resolves a published tool by id, slug or name, or the tool
whose page the person is on, and writes a `data-tool-qr` part the chat draws as the code with
Download PNG / SVG links (`ToolQrCard`). It is not a proposal and returns only catalogue data,
so the confirmation card and the taint rules do not apply. Eval case `qr-code-calls-tool`.

**Tests.** `lib/qr/*.test.ts` (URL format against the script's, layout and packing per preset
and paper, the PDF read back with `pdf-lib`, settings storage), `app/api/qr/[slug]/route.test.ts`,
`capabilities/qr.test.ts`, `app/admin/inventory/qr/page.test.tsx` (the gate),
`components/admin/qr/QrLabelStudio.test.tsx`, `components/tool/ToolQrButton.test.tsx`,
`components/chat/ToolQrCard.test.tsx`.

**Codes in chat photos** (owner follow-up, same day). A person who photographs a machine's
label and asks the assistant about it gets an answer about that machine: the chat route reads
QR codes in the turn's photos on the server (`jsqr` over `sharp`-decoded pixels, a few sizes,
time-bounded, never failing the turn) and, when a code is one of our tool links (our hosts,
`/tools/<slug>` with or without `?src=qr`, a tool id or a legacy Notion id), adds a hint
naming the published tool — `[QR code in photo "IMG_2041.jpg": links to tool
trotec-speedy-400 ("Trotec Speedy 400")]` — in a prompt section that tells the model to treat
it as identified. A draft's or unknown slug's code says only "not published"; any other link
is "an external site" and any other payload is dropped. Decoded text never reaches the prompt.

**Size defaults** (owner decision). The 1″ preset, and a custom size whose code would fall
under 25 mm, start with the wordmark and the extra line off; either can be switched back on.

**Still open.** §11.2 (sticker stock) is now a setting rather than a blocker; print one sheet
and scan it in the lab before cutting a hundred (§9 step 3 still applies).

## 13. Amendment 2026-10-06 — Unit labels and reporting from a unit

Owner meeting 2026-10-06 (Niti, Luis, Isaac): reporting an issue is the main reason anyone
scans a machine, and a report should land on the exact unit — "Prusa #4", not "a Prusa".
§2's "no per-unit codes" is superseded. Each physical unit can have its own label beside the
tool's; the tool label is unchanged and keeps working.

**One URL format, still the tool page.** A unit's code is the tool's code with the unit named:

```
https://<site>/tools/<slug>?src=qr&unit=<token>
```

`unitQrTargetUrl(origin, slug, unitId)` in `lib/qr/urls.ts`, beside `toolQrTargetUrl`. No new
route: a unit label works wherever the tool label does, and a legacy-id redirect keeps the
query. The `<token>` is the first eight hex characters of the unit's uuid (`unitQrToken`).
Unit ids are stable (a rename keeps the row), so the label stays right when a unit is
relabelled. The token is short on purpose: a full uuid adds 28 characters and two QR versions,
so smaller modules on a sticker that gets scuffed. It is resolved **only among that tool's own
units** (`unitForToken`), never across the catalogue; a token that matches none of them, or
two (about one in four billion per pair), names no unit and the page behaves as for the tool
label. `parseUnitToken` accepts the token, a longer prefix or a whole uuid, and nothing else,
so a hand-made link with the full id works and nothing else reaches a lookup.

**The tool page** (`QrArrivalNotice`). When `?unit=` names one of the tool's units (with or
without `?src=qr`, so a shared link works too), the notice leads with that unit: its name, "A
unit of the <tool>", its status glyph, and **Report a problem with this unit** as the primary
action, with **Ask about this machine** beside it. The unit list is already on the cached
page, so this reads nothing new and stays a dynamic hole; like `?src=qr`, `?unit=` changes
presentation only. A tool's label now offers **Report a problem** as well (secondary to Ask).
Nothing auto-opens (§5, §11.1).

**The report form is the assistant.** There is no separate report form: reporting has always
been the chat's `report_issue` (the header's Report button opens it the same way). Report a
problem with this unit opens the chat with the report already started — "I'd like to report a
problem with Prusa MK3S+ #4 (Prusa i3 MK3S+)." — on the tool's page, so the unit is
preselected by name and the ticket is linked to it. Two fixes make that exact:

- `findUnit` (`capabilities/helpers.ts`) resolves a **unit id** exactly, and with
  `preferToolId` searches the units of the tool on screen first. `report_issue`,
  `get_unit_details` and `get_maintenance_history` pass the chat's focused tool, so a label
  two tools share ("Station 1", "#2") resolves to the machine in front of the person rather
  than the first in the catalogue. Before this, a shared label could file against another
  tool's unit.
- `report_issue`'s `unit_label` may be the unit's id; its description says so.

**Codes in chat photos.** `qrTarget` (`lib/qr/match.ts`) returns the `?unit=` token beside the
tool's slug. `photoQrHints` looks the token up among that published tool's units and, when it
names one, the hint names the unit and its id from the catalogue —
`[QR code in photo "IMG_2050.jpg": links to unit "Prusa MK3S+ #4" (unit id 194e4406-…) of
tool prusa-i3-mk3s ("Prusa i3 MK3S+")]` — and the section tells the model to pass that id as
`unit_label` when it files a ticket. An unknown token gives the tool's hint. As before, a
decoded payload never reaches the prompt: the unit's name and id come from our database.

**Admin: unit labels in the studio.** `/admin/inventory/qr` gains **Tools (n) / Units (n)**
above the list. Units lists every unit of every published tool — retired units left out, the
same list Log completed maintenance offers (`listToolUnitOptions`) — with the tool in the
second column, the same search, category facet, selection and print actions. A unit's label
is the tool's label with one more line: the tool's name on one line (shrunk, then shortened,
to fit) and the unit's name under it in bold, in the room a second name line takes on a tool
label, so a 2″ unit label keeps its code above the 25 mm floor (26 mm with the defaults). The
unit line follows the name switch and is never dropped for room. A unit named exactly like
its tool ("Trotec Speedy 400") is not printed twice. The address under the code is the tool's
(`displayUrl` drops the query). Files are named `<slug>-<token>-label.svg|png`, the sheet
`qr-unit-labels.pdf`. The style is shared with tool labels. Printing still writes nothing.

**Unchanged.** `/api/qr/[slug]`, the tool page's QR dialog, `get_tool_qr_code` and the label
script stay tool-only; a unit's code is printed from the studio.

**Tests.** `lib/qr/urls.test.ts` (format, token, parsing, resolution among a tool's units),
`lib/qr/label-layout.test.ts` (unit content, the unit line, the 2″ floor, the same code size
for a long name, never dropped, no duplicate), `lib/qr/match.test.ts`,
`lib/chat/photo-qr.test.ts` (a real photo of a unit label resolves to the unit; an unknown or
another tool's token gives the tool), `capabilities/helpers.test.ts` and
`capabilities/maintenance.test.ts` (unit id, focused tool), `app/tools/[id]/QrArrivalNotice.test.tsx`,
`components/admin/qr/QrLabelStudio.test.tsx`, `app/admin/inventory/qr/page.test.tsx` (units
handed down, retired ones not).

**Open.**

1. **The extra line on a unit label.** It is shared with tool labels ("Scan for manual &
   help"). "Scan to report a problem" may suit unit labels better; a per-kind default is a
   small change once the lab picks the wording.
2. **A form instead of the chat.** If a direct report form (title, details, priority, photo,
   unit preselected) is wanted beside the assistant, it is a new public write: it needs the
   action layer's parity entry, the anonymous ticket limit and the same bounds as
   `report_issue`. Not built here.
3. **Units on the tool page itself.** The units table could carry a Report button per row
   for people who did not scan. Not built here, to keep this change to the scan path.
4. **Print and scan a unit sheet in the lab** before labelling every machine (§9 step 3).

## 14. Amendment 2026-10-06 — The lab's official logo on the labels

The MakerLAB wordmark on a label (§12's styler, the PDF, the label SVG and PNG,
`npm run qr:labels -- --pdf`) is now the lab's official logo: the Cornell seal
beside "CORNELL TECH" over "MakerLAB" (identity spec, amendment "The official
Cornell Tech MakerLAB logo"). The label draws its PNG, `siteConfig.logoPng`,
because `pdf-lib` embeds PNG and not SVG.

- **Same height, so no code got smaller.** The logo is drawn at the height the
  wordmark had on every preset (`typeScale`: 3.6 mm on 2″, 2.7 mm on 1.5″,
  5.3 mm on 3″), at its own proportions (`BRAND_ASPECT`, 277.68 × 76.13, so
  13 mm wide on 2″ where the wordmark was 21 mm). The default 2″ code stays
  25.4 mm, just over §6's floor; a taller logo would have pushed it under. At
  300 dpi "CORNELL TECH" and "MakerLAB" read on 2″ and 3″ labels and are small
  on 1.5″. Only a custom label over 78.6 mm on its short side draws the logo
  taller than before: the cap rose from 5.5 to 9 mm.
- **Unit labels** (§13) draw the same logo at the same height, so a 2″ unit
  label's code is unchanged (26 mm with the defaults, above the floor).
- **Labels for wide stickers** (text beside the code) size the logo from the
  label's height, as before. A 1″-tall one draws it 1.8 mm tall, too small to
  read its type. Owner's call whether to give that layout a taller logo; the
  room is there beside the code (open question below).
- **Fallback.** When the image cannot be read, or the file is not a PNG, the
  lab's name is written instead of failing the PDF, sized to fit the box.
- **Words.** The checkbox reads "MakerLAB logo" and the "not enough room" list
  says "the logo" (English; the other locales fall back to it, Article 6).
  The saved style keeps its `showBrand` key, so nobody's choice is lost.
- **Identifiers.** `wordmarkHref`, `wordmarkPng` and `wordmarkText` became
  `brandHref`, `brandPng` and `brandText`, matching the layout's `brand` box;
  `WORDMARK_ASPECT` became `BRAND_ASPECT`.
- **Tests.** `lib/qr/label-pdf.test.ts` (the logo embedded once per sheet; a
  file that is not a PNG still makes a PDF), `lib/qr/matrix.test.ts` (the
  label SVG names the logo's PNG; the fallback name fits its box),
  `components/admin/qr/QrLabelStudio.test.tsx` (the preview draws the logo),
  `app/admin/inventory/qr/page.test.tsx` (the page hands the studio the PNG).

**Still open.** Print one sheet of 2″ labels with the logo and check it in the
lab before printing a hundred. Decide whether wide side-by-side labels get a
taller logo.
