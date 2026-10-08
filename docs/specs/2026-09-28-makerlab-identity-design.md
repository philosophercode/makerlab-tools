# MakerLAB Identity — Design Spec

**Date:** 2026-09-28
**Status:** Implemented
**Target:** `v5/`
**Branch:** `v5/makerlab-identity`

## 1. Summary

The MakerLAB's Director, Niti Parikh, asked for the site to carry the lab's own
identity, and the owner (Isaac Steinberg) decided how. Three names, used the
same way everywhere — UI copy, page titles and metadata, and the assistant's
description of itself:

| Name | Is |
|---|---|
| **MakerLAB** | The physical makerspace at Cornell Tech |
| **MakerLAB Tools** | This website (`siteConfig.name`) |
| **MakerLAB Assistant** | The AI inside it (`siteConfig.chatAssistantName`). Renamed **MakerLAB AI** on 2026-10-07, see the amendment "MakerLAB AI everywhere" |

The site's tagline is "Your digital guide to making at Cornell Tech"
(`siteConfig.tagline`).

## 2. Goals / Non-goals

### Goals

1. **Header.** Top left, the MakerLAB wordmark ("Maker" light, "LAB" bold) and
   under it "MakerLAB Tools" and the tagline, replacing
   "MAKERLAB TOOLS // CORNELL TECH". The wordmark is cropped from the lab's
   own logo (`public/makerlab-logo-transparent.png` →
   `public/makerlab-wordmark.png`, `NEXT_PUBLIC_WORDMARK`) and drawn as a CSS
   mask in the text colour, as the kiosk draws the full logo. (The full logo
   it was cropped from is retired; the header keeps the wordmark. See the
   amendment "The official Cornell Tech MakerLAB logo" below.) The nav links
   stay **centred** (the owner kept them there, over the mockup's move right).
   The wordmark is the mockup's size (amendment "Wordmark at the mockup's
   size" below).
2. **Home title.** Simply "Tools" (was "+ TOOLS // MACHINES"), in its own case,
   with no `+` glyph. The status strip under the header stays.
3. **Assistant button.** An assistant icon (lucide `BotMessageSquare`), labelled
   "Open the MakerLAB Assistant". On a first visit a small callout beside it —
   "Meet the MakerLAB Assistant — ask how to operate a machine, debug a
   problem, or plan a build" — with **Ask a question** and **Dismiss**. It
   shows once: on the first page it can, staying there until that page is
   left, and never again even if ignored; dismissing it or opening the chat by
   any route hides it at once, in every open tab (`storage` event). The admin
   and the kiosk do not use up the showing (`chat/assistant-intro-store.ts`,
   `localStorage` key `makerlab.assistant-intro.seen`, every access in
   try/catch; storage that throws counts as seen). Not a dialog: no focus taken, nothing blocked. The
   entrance animates only under `motion-safe`. Never on `/kiosk` or `/admin/*`.
4. **Starters.** The generic starter chips are one each for operate, debug and
   create, the word as a kicker: "How do I start a print on a 3D printer?",
   "My print is stringing — what should I check?", "I want to make a lamp —
   which machines could I use?". A tool page with its own researched starter
   questions keeps showing those (amendment "Tool-specific starter
   questions"). Examples, not a menu.
5. **Where you are.** A short static block in the chat system prompt
   (`src/lib/ai/lab-context.ts`, sources in its comments), right after the
   intro so it is in the cacheable prefix: what MakerLAB Tools and the
   Assistant are, the MakerLAB's purpose, location, spaces, history and
   people, the published hours by tier, Cornell Tech and Cornell basics, and
   the assistant's purpose — operate, debug, create — while following what
   people actually ask. For anything not stated there or in the catalog, and
   for safety, access and training sign-offs, it sends people to staff.
6. **About.** About the MakerLAB first, in the order of Cornell Tech's own
   MakerLAB page (what it is and its history; visit — address and hours, with
   the official page as the authority; people; community; learn more), then
   **Projects** (pointing to `/projects`) and **About this project** (MakerLAB
   Tools and the Assistant, operate / debug / create, credits), then the
   existing MCP pointer. Paraphrased, with links to the sources.

### Non-goals

- Translating the new copy: English is in `en.json`; other locales fall back
  to it (Article 6 as amended). Keys whose English meaning changed were
  removed from the other locales rather than left saying the old thing; the
  home title and the chat title were re-derived from their existing
  translations.
- The mirror's page name ("MakerLab Tools — mirror") and code identifiers
  (`MakerLabTool`, the `makerlab` MCP server name) are unchanged.

## 5. Facts and their sources

Only facts with a public source, or supplied by the owner, are stated. Public:
the MakerLAB page (https://tech.cornell.edu/research/makerlab/), the Cornell
Chronicle on the 2025 opening, Cornell Tech news and about pages, Cornell's
about page. Owner-supplied, with no public source: "near the building's
entrance"; Luis Rodrigo Navarro's title, Assistant Director (the public page
says "Luis Navarro, MakerLAB Manager"); MakerLAB Tools, the Assistant, Isaac
Steinberg's role and the operate / debug / create framing. Left out as
unconfirmed: floor area, room names, where the lab was before 2025, the Super
Maker process beyond "apply", and other access rules.

**Hours.** The official page lists 8 AM–8 PM for Access Holders, so the
`NEXT_PUBLIC_LAB_HOURS` default (the header's status strip and the kiosk) is
now `LAB OPEN 8AM-8PM` to match the About page and the assistant; the old
`9AM-9PM` came from the design mock. Open item: the owner confirms the hours,
and production's `NEXT_PUBLIC_LAB_HOURS`, if set, is updated to match.

## 10. Testing

- Component: the header lockup (`GlobalChrome.test.tsx`); the button, the
  callout (shows once and not on the next page, dismisses, remembered, other
  tabs, opening the chat counts, not on the kiosk or admin, storage that
  throws) and the three starters
  (`ChatFab.test.tsx`); the About page (`app/about/page.test.tsx`).
- Prompt: `chat-adapter.test.ts` — the block's facts, its place in the static
  prefix, and the absence of unconfirmed figures.
- Evals (paid, not in CI): `evals/cases/lab-identity.yaml` — where is the
  MakerLAB, who runs it, what can you help with, and not inventing its size.
- E2E: specs that asserted the old header, title and button text are updated.

## Amendment — Wordmark at the mockup's size (2026-09-28)

The owner: "The MakerLAB logo is off — check the original image." The first
cut drew the wordmark 95 × 16px; in the Director's mockup it is about a fifth
of a 1440px page (≈291 × 49px), with "MakerLAB Tools" (bold) and the tagline on
one line under it. Now (`--wordmark-height`, width from the crop's 1014 × 171):

| Width | Wordmark | Name / tagline | `--nav-height` |
|---|---|---|---|
| ≥ 1440 | 285 × 48 | 20px bold / 13px tagline | 96px |
| 1280–1439 | 237 × 40 | 20px bold | 88px |
| 1024–1279 | 190 × 32 | 20px bold | 80px |
| 561–1023 (compact bar) | 213 × 36 | 16px bold | 128px (min) |
| ≤ 560 | 178 × 30 | 15px bold | 120px (min) |

The bar is a three-column grid with equal outer columns, so the links stay
centred on the page (owner decision) whatever the brand and the controls
measure; the links and the controls sit on the wordmark's line, as in the
mockup. The one-row bar is exactly `--nav-height`, so the sticky status strip
and `--sticky-chrome-height` offsets follow. The steps down are set by the
longest translation of the links (Spanish) fitting with the scrollbar shown;
for the same reason the bar's gaps are tighter (24px, 16px below 1280) and the
search trigger is 144px from lg to xl (was 176). Tested in
`e2e/header-stability.spec.ts` (sizes, fit, centring).

## Amendment — Product page and quick start (2026-09-28)

The owner wanted a page to send the Director and Assistant Director: "like a
good consumer SaaS product page, showing all the big features with
screenshots (and a short video walkthrough if possible), plus a quick-start
guide: what's there, what to play with, how to use it, and what it costs."

- **`/product`** — hero ("MakerLAB AI" — the owner renamed the assistant for this page, 2026-09-28; the app-wide rename is a separate PR — **Try it** →
  `/tools/bambu-lab-x1-carbon-combo-3d-printer?ask=1`, the running example,
  with the chat opened by `AskParamOpener`; **Quick start** beside it), a
  49-second walkthrough (MP4 + WebM, `preload="none"`, poster, English
  captions, a text transcript), operate / debug / create with one real
  question and answer each, eleven feature sections with screenshots, **what
  it costs to run**, privacy and safety, credits. Costs are the measured unit
  costs and dated monthly estimates from the 2026-09-28 pricing memo — chat
  ≈ $0.0003 (≈ $0.002 with manual reranking), research $0.02–0.05 a tool,
  indexing a fraction of a cent (20 manuals / 1,136 pages cost $0.013), OCR
  ≤ $1 a manual, AI ≈ $10–15 and hosting ≈ $20–40 a month. **Never a
  subscription price** on this page: pricing is a separate decision.
- **`/product/quick-start`** — eight numbered steps with screenshots (open
  the site; ask the X1-Carbon "How do I start a print with the AMS?"; follow
  a citation; report a problem; staff: intake from a photo, People and
  titles, the kiosk; connect Claude or ChatGPT via `/mcp`) and things to try.
- **Linked from the About page and a new site footer** (`SiteFooter`: Product,
  Quick start, About, Connect an AI, the official MakerLAB page), not the main
  nav. The footer is drawn on every page but the kiosk (`SiteChrome`).
- **Static server components.** Words in `messages/en.json` under `product`
  and `footer` (other locales fall back to English, Article 6); facts that are
  not prose (screenshots, links, costs) in `app/product/product-content.ts`.
  Metadata, including the Open Graph card (`public/product/og.png`, 1200×630),
  is English, like `/about`'s.
- **Screenshots are real.** Captured 2026-09-28 at 2× in the light theme:
  public pages and the three pillar answers from the live site; staff screens
  (intake, value report, action card, map, People), the ticket and the manual
  citation from a local production build on the demo seed, captioned "Demo
  data". Each is AVIF + WebP at two widths under `public/product/`, drawn by
  `ProductShot` (`<picture>`, intrinsic size, lazy but the first screen).
  The capture scripts are not committed; re-capture after a visible UI change.
- **Found while capturing:** on the live site neither the X1-Carbon's searchable
  manual nor its attached quick start guide covers the AMS, so the quick start's
  own example question gets a "the manual doesn't cover this" answer. The
  pillar screenshot uses a question the guide answers ("What does the quick
  start guide say about the first print?"). Adding and indexing Bambu Lab's AMS
  documentation (`npm run manuals:index`) would fix the AMS answer.
- Tested in `app/product/page.test.tsx`, `app/product/quick-start/page.test.tsx`,
  `components/SiteFooter.test.tsx`, `app/about/page.test.tsx` and
  `e2e/product.spec.ts` (footer and About links, every image decodes, video and
  captions served, no sideways scroll on a phone, no footer on the kiosk).

## Amendment — Lab notes (2026-10-06)

On 2026-10-06 the Director (Niti Parikh) and the Assistant Director (Luis
Rodrigo Navarro) asked for hyper-local knowledge first: the lab's own protocol
for a tool ("Box cutter: always put a cutting mat underneath so you don't
scratch the table") and rules for the whole lab. No manual has them, and the
assistant should prefer them. They are **lab notes**.

**Reused, not a parallel system.**

- A tool's lab notes are **`tools.notes`** (data platform spec §4.4, imported
  from Notion's "Notes"). Research never reads it (refresh research's blind
  inputs) and `propose_change` does not offer it, so only staff write it.
  Renamed in the UI, not the schema.
- The **lab-wide notes** are one **`lab_settings`** row: key `lab_notes`,
  value `{ text }`, at most 4,000 characters (`lib/lab-notes/setting.ts`).
  Migration `0024`'s table takes a new key without a migration.
- Both are plain text, **one note per line**, read by one function
  (`labNoteLines`, `lib/lab-notes/lines.ts`): blank lines and typed list
  markers dropped, each line flattened to one line, at most 500 characters
  and 30 lines.

**Where they show.**

- **Tool editor**: the field is "Lab notes", right after Description, with a
  hint and a link to the lab-wide notes. It was "Notes", at the end.
- **Tool page**: a Lab notes block in the hero, under the status line and
  **above the description**, so the lab's word comes before the generic
  text. Labelled "From the lab's staff"; one note is a sentence, several are a
  list. Not tinted (Safety is the one tinted section) and not in the accent: an
  ink rule down its start edge (DESIGN.md §8.17). The Details "Notes" row is
  gone.
- **`/admin/inventory/lab-notes`**, "Lab notes" (`tools.edit`): a button
  beside QR labels on Inventory, not a new admin surface. The lab-wide notes'
  form (`lab.set_notes`, GUI only: parity spec amendment 2026-10-06), then
  every unarchived tool that has lab notes, drafts marked, each linking to its
  page.

**The assistant.**

- **Rules**, in the stable prompt right after "Where you are"
  (`lib/ai/lab-notes-prompt.ts`): read them first (call `get_tool_details`
  for a tool the catalog marks), give them first, and follow them over a
  manual, the manufacturer or general knowledge, keeping a manual's safety
  warning. Cite each one as **Lab note:**, with no link, and never as the
  manual. Never invent one. The rules' example is a placeholder, so the model
  has no real-sounding rule to repeat for a tool that has none.
- **Lab-wide notes** follow the rules in the stable prefix, one bullet each.
  They are the same for every request until staff save new ones, so the
  prefix cache still holds. Read cached with the catalogue
  (`getLabWideNotes`, tag `catalog`); a save drops the tag. A failed read
  leaves them out of that turn and logs it.
- **A tool's notes** come first in the focused tool's description (Active
  tool context). `get_tool_details` returns them as `lab_notes`, a list of
  lines; the key was `notes`, the raw text, and MCP clients see the rename
  too. The catalog list ends the line of a tool that has notes with
  "· lab notes", so the model knows to look; the notes themselves would cost
  every turn.
- **Citing sources** gains a fourth format: a lab note.
- **Starter answers** are made with the lab-wide notes too, and the grader's
  record carries them, so an answer that cites one is grounded. Their source hash
  includes the notes once there are any, so writing notes makes the stored
  answers stale and the chips answer live until `starters:refresh` runs.
  While there are none, every existing hash is unchanged. A tool's own notes
  were already covered: an edit moves `tools.updated_at`.

**Open.** Whether the lab-wide notes should also show to people (the About
page, the kiosk), not only to the assistant. MCP clients get a tool's notes
through `get_tool_details`, but not the lab-wide notes. An eval case for "cites
the lab note before the manual" is not written yet.

**Tests.** `lib/lab-notes/lines.test.ts`, `setting.test.ts`;
`lib/ai/lab-notes-prompt.test.ts`; `capabilities/chat-adapter.test.ts` (the
rules and lab-wide notes in the stable part, the same on every page; the
focused tool's notes first; the fourth citation format; no seeded rule);
`capabilities/catalog.test.ts` (`lab_notes`, the catalog mark);
`api/chat/route.test.ts` (both reach the model); `DetailShell.test.tsx` (above
the description, list or sentence, absent when blank, no Details row);
`ToolFieldsForm.test.tsx`; `admin/lab-notes/LabNotesForm.test.tsx`;
`app/admin/inventory/lab-notes/page.test.tsx` and `actions.test.ts` (gate,
normalised save, cache tag, cap); `starters/hash.test.ts`.

## Amendment — Companion, not a replacement (2026-10-06)

At the owner's meeting with Niti Parikh (Director) and Luis Rodrigo Navarro
(Assistant Director) on 2026-10-06: the assistant should strengthen the lab's
community, not replace its people. It should know the lab first (their
example: a box cutter's lab note says to put a cutting mat underneath so the
table is not scratched). And answers are still sometimes wrong or cite the
manual badly, so the chat should say that the AI can make mistakes.

- **"The lab first, then its people"** (`src/lib/ai/lab-companion.ts`). A
  short static block right after "Where you are" (§5), in the prompt's
  cacheable prefix, and before the "Lab notes" rules (amendment above): it is
  wholly static, so it sits ahead of the lab-wide notes, which change when
  staff save them. The lab's own record comes first: a tool's lab notes, its
  SOP and safety documents, PPE, restrictions, emergency stop and training.
  A lab note is cited as the "Lab notes" rules say (**Lab note:**); this
  block does not set a format of its own. The manual or manufacturer follows,
  searched and cited as before. Where they differ, the lab's rule wins and
  the answer says so. For first use, safety and hands-on technique the answer
  adds one line pointing the student to a person: a SuperMaker or other
  staff, the tool's training, or another maker.
  It names only people the prompt names and never says who is on shift (it
  knows no rota). The block ends by saying it never replaces the steps, a
  citation or an honest "I don't know".
- **Lab notes reach the prompt** through the "Lab notes" amendment above:
  the focused tool's notes come first in its block (`describeTool`), and
  other tools' through `get_tool_details`. The starter grader reads the same
  block, so it sees them too. This amendment adds no notes line of its own.
- **"MakerLAB AI can make mistakes. Check anything safety-related with
  staff."** (`chat.aiNote`, translated in all 12 locales). One line under the
  composer, always shown, styled as a form hint (DESIGN.md §8.7: 12px,
  muted). It is the text field's accessible description, so a screen reader
  reads it there. The product name stays "MakerLAB AI" in every locale, as in
  `chat.capabilitiesLink`.
- **Not done:** `CHAT_PROMPT_CACHE_KEY_DEFAULT` stays `makerlab-chat-v1`.
  Bumping it would mark every cached starter answer stale until
  `npm run starters:refresh` is run again (paid). Open item for the owner.
- **Tested** in `chat-adapter.test.ts` (the block's rules, its place after
  "Where you are" and before "Lab notes" in the static prefix, the focused
  tool's lab notes given once) and
  `ChatFab.test.tsx` (the note shows before and during a conversation and
  describes the text field). **Evals** (paid, not in CI):
  `evals/cases/lab-companion.yaml`: the Trotec's lab note ("60 seconds")
  before the lid is opened, a first laser cut that still cites the SOP and
  suggests a SuperMaker, and a first-time resin question that gives the lab's
  PPE and suggests staff. The harness gained `contains_any` (at least one of
  several literals) for behaviour with more than one fair wording.

## Amendment — The official Cornell Tech MakerLAB logo (2026-10-06)

Niti Parikh (Director) sent the lab's official logo as a vector file
(`MakerLAB_Logo_Black_CMYK.eps`): the Cornell seal beside "CORNELL TECH" over
"MakerLAB", in one colour (#231f20). It replaces the old "MakerLAB@CORNELL
TECH" logo everywhere the site drew a lab logo. The header keeps its striped
MakerLAB wordmark (owner decision).

- **Files.** `public/brand/cornell-tech-makerlab-logo.svg` (the EPS as SVG,
  dark) and `public/brand/cornell-tech-makerlab-logo-white.svg` (the same in
  white, for dark backgrounds outside the app such as slides or a poster).
  `public/brand/cornell-tech-makerlab-logo.png` (1600 × 439, transparent) is
  rendered from the dark SVG for what cannot draw an SVG. The EPS itself is not
  in the repository: it is 1.3 MB and no browser can show it.
- **Config.** `siteConfig.logo` (`NEXT_PUBLIC_LOGO`) now defaults to the SVG.
  New `siteConfig.logoPng` is the logo itself when it is a PNG, else the same
  path ending in `.png` (`pngTwin`). No new variable: a white-label SVG logo
  ships with its PNG beside it.
- **Dark mode.** One file. `BrandLogo` (`src/components/BrandLogo.tsx`, styled
  by `.brand-logo` in `globals.css`) draws the SVG as a CSS mask filled with
  the text colour, as the header draws its wordmark: #171717 on the light
  theme, #F5F5F0 on the dark theme and on the kiosk. It prints
  (`print-color-adjust: exact`) and turns `CanvasText` under forced colours.
  The app does not use the white SVG. The logo is decoration (`aria-hidden`):
  every place it appears also names the lab in words.
- **Where it appears.**

| Place | Before | Now |
|---|---|---|
| Kiosk top bar | old logo in a 4.6vmin box | official logo, `clamp(36px, 7vmin, 150px)` tall (76 px on a 1080p screen). Two lines of type and a seal need more height than the old single line |
| Site footer | no logo | official logo first on the line, 40 px tall. It wraps first on a narrow window |
| About | no logo | under the title, 56 px tall (64 px from `sm`) |
| Link-preview card (`opengraph-image`, `twitter-image`) | the wordmark, 475 × 79 | the logo's PNG, 540 × 148 |
| QR labels: the studio preview, PDF sheets, label SVG and PNG, `npm run qr:labels -- --pdf` | the wordmark | the logo's PNG (QR codes spec, amendment of the same date) |
| Header | wordmark | unchanged |
| Product page | no logo; its kiosk screenshots show the old logo | unchanged. Re-capture `public/product/kiosk-*` after the deploy |
| Email | not built (notifications spec, draft) | the draft now names `siteConfig.logoPng`, since mail clients drop SVG |

- **Retired.** Nothing references `public/makerlab-logo-transparent.png` or
  `public/makerlab-logo-blackonly.png` any more, and their
  `images.localPatterns` entries in `next.config.ts` are gone. The files stay
  until the owner deletes them.
- **Production.** If the Vercel project sets `NEXT_PUBLIC_LOGO` to the old
  PNG, the kiosk keeps the old logo until the variable is removed or set to
  `/brand/cornell-tech-makerlab-logo.svg`.
- **Tested** in `components/BrandLogo.test.tsx`, `SiteFooter.test.tsx`,
  `app/about/page.test.tsx`, `kiosk/KioskScreen.test.tsx`,
  `lib/site-config.test.ts`, `lib/share/site-card.test.tsx` (the PNG exists,
  at the card's proportions), and the QR tests listed in the QR codes spec's
  amendment. Checked by hand against a dev server: the kiosk at 1920×1080,
  3840×2160, 1280×720, 1180×820, 810×1080 and 390×844 has no sideways scroll,
  nothing under the header and, in landscape, every panel on screen.

## Amendment — MakerLAB AI everywhere (2026-10-07)

The owner's decisions on the design review (`docs/MakerLab_design/review-2026-10-06/decisions.md`):
"The assistant is called **MakerLAB AI** everywhere." The review found the chat
header said "MakerLAB Assistant" while the link under it said "What can
MakerLAB AI do?".

- **`siteConfig.chatAssistantName`** defaults to "MakerLAB AI"
  (`NEXT_PUBLIC_CHAT_ASSISTANT_NAME` still overrides it). The chat prompt
  (`chat-adapter.ts`), "Where you are" (`lab-context.ts`), the site
  description (`share/metadata.ts`) and the value report's title read it, and
  say "You are MakerLAB AI" rather than "You are the …".
- **Strings, all 12 locales:** the chat's title, open and close labels, the
  composer's placeholder and label, "MakerLAB AI is typing", the QR arrival
  notice, and the palette's Ask rows. English also: the greeting, the
  first-visit callout ("Meet MakerLAB AI"), About's project paragraph, the
  admin bar's "Ask MakerLAB AI" and the kiosk's ask heading and link. The
  name stays "MakerLAB AI" in every locale, as `chat.aiNote` does.
- **Not changed:** prose that describes the assistant rather than naming it
  ("the assistant can make mistakes" on the product page, "Assistant
  proposals" in the admin). `CHAT_PROMPT_CACHE_KEY_DEFAULT` stays
  `makerlab-chat-v1`; the starter-answer hash reads the key, not the text, so
  cached starter answers stay valid (some may still call it "the MakerLAB
  Assistant" until `npm run starters:refresh` runs).
- **Production:** if the Vercel project sets `NEXT_PUBLIC_CHAT_ASSISTANT_NAME`,
  the prompts keep that name until it is removed or changed.
- **Home title.** §2's "Tools" stays as the heading of the home page's
  categories (student home spec 2026-10-07); the full list is "All tools".
  (Both retired the same day: amendment "The landing lockup".)
- **Tested** in `site-config.test.ts`, `chat-adapter.test.ts`,
  `ChatFab.test.tsx`, `about/page.test.tsx`, the value report tests and the
  E2E chat, kiosk and actions specs.

## Amendment — The header reads MakerLAB AI (2026-10-07)

Seeing the ISAM poster, the owner asked for the header to match it: "use the
most recent logo … remove MakerLAB Tools and just write MakerLAB AI in the
upper left corner, the logo + AI".

- **The lockup** (`GlobalChrome`, `.brand-lockup`) is one line: the lettering
  cropped from the official Cornell Tech MakerLAB lockup
  (`public/brand/makerlab-wordmark-official.svg`, `siteConfig.wordmark`,
  still a mask in the text colour), then "AI" in the accent (`.brand-ai`),
  its caps as tall as the wordmark and on the same baseline. The striped
  wordmark PNG is no longer the default.
- **No site name or tagline** beside it. The link is named "MakerLAB AI"
  (`aria-label`). `siteConfig.name` ("MakerLAB Tools") is unchanged
  everywhere else: page titles, the footer, emails, the MCP server.
- **Bar heights:** the compact bars lose the name row (104 px under 1024,
  98 px under 560); the short landscape bar keeps its 48 px.
- **Tested** in `GlobalChrome.test.tsx`, `site-config.test.ts` and
  `e2e/header-stability.spec.ts`.

## Amendment — The composer on one line (2026-10-07)

The owner asked for the chat's composer to look like a typical chat app's:
smaller, on one line.

- **One line** (`ChatComposer`): a round + (attach), the text, and on the
  right the microphone until there is something to send, then the orange
  Send. While dictation runs the microphone stays, so it can be stopped.
  Attachments still show above the line.
- **Round controls:** the three buttons are circles, the one exception to
  square corners (`[data-slot="prompt-input"] .composer-round` in
  `globals.css`). The suggested replies became the second (amendment below).
- **The "can make mistakes" note** moves above the composer, as a small box
  closed with its × (`chat.aiNoteDismiss`, 12 locales). The dismissal is
  remembered in this browser (`ai-note-store.ts`, `localStorage`, try/catch);
  while shown, the note still describes the text field.
- **Tested** in `ChatFab.test.tsx`.

## Amendment — Suggested replies (2026-10-07)

The owner asked for "text suggestions to click in bubbles" under answers
like "What material or project are you looking to cut?", then: "Be sparing
with the suggested answers only when there's 2-3 choices easy to respond."

- **The look:** two or three short replies as a wrapping row of pill bubbles
  under the latest answer, after its cards and Sources; a tap sends the
  bubble's text as the student's next message. The bubbles are the second
  exception to square corners, scoped to the chat sheet
  (`#makerlab-chat-sheet .chat-reply-chip` in `globals.css`), in the theme's
  tokens for light and dark.
- **The tool, the prompt rules, when the bubbles show and the counts** are
  the assistant–GUI parity spec's amendment of the same date
  ("Suggested replies").
- **Tested** in `SuggestedReplies.test.tsx` and `ChatFab.test.tsx`.

## Amendment — ADMIN in the bar (2026-10-07)

The owner asked: remove REPORT from the top bar ("it's a weird thing to put up
there"), give admins ADMIN there instead of in the profile menu, and tidy the
menu.

- **The bar** (`PrimaryNav`): TOOLS · MAP · PROJECTS · ABOUT, then **ADMIN**
  (`AdminLink`, `/admin`) for anyone who can reach `/admin` — the same
  `canReachAdmin` the menu used — then the profile control or SIGN IN. ADMIN
  is a link like the others: muted, underlined in the accent ink on any
  `/admin` page, behind MENU on the short bar. Hiding it is presentation;
  `/admin` checks again on the server. The bar's only accent is now the
  current page's underline.
- **REPORT is gone from the bar.** Reporting stays one press away: **Report a
  problem** on every tool page (the quick report form) and on a unit's QR
  arrival notice, and a new **Report a problem** in the site footer
  (`FooterReportButton`), which does what the header's button did — opens the
  assistant with "I'd like to report a problem." The kiosk has no report
  control of its own; its QR code opens the assistant, which files reports.
  `nav.report*` moved to `footer.report` and `footer.reportSeed` (12 locales).
- **The profile menu**: Add equipment (for `tools.add`), **Account**
  (`/account`, was "Your account"), **Connect AI assistant (MCP)**
  (`/account/tokens`, was "Connect an AI assistant") and **Sign out**, drawn
  in a new `--secondary-ink` token: Cornell crimson on paper (6.2:1), the
  demo-data banner's lighter red in dark mode (6.1:1), checked in
  `tokens.test.ts`. Admin left the menu. `nav.admin`, `nav.account` and
  `nav.connectAssistant` are translated in all 12 locales.
- **The fit** (DESIGN.md §8.12) is checked signed in as a SuperMaker (the
  least role that sees ADMIN) in every language at 1024, 1280 and 1440 and
  on the short bar, as well as signed out (`e2e/header-stability.spec.ts`).
- **Tested** in `PrimaryNav.test.tsx`, `ProfileMenu.test.tsx`,
  `AdminLink.test.tsx`, `GlobalChrome.test.tsx`, `SiteFooter.test.tsx`,
  `tokens.test.ts`, and the `auth`, `admin-users` and `header-stability` E2E
  specs.

## Amendment — The landing lockup (2026-10-07)

The owner asked for "MakerLAB AI" above the search box on the home page, and
for the logo to go from that page's header (student home spec, amendment "One
page: the list at rest").

- **On `/`**, "MakerLAB AI" stands above the search at display size
  (`home/LandingLockup`, the page's `h1`): the same lockup as the header's —
  the official lettering as a mask in the text colour (`.brand-wordmark`,
  `siteConfig.wordmark`), then "AI" in the accent (`.brand-ai`) on the same
  baseline — drawn by the same rules, with only `--wordmark-height` changed
  (`.landing-lockup`, `clamp(40px, 7vw, 84px)`), centred. Its name is the
  text "MakerLAB AI" (visually hidden); the drawing is `aria-hidden`.
- **The header's lockup** (`HeaderBrand`, in `GlobalChrome`) is transparent on
  `/` while the landing lockup is on screen (`data-concealed`), so the logo
  shows once. It keeps its box — the header does not move between pages — and
  stays a link named "MakerLAB AI" that a keyboard reaches and that shows when
  focused. It fades back once the landing lockup has scrolled away under the
  bar. On every other page it is as before.
- **§2's home title "Tools"** is retired with the categories home: the home
  page's heading is the lockup, and the list's groups are headed by category.
- **Tested** in `HeaderBrand.test.tsx`, `home/HomeShell.test.tsx`,
  `GlobalChrome.test.tsx`, `e2e/gallery.spec.ts` and
  `e2e/header-stability.spec.ts`.
