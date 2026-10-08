# Student Home — Design Spec

**Date:** 2026-10-07
**Status:** Implemented — the categories home and `/tools` are superseded by
amendment "One page: the list at rest" (end of this file)
**Target:** the app (repository root)
**Branch:** `v5/home-calm-gallery`
**Spec PR:** with the implementation · **Implementation PR:** with the spec

## 1. Summary

The design review of 2026-10-06 (`docs/MakerLab_design/review-2026-10-06/`)
found that students land on a wall of 77 alphabetical cards, with three ways to
search on one screen. The owner chose concept B, the calmer gallery, and wrote
his decisions in `review-2026-10-06/decisions.md`, with an addendum after
seeing mock-up B.

The home page (`/`) now has generous space and **one smart search box**. Under it, titled **Tools**, are the lab's categories
as large tiles. **See all tools** opens the full list at `/tools`, which is the
old gallery with the same search box, the filters and a count that follows
them. The smart search lists matching tools first, then categories, then
**Ask MakerLAB AI: “…”**, which opens the chat with the question. Enter opens
the first match, so a question never reaches the model by accident.

The assistant's display name becomes **MakerLAB AI** everywhere a person sees
it (identity spec amendment of the same date).

No architecture change: no capability, table, migration or environment
variable. One new route (`/tools`) and redirects for old links.

## 2. Goals / Non-goals

### Goals

1. `/` is the categories: the smart search, the heading
   "Tools", one tile per category the public gallery shows, and a way to the
   full list. "What do you want to make?", "eight kinds of making" and the
   "Start here" band are gone, and so is the big wordmark the first build put
   above the search (amendment "The logo once").
2. One smart search box whose placeholder rotates, fading out and in about
   every three seconds, through prompts and real questions, the live tool
   count among them. It is still under reduced motion and while the box has
   focus or text.
3. Typing lists tools, then categories, then "Ask MakerLAB AI: <text>" last.
   Enter opens the first tool or category. Nothing reaches the model unless
   somebody chooses the Ask row.
4. The search is the ⌘K palette's search drawn inline, not a second one: the
   same matcher (`paletteScore`) and the same keywords.
5. `/tools` is the full list: the same minimal search box, the existing
   filters, sort, grouping and views, and the count that updates as filters
   apply. Old `/?category=…` links land there.
6. The header keeps the big striped wordmark on the left and the nav links
   centred. The header's search field is hidden on `/` and `/tools`, where the
   page has its own box; ⌘K still works.
7. MakerLAB AI is the assistant's name in the chat, the palette, the callout,
   the kiosk, the QR arrival notice, About and the prompts.

### Non-goals (this iteration)

- **Who's on shift.** The owner keeps it (decisions.md) but it needs a rota
  that does not exist. A later spec.
- **"Most asked about this month"** from mock-up B. It needs usage data on a
  public page; not decided.
- **Lab rules in the search** (mock-up B's "Lab rules" group). Lab notes are
  per tool and shown on its page; searching them is a later step.
- **Guarding Enter in the ⌘K palette.** The palette is a power-user surface
  and keeps "Enter asks when nothing else matches" (UI system phase 5b).
- Translating the rest of the product page's "the assistant" prose, which
  describes the assistant rather than naming it.

## 3. Architecture

- **Pages.** `src/app/page.tsx` reads the catalogue and the category order
  (`getCategoryOrder`, cached under the `catalog` tag) and renders
  `HomeShell`. `src/app/tools/page.tsx` renders `GalleryShell`, unchanged in
  how it filters (`gallery-filters.ts`, `useUrlSearch`).
- **Shared search.** `src/components/palette/palette-search.ts` holds what the
  palette and the smart search share: `toolKeywords`, `categoryEntries`,
  `categoryKeywords`, and `rankByPaletteScore` over `paletteScore`. The
  palette dialog now uses them too (behaviour-preserving refactor).
- **Smart search.** `src/components/home/HomeSearch.tsx`: cmdk's `Command`
  inline (not a dialog), `shouldFilter={false}`, its own ranking, the Ask row
  last.
- **The box.** `src/components/search/SearchFrame.tsx` draws the minimal box
  and the rotating line (`use-rotating-line.ts`). `ListSearch.tsx` is the full
  list's box and its "Ask MakerLAB AI" button row. `FilterBar` gained a
  `searchSlot` prop for it.
- **Links.** `src/lib/gallery-links.ts`: `ALL_TOOLS_PATH`, `allToolsHref`,
  `categoryHref` and `GALLERY_QUERY_KEYS`. The tool page's category and room
  links, the project page's material links and the palette's categories use
  them.
- **Redirects.** `next.config.ts` `redirects()`: `/` carrying any of
  `GALLERY_QUERY_KEYS` goes to `/tools` (307, query kept). `/?ask=1` and
  `/?src=kiosk` stay on the home page.
- **Data.** None new. `HomeTool` (`home/home-tools.ts`) is a smaller pick of
  `MakerLabTool` than `GalleryTool`, so the home page sends less.

## 4. Data model

No schema change. Types:

```ts
// src/components/home/home-tools.ts
type HomeTool = Pick<MakerLabTool, "id" | "slug" | "name" | "officialName" | "category"
  | "categorySub" | "status" | "imageSrc" | "thumbnails" | "galleryHidden" | "itemKind">
  & { units: Array<Pick<MakerLabUnit, "status">> };

interface CategoryTile {
  name: string;        // top-level category, as the Category filter names it
  count: number;       // tools in it
  subs: string[];      // second-level names, at most three
  moreSubs: boolean;
  unitsDown: number;   // units Offline
  cover: { name; imageSrc; thumbnails } | null;
}
```

Tiles are ordered by the taxonomy's `sort_order` (top-level categories from
`listCategories`), then any other name alphabetically, "not recorded" last.
A category hidden from the gallery by default (Shop Infrastructure &
Supplies) gets no tile. The cover is the photo of the category's equipment
with the most units; accessories and consumables only when nothing else has a
photo.

