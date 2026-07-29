# QR Codes on Machines — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
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
