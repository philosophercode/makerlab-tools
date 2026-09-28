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
   The lockup is 32px tall, so the bar keeps `--nav-height`.
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