## 5. Behavior / flow

**Home.** The visitor sees the box. The tiles link to
`/tools?category=<name>`. "See all N tools" (twice: beside the heading and
under the tiles) links to `/tools`. N is the gallery's own count, the same
number the box says ("Search 77 tools").

**Smart search.**

1. Nothing typed: no list. The placeholder line rotates.
2. Typing: up to six tools (`HOME_SEARCH_TOOL_LIMIT`), then up to three
   categories, then the Ask row. Matching is `paletteScore`: every word must
   appear in a tool's display name, official name or slug, or in a category's
   name or its second-level names. Not fuzzy.
3. The first tool, else the first category, is selected. Enter opens it
   (`/tools/<slug>`, or the filtered list).
4. When nothing matches, the list says so and shows only the Ask row, with
   nothing selected. Enter does nothing.
5. The Ask row is chosen with the arrow keys or the pointer, then Enter or a
   click. It opens the chat with the text as the first message and empties
   the box.
6. Escape closes the list; a second Escape clears the text. Leaving the box
   closes the list.

cmdk selects its first row by itself when the text changes. When that row is
Ask and nobody chose it, `HomeSearch` hands cmdk a fresh "nothing selected"
value, so cmdk shows no selection and Enter sends nothing.

**Full list.** The box filters the list as you type (match-sorter, as before).
While it has text, a button row under the filters says "Ask MakerLAB AI:
“…”". Enter in the box never asks. The FilterBar count ("Showing 12 of 77")
follows the search and the filters; the hero line is "77 tools · 70
available now".

**Old links.** `/?category=Laser&view=table` redirects to
`/tools?category=Laser&view=table`.

## 6. UI

- **Home** (`HomeShell`): the box at up to 768 px, with nothing above it, the h1 "Tools", tiles 2 / 3 / 4 across (phone / `lg` / `xl`),
  a "See all" button. Loading: `HomeFallback`, the same spacing.
- **Tile** (`CategoryTileCard`): photo plate, name in display type, a mono
  line "10 tools · FDM Printers, Resin Printers…" (kinds from `sm` up), and
  "▲ 1 unit out of service" only when units are down. The whole tile is the
  link.
- **Box** (`SearchFrame`): 56 px tall (64 px from `sm`), a search icon, 16–18
  px type. The rotating line is drawn over the input, `aria-hidden`; the input
  has a steady label ("Search tools, or ask MakerLAB AI a question"). Fade is
  `motion-safe` only; under `prefers-reduced-motion` the first line shows and
  never changes.
- **Lines**, in order: "Search {count} tools", "What will you build?", "Ask
  how to start a 3D print on the X1-Carbon", "Find your machine", then two
  real questions, "How do I load filament on the X1-Carbon?" and "Can the
  Trotec laser cut acrylic?". The addendum's four prompts and one or two real
  questions, no more: a box that cycles through eight lines reads as busy.
- **List** under the box: a popover, tool rows with a 40 px photo, the
  official name and the status; category rows with a count; the Ask row with
  the "can make mistakes" line.
