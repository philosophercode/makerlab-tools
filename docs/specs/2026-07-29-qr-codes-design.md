# QR Codes on Machines — Design Spec

**Date:** 2026-07-29
**Status:** Implemented — `npm run qr:labels` (status audit 2026-09-27, [`README.md`](README.md)); amended 2026-09-29, "QR labels in the app" (§12)
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
  Prusa" — that the assistant can resolve by asking.
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

**One URL format, one module.** `v5/src/lib/qr/urls.ts` owns `?src=qr` and
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
