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
| **MakerLAB Assistant** | The AI inside it (`siteConfig.chatAssistantName`) |

The site's tagline is "Your digital guide to making at Cornell Tech"
(`siteConfig.tagline`).

## 2. Goals / Non-goals

### Goals

1. **Header.** Top left, the MakerLAB wordmark ("Maker" light, "LAB" bold) and
   under it "MakerLAB Tools" and the tagline, replacing
   "MAKERLAB TOOLS // CORNELL TECH". The wordmark is cropped from the lab's
   own logo (`public/makerlab-logo-transparent.png` →
   `public/makerlab-wordmark.png`, `NEXT_PUBLIC_WORDMARK`) and drawn as a CSS
   mask in the text colour, as the kiosk draws the full logo. The nav links
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