- **Header:** the palette's field stays in place but `invisible` (and out of
  the tab order) on `/` and `/tools`, so the header's boxes do not move
  between pages (`e2e/header-stability.spec.ts`). `/` focuses the page's box.
- **Full list:** title "All tools".
- **Strings** (all 12 locales): `gallery.allTitle`, `gallery.home.*`,
  `gallery.search.*` (with `lines.*`), `palette.page.allTools`, and the
  palette's Ask strings. Removed: `gallery.searchPlaceholder`,
  `gallery.facts.categories`. Category names are data and stay English.

## 7. Relationship to existing work

- Builds on the stack ending at `v5/tool-scoped-citations` (serial masking,
  lab notes, chat companion, unit QR labels, official logo, recurring
  maintenance, tool-scoped citations).
- Supersedes the UI system spec's "the gallery is the home page" (phase 5a):
  the gallery is now `/tools`. Its filters, sort, grouping and views are
  unchanged.
- The identity spec's §2 home title "Tools" stays; its names table changes
  (amendment "MakerLAB AI everywhere").
- Unmerged PR #117 renamed the assistant on old code; this does it fresh.

## 8. Security and safety

- **Authorization:** public pages, no new permission. The palette still lists
  only what `surfacesFor(role)` allows.
- **Model spend:** the smart search never calls a model. A question is sent
  only by choosing the Ask row; Enter with no match does nothing. The chat's
  own rate limits apply once it is sent.
- **Untrusted input:** the typed text is matched in the browser and, when
  asked, sent as an ordinary chat message.
- **PII:** none.

## 9. Phased build order

One phase: shared search helpers, the home, `/tools` and redirects, the
rename, tests and docs.

## 10. Testing

- `palette/palette-search.test.ts`: keywords, category entries, ranking, no
  fuzzy match, empty query.
- `home/home-tools.test.ts`: tile order, counts, kinds, units down, hidden
  categories, cover choice.
- `home/HomeSearch.test.tsx`: order of groups, Enter opens the first match,
  a category opens the filtered list, **Enter with no match sends nothing and
  nothing is highlighted**, arrow then Enter asks, a click asks, Escape.
- `search/SearchFrame.test.tsx`: rotation and fade, wrap-round, pause on
  focus, hidden with text, static under reduced motion.
- `home/HomeShell.test.tsx`: title, one search, no second wordmark, removed
  copy, tiles and their links, "See all" count.
- `GalleryShell.test.tsx`: "All tools", the facts line, the Ask button row
  (Enter does not ask), the count following a filter.
- `palette/CommandPalette.test.tsx`: hidden trigger, `/` focuses a combobox,
  "All tools" page, renamed Ask strings.
- `lib/gallery-links.test.ts`: hrefs and the redirect rules.
- E2E: `gallery.spec.ts` (home, tiles, smart search, Enter safety, old link
  redirect, `/tools`), `search.spec.ts` and `tool-facets.spec.ts` on
  `/tools`, `palette.spec.ts` (`/` on both pages).

## 11. Open questions

1. Who's on shift: data source and opt-in (owner; a later spec).
2. Should the ⌘K palette also refuse to ask on Enter when nothing matches?
   (owner).
3. Should the header show the official logo small beside the wordmark? The
   decisions allow it; this branch keeps the footer placement (owner).

## Amendment — The logo once (2026-10-07)

The first build put a big striped MakerLAB wordmark (`HomeWordmark`,
`clamp(280px, 56vw, 720px)` wide) above the smart search, in the manner of a
search engine's front page. Seeing it, the owner asked for the logo only once:
the header's wordmark in the upper-left corner, unchanged.

- **The home** (`HomeShell`) has nothing above the smart search box: the box,
  then "Tools" and the tiles. The space above the box is smaller to match
  (`pt-8`, `pt-14` from `sm`, `pt-16` from `lg`), and so is the loading
  skeleton's (`HomeFallback`).
- **Unchanged:** the header wordmark (`.brand-wordmark`, the PNG), and the
  official Cornell Tech MakerLAB logo where it already appears (the footer,
  About, the kiosk, the QR labels).
- `HomeWordmark`, `siteConfig.wordmarkLarge`, the `.home-wordmark` rule and
  `public/brand/makerlab-wordmark.svg` were removed (owner approval
  2026-10-07).
- Tests: `HomeShell.test.tsx` asserts no second wordmark on the page.

## Amendment — One page: the list at rest (2026-10-07)

**Supersedes** §1's categories home and `/tools`, Goals 1, 3, 5 and 6, §5's
"Home" and "Smart search" steps 2–3, the tiles of §6, and amendment "The logo
once" where it puts the logo in the header on `/`. The rotating placeholder,
"Enter never asks", the Ask row, the redirect idea and the rename stand.

The owner, seeing the build (2026-10-07, from speech): "On the main page, above
the search box, just put MakerLAB AI and remove the logo on that first landing
page … I'm trying to harmonize the tools with the all tools page because I
think they could really just be one, and the tools page itself could just be
all tools grouped by the tool category … While you're searching, instead of
just showing the dropdown it could show the top tools". The design review had
recommended the same ("B — the list at rest"): the home page *is* the list
before you type.

### What the page is

- **One page at `/`** (`HomeShell`): "MakerLAB AI" at display size, the one
  search box, then **every tool grouped by top-level category in the lab's
  order** (`getCategoryOrder`, the taxonomy's `sort_order`), each group a
  sticky heading with its count over the gallery's own cards (`ToolCard`). No
  tiles, no "See all", no second list.
- **The landing lockup** (`home/LandingLockup`, the page's `h1`): the header's
  lockup drawn large — the official lettering as a mask in the text colour
  (`.brand-wordmark`, `siteConfig.wordmark`) and "AI" in the accent
  (`.brand-ai`) — sized by `--wordmark-height: clamp(40px, 7vw, 84px)` on
  `.landing-lockup`. Identity spec amendment "The landing lockup".
- **The header's lockup steps aside on `/`** (`HeaderBrand`): while the
  landing lockup is on screen the header's is `data-concealed` — transparent,
  not hidden, so it keeps its box (`e2e/header-stability.spec.ts` sees the
  same header on every page) and stays a link a keyboard reaches; focused, it
  shows. **Deviation from the brief** ("hidden on `/`"): once the landing
  lockup has scrolled away under the bar it fades back
  (`home/landing-lockup-store`, an `IntersectionObserver`), so a long list is
  never unbranded and the logo is still on screen once. One effect to remove
  if the owner wants it hidden for good. Every other page is unchanged.
- **Category chips** (`home/CategoryChips`) under the search: **All**, then
  each category in the lab's order with the count the other filters leave; a
  hidden-by-default category (Shop Infrastructure & Supplies) last. A chip is
  a toggle for the list's Category filter (`?category=`): pressed, the list
  shows that group alone, so the chip is also the jump to it. They replace
  the Category facet in the bar and sit in the bar's first row (`FilterBar`'s
  new `lead` slot), the count at its end. One line that scrolls sideways on a
  phone; wrapping from `sm`.
- **The list's own controls stay, compact:** Status, Material, Location and
  Item kind facets (a Filters sheet on a phone), Group by (Category — the
  default, nothing in the URL — Subcategory, Location, None, `?group=none`),
  Columns in the table, Sort, Grid / Table. "Category group" and "Category"
  in Group by are now "Category" and "Subcategory"; an old
  `?group=categoryGroup` reads as the default.

### Search: results on the page, the box's list for the rest

- **Typing swaps the groups for the matching tools**, ranked, as you type
  (`catalogueView` in `components/catalogue-view.ts`), under a heading
  "Results for “…”" with the count, the facets still applying. Emptying the
  box (its new ×, a second Escape) brings the groups back. The text is the
  URL's `?q=`, so a search is a link and Back from a tool returns to it. The
  box, the chips and the bar stay where they are: only the list below changes.
- **Ranking** (`rankToolsInPlace`, `palette/palette-search.ts`) is the ⌘K
  palette's `paletteScore` — every word must appear, never fuzzy — in two
  tiers: tools whose name, official name or slug match, then tools that match
  only on their details (category, subcategory, materials, tags, room). Never
  the description: with every word required, a paragraph matches nearly any
  question. The gallery's own tools come before a hidden-by-default
  category's (the search reaches those too, as the smart search did), and on
  an equal match equipment comes before fixtures, accessories and
  consumables. The full list's old match-sorter search is gone.
- **The box's list** (`HomeSearch`) keeps only what the page cannot show: the
  **categories** the text matches (up to three; choosing one filters the list
  to it and empties the box) and, last, **Ask MakerLAB AI: “…”**. It no
  longer lists tools. A line at its top says what Enter will open ("Enter
  opens Epilog Helix 24 Laser Cutter"), or that nothing matches.
- **Keyboard.** Nothing in the box's list is selected as you type. Enter with
  nothing selected — or with the list closed — opens the **first result the
  page shows**; with no result, the first matching category; with neither,
  nothing. Arrow keys move into the list; Enter there takes the row chosen.
  **Enter never asks.** An input method's Enter (Japanese, Chinese, Korean
  composition) is never a choice. Escape closes the list, a second empties the
  box. The rotating placeholder is unchanged.
- **Ask** is also a button after the results, and in their place when nothing
  matches (`AskMakerlabRow`), so a student whose keyboard has closed still has
  it.

### `/tools` merges into `/`

- **Redirect**, not a second render: `next.config.ts` sends `/tools` to `/`
  (307; Next forwards the query, so `/tools?category=Laser` lands filtered).
  Tool pages stay at `/tools/[id]` (the source matches `/tools` exactly). The
  old `/`-with-a-filter → `/tools` redirect is gone (it would loop).
  `src/app/tools/page.tsx` re-exports the home page in case the redirect is
  ever removed.
- **Links** (`lib/gallery-links.ts`): `ALL_TOOLS_PATH` is `/`, so the tool
  page's category and room links, the project page's materials and the
  palette's categories are `/?category=…` and the like. The palette drops its
  "All tools" page ("Tools" is the list). The header's ⌘K field is hidden on
  `/` only.
- **Same-page links.** The page is one cached prerender that reads its query
  on the client (`useUrlSearch`), so a router push to `/` from `/` changes the
  address and nothing on it. The palette's category rows therefore open the
  list through `openClientQueryPage` (a history entry the page reads in
  place), and `useUrlSearch` also listens to the Navigation API's
  `currententrychange`, so the header's TOOLS link or lockup followed on
  `/?q=laser` brings back the groups.

### Data, performance and strings

- The home page sends `GalleryTool` (what the list's cards, table and facets
  read) instead of `HomeTool`; the page stays one cached prerender, the
  catalogue read cached under the `catalog` tag. ~100 tools are ranked in the
  browser on each keystroke. The loading skeleton (`HomeFallback` with
  `GalleryFallback`) draws the lockup and the box at the same spacing.
- The sticky group headings now sit under the status strip too where it
  sticks (they slid under it before).
- **Strings (12 locales):** `gallery.chips.label` / `.all`,
  `gallery.results.heading`, `gallery.search.clear`,
  `gallery.search.enterOpens`. Removed: `gallery.title`, `gallery.allTitle`,
  `gallery.searchAria`, `gallery.facts.*`, `gallery.home.seeAll` / `.empty`,
  `gallery.search.tools`, `palette.page.allTools`. English `gallery.group`
  relabelled (Category / Subcategory).
- **Awaiting deletion approval** (no longer imported anywhere):
  `home/CategoryTileCard.tsx`, `home/home-tools.ts` (+ its test, and the
  `gallery.home.toolCount` / `.unitsDown` strings only the tile reads) and
  `GalleryHero.tsx`.

### Tests

- `catalogue-view.test.ts`: groups in the lab's order, none, hidden categories,
  results ranking (name before details, the gallery's own before hidden,
  equipment first, facets kept, questions match nothing), chips and counts.
- `palette/palette-search.test.ts`: `rankToolsInPlace` and
  `toolDetailKeywords`. `gallery-filters.test.ts`: the default grouping,
  `none`, the old `categoryGroup` link, `groupTools` in the lab's order,
  `compareCategoryNames`.
- `home/HomeSearch.test.tsx`: categories then Ask, no tool rows, nothing
  selected, the Enter hint, Enter opens the first result / the first category
  / nothing, arrows then Enter, click to ask, Escape twice, the ×.
- `home/HomeShell.test.tsx`: the `h1` lockup, one box, groups at rest,
  results in place and back, nothing above the list redrawn, Enter, hidden
  categories ranked last, category from the box's list, Ask in place of
  results, a search restored from the URL.
- `GalleryShell.test.tsx`: groups, chips, facets, results, sort, group by,
  table. `HeaderBrand.test.tsx`: concealed on `/` only, back once scrolled,
  transparent not hidden. `palette/CommandPalette.test.tsx`: no "All tools",
  categories to `/?category=`, in place on `/`. `lib/gallery-links.test.ts`:
  links and the `/tools` → `/` redirect.
- E2E: `gallery.spec.ts` (the list at rest, the header lockup, chips, search
  in place, Enter, old links), `search.spec.ts`, `palette.spec.ts` (a palette
  category filters in place), and the card-clicking specs moved from `/tools`
  to `/` (`auth`, `corrections`, `tool-detail`, `intake`, `tool-facets`,
  `theme-i18n`).
