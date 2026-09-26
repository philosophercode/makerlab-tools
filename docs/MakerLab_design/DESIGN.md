# Design System: The Technical Schematic

> **Living document.** This file says how MakerLab Tools should look and behave.
> The change that moves the code onto it — shadcn/ui on Tailwind 4, AI Elements
> for the chat, the admin IA — is specified in
> [`docs/specs/2026-09-25-ui-system-design.md`](../specs/2026-09-25-ui-system-design.md).
> The spec says *what changes and in what order*; this file says *what good
> looks like* and outlives the spec. Screenshots live in [`screens/`](screens/);
> `screen.png` is the original concept render and remains the identity reference.
>
> *Revised 2026-09-25: identity kept; reconciled with Tufte's density rules and
> the shadcn/AI Elements token mapping; patterns section added (§8). Phase 4:
> tiles, navigation, tabs and the ⌘K palette refined (§8.2, §8.12); queues and
> status lines added (§8.13, §8.14).*

## 1. Creative North Star: "The Blueprint Archive"

A digital extension of the workshop floor: precise, utilitarian, industrial-
editorial. Square corners, monospace metadata, high-contrast type, a blueprint
grid as the structural guide. It should feel less like a website and more like a
well-made instrument panel — and, like an instrument panel, **it earns its
density**: every mark on the screen is a reading somebody needs.

Two influences, one result:

- **Architectural Brutalism** gives the identity: 0px radii, mono labels, Safety
  Orange, tonal plates instead of boxes.
- **Edward Tufte** gives the discipline: maximise data-ink, words and numbers and
  graphics together, small multiples, sparklines, no chartjunk. Where the two
  disagree (glass, gradients, glows), Tufte wins; those flourishes are retired (§5).

![The concept render](screen.png)

## 2. Principles

1. **Data-ink first.** No boxed cells, zebra stripes, vertical rules, shadows or
   decorative icons in data. Hairline rows at 10% ink; sections by whitespace and
   tonal shift.
2. **Numbers right-aligned, tabular, mono.** Dates ISO (`2026-09-24`).
3. **One accent for action.** Safety Orange = the primary action, where you are,
   and "waiting on you". Never decoration, never a status.
4. **Status = glyph + word.** `● ok ▲ warn ■ bad ○ idle ◆ waiting on you – settled`.
   Colour is never the only signal.
5. **Say the numbers.** Headers carry a facts line; menus show counts; a tile says
   what its number counts.
6. **Sparklines where a trend matters.** Word-sized, bars for daily counts, last
   value in the accent, described in words for screen readers.
7. **Small multiples.** Parallel things share one layout.
8. **Dense but calm.** 13px tables, ~34px rows, 11px mono labels, 4px grid.
   Density comes from removing chrome, not shrinking type.
9. **Honest states.** Zero is shown as zero; unknown says "could not be read";
   empty names its cause.
10. **Square, flat, snappy.** 0px radius, no shadows, 150–200ms linear motion.

## 3. Colour and surfaces

Light is the default (a daily lab reference); dark is a first-class alternate.
The tokens below are CSS variables on `:root`, swapped under
`[data-theme="dark"]` and under `prefers-color-scheme: dark` when no choice is
stored. shadcn's semantic names map onto them (spec §6.1); components never use
hex values.

| Token | Role | Light | Dark | shadcn name |
|---|---|---|---|---|
| `--background` | page | #F7F4EE warm paper | #0F0F0F | `background` |
| `--surface-container-low` | general content areas | #EEE8DE | #131313 | `muted` |
| `--surface-container` | cards, sheets, menus | #FFFFFF | #1A1A1A | `card`, `popover` |
| `--surface-container-high` | hover, nested, neutral fill | #E2D8CA | #2A2A2A | `secondary`, `accent` |
| `--on-surface` | text | #171717 | #F5F5F0 | `foreground` |
| `--on-surface-muted` | secondary text | #59524A | #A1A1AA | `muted-foreground` |
| `--primary` | Safety Orange **fills** | #FF6B35 | #FF6B35 | `primary` |
| `--ink-on-primary` | text on orange | #0F0F0F | #0F0F0F | `primary-foreground` |
| `--primary-ink` | orange **text, marks, focus** | #B8431A | #FF6B35 | `primary-ink`, `ring` |
| `--secondary` | Cornell Crimson, heritage stamp | #B31B1B | #B31B1B | `brand` |
| `--outline` | hairlines | #CFC6B8 | #2A2A2A | `border` |
| `--outline-strong` | control boundaries (3:1) | #8A8171 | #6E6A64 | `input` |
| `--rule` | table row rules | ink 10% | ink 10% | `rule` |
| `--status-ok` | ● | #2B7549 | #5CC98A | `ok` |
| `--status-warn` | ▲ | #8A5300 | #E0A23A | `warn` |
| `--status-bad` | ■, errors, destructive | #B31B1B | #F0645A | `bad`, `destructive` |

**Why two oranges.** Safety Orange on paper is 2.6:1 — fine as a fill behind
black text (6.8:1), illegible as text. So orange *fills* stay #FF6B35 everywhere,
and orange *ink* on light surfaces is #B8431A (5.0:1). In dark mode they are the
same colour. On the light `muted` plate (#EEE8DE) the ink is 4.47:1, a hair
under AA: orange text belongs on the page or a card, not on `muted`.

**Crimson is a stamp, not a signal.** It marks heritage (the brand lockup), never
errors in dark mode (2.8:1 there). Errors use `--status-bad`.

**The No-Line rule.** Do not separate major page sections with 1px lines; use a
tonal shift (`surface-container-low` against `background`). Hairlines are for
rows, controls and the one bar under the admin section nav.

**Nested depth.** Cards are plates machined out of the background: a
`surface-container` card on `background`, a `surface-container-high` hover. The
blueprint-dot pattern (1px, 32px, 3–8% ink) stays on the page background only.

## 4. Typography

| Role | Face | Size / line | Use |
|---|---|---|---|
| Display | Space Grotesk 500, uppercase | clamp(42–88px) / 0.92 | Gallery and tool hero **only** |
| Page title | Space Grotesk 500, uppercase | 26–30px / 1.05 | `PageHeader` |
| Number | Space Grotesk 500, tabular | 40px / 1 | Tile headline |
| Body | Inter 400 | 14–15px / 1.5 | Prose, ledes |
| Table | Inter 400 | 13px / 1.35 | Cells, review values |
| Label | JetBrains Mono 500, uppercase, 0.08em | 11px | Eyebrows, buttons, glyph words, nav |
| Micro | JetBrains Mono, uppercase | 10px | Column heads, captions |

Seven steps. **Metadata is always mono** ("UI plumbing": tags, timestamps,
column heads, the `// CORNELL TECH` lockup, `// ADMIN / INVENTORY` crumbs). The
fonts are self-hosted with `next/font/local`; a design that only works where the
fonts happen to be installed is not a design.

## 5. Elevation, shape, motion

- **Radius: 0.** Every corner is 90°. (Enforced globally.)
- **Shadows: none.** Depth is tonal stacking. The old "ambient 64px glow" for
  modals is retired; a sheet or dialog sits on a 28% scrim instead.
- **Retired flourishes:** glassmorphism on overlays, gradients on CTAs, pulsing
  status dots. They cost ink and say nothing. The crosshair corners
  (`TechnicalFrame`) stay on the gallery hero only.
- **Focus: a 2px `--primary-ink` outline**, offset 2px, on `:focus-visible`,
  on everything interactive. Never `outline: none` without it.
- **Motion:** 150–200ms, linear or ease-in, colour and opacity only; nothing
  bounces; `prefers-reduced-motion` turns animation off.

## 6. Spacing and layout

- 4px grid: 4 · 8 · 12 · 16 · 24 · 32 · 48. Snap to it.
- Page gutter 16px on a phone, 32px from `sm`. No horizontal page scroll, ever;
  a wide thing (the section bar, a code block) scrolls inside itself.
- Breakpoints: `sm 640 · md 768 · lg 1024 · xl 1280`. Nothing else.
- Controls: 32px default, 28px in toolbars, 24px for row actions; touch rows ≥ 40px.

## 7. Iconography

`lucide-react`, 1.5–2px stroke, 14–16px, `currentColor`. Icons label *surfaces
and controls*; they are not decoration and never appear inside data cells, where
a status glyph (● ▲ ■ ○ ◆ –) does the job in a tenth of the ink.

## 8. Patterns

Each pattern names its component (`src/components/system/*`, `ui/*`,
`ai-elements/*`), when to use it, and what not to do.

### 8.1 Page header — `PageHeader`

`// ADMIN / KEEP DATA FRESH` crumb (mono, the `//` in accent) → title → one-line
lede → **facts line** (`101 TOOLS · 86 PUBLISHED · 11 DRAFTS · 97 NEED ATTENTION`)
→ actions on the right.

- **Use** on every working page (admin, account, projects, mcp).
- **Don't** stack a display heading above it (the old 88px "ADMIN"); don't put
  more than one filled button in the actions.
- Gallery and tool page keep their display heroes.

![Header, section bar and facts line](screens/after-inventory-desktop.webp)

### 8.2 Tiles — `Tile`, `TileGroup`, `TileGrid`

Whole tile is the link. Mono title + icon → headline number (40px, tabular) with
the words for what it counts → facts (`glyph label ……… value`) → optional
30-day sparkline with a `30 DAYS` caption, **pinned to the tile's foot**. Accent
left border and accent number when the headline is **work waiting for a
person**; muted number when it is 0. The parts are always in that order and in
those places, so tiles side by side read as small multiples.

- **Use** for the admin home: one tile per surface, one column per job, only
  the surfaces the viewer may open (`surfacesFor`), each counted by its own
  loader so one unreadable table costs one tile.
- **Rows line up.** The columns share one row grid (`TileGrid`; each
  `TileGroup` is a CSS subgrid): a tile spans two row tracks and fills them, so
  tiles in the same row share their top and bottom edges across groups, however
  much each one says. Every group spans the same number of tracks, so a short
  group ends early rather than stretching its tiles. One column on a phone, in
  the same order.
- **Half tiles.** A surface with only a number or a state — People, the Notion
  mirror, Projects with nothing waiting, a count that could not be read — is a
  **half tile** (`size="half"`: one track, 28px number, no trend). Pair half
  tiles in a group so two stand where one full tile would and the grid stays
  rectangular; a lone half tile goes last in its group.
- **Say what the number counts**, in the unit and the facts, whenever another
  number on screen could seem to contradict it: the Inventory tile's "of 104
  tools need attention" sits beside "Published — in the catalog 100" and
  "Drafts and archived 4", because the status strip's "100 tools in inventory"
  counts published tools only.
- **Sparklines are readable at a glance**: bars at 75% ink, a zero day a 2px
  stub at 40%, today in the accent ink.
- **The link's name is the title**; the number and facts are its description,
  so a links list reads "Inventory", not a paragraph.
- **Accent means waiting work above zero** — open tickets, researched items,
  new reports. A stock (tools needing attention, people) is ink, however big.
- **Don't** show a count that failed as 0 (say "Could not be read", and drop
  the facts and trend with it); don't add a sparkline to a stock that doesn't
  change daily; don't use tiles as a gallery; don't put the tile's counts in
  the section bar.

![Admin home](screens/after-admin-home-desktop.webp)

### 8.3 Data table — `DataTable`

13px, ~34px rows, hairline row rules, no vertical rules, no zebra. Sticky header
(mono 10px). Numeric columns right-aligned tabular mono. Status column is
`StatusGlyph`. A 24px thumbnail at most. The row's reasons-for-attention as
**words** in warn ink (`▲ No photo · No manual · 1 open`). Row actions are
`ghost xs` and brighten on hover/focus. Keyboard: ↑↓/j k move, Space/x select,
Enter opens. Selection shows a sticky bulk bar (`2 TOOLS SELECTED · [REFRESH
RESEARCH (2)] · CLEAR`). On a phone: a two-line list item per row.

- **Use** for any list of records a person scans, sorts or selects.
- **Sort state is on the `th`** (`aria-sort`), never on the button inside it.
  The row's name is its `th scope="row"`.
- **Zero is a muted `0`; a dash is "not applicable yet"** (an import not read
  into rows). Neither is ever "None".
- **Selection survives filtering, and says so**: `3 TOOLS SELECTED · 1 NOT
  SHOWN BY THE FILTERS`. Select-all takes the rows shown.
- **Sticky header only when the page scrolls the table**, on the page
  background; a short table on a card is not sticky. A short, narrow table
  (seven rows, two columns) may stay a table on a phone and scroll inside
  itself; anything longer or wider gets the two-line list.
- **Phone: one of the two, not both.** The list and the table are never both
  in the document once the browser can say which shows, so a row's controls
  (a role select, a ban button) exist once.
- **A table in a panel follows the panel.** In the chat (360–440px on any
  screen) the table's own width decides (`layout="container"`), so the intake
  table is a list there on a 1440px desktop too, with its own select-all.
- **A row that cannot be selected says why**: its box is disabled and
  described by the reason (an undecided duplicate); select-all skips it.
- **Don't** render a table as cards on a phone; don't box cells; don't put more
  than one line of secondary text in a cell; don't hide the count.

![Inventory, phone](screens/after-inventory-phone.webp)

### 8.4 Filter bar — `FilterBar`, `FacetFilter`, `ColumnsMenu`

Search (left) → one facet button per dimension (`STATE ▾`, `NEEDS ATTENTION
Never reviewed ▾` when set) → Clear → `Showing 21 of 101` → Columns. A facet menu
lists values **with the count each would leave**, disables values that leave
nothing, and filters are written to the URL so a view is a link.

- A chosen facet names its value on the button (`STATE Draft ▾`, read as
  "State: Draft"); its border moves to the accent ink.
- A short fixed choice **inside a row or a form** (a role, a token's expiry)
  is a `NativeSelect` — a real `<select>`, the phone's own picker — bounded by
  `--outline-strong` like `Input`.
- **Don't** use native selects for facets; don't filter server-side on each
  keystroke; don't show an empty table without naming the filter.

![Facet counts](screens/after-inventory-facet.webp)

### 8.5 Status glyphs — `StatusGlyph`, `Glyph`

| Glyph | Tone | Means |
|---|---|---|
| ● | ok | settled and good: published, available, searchable, verified |
| ▲ | warn | needs a person soon: never reviewed, no manual, medium |
| ■ | bad | broken or urgent: failed, out of service, critical, quote not found |
| ○ | idle | nothing to do / not started: draft, queued, none |
| ◆ | active (accent) | waiting on *you*: proposed, researched, new |
| – | muted | archived, retired, decided |

Always with the word (visible, or `sr-only` in `compact` cells). **Don't** use a
coloured dot alone, a pill background, or Badge for status.

### 8.6 Review / proposal card — `ReviewCard`

One decision per card: `LABEL  marks  [ACCEPT] [REJECT]` on one line; NOW (muted)
│ PROPOSED (ink, orange rule) side by side, stacked on a phone; SOURCES as
verbatim quotes with host and ● verified / ■ not found; a note when it cannot be
decided here. Safety cards carry a bad-tone left rule. Decided cards fade.

- **Use** for refresh proposals, chat proposals, intake records, import rows —
  anything a person accepts or rejects.
- **A new record has no NOW.** The intake approve page is one card per field
  group (names, safety and training first, description, where it goes, links),
  all proposal, editable in place through `Field`. A field waiting on a
  person's decision (training "staff to confirm") carries a warn rule and says
  why in its hint.
- **Tones:** safety = bad rule; `warn` = a decision still owed (low confidence,
  an undecided duplicate); settled = faded. The mono meta line under the label
  says who and when; a failed run's reason is a `ReviewDiagnosis` (mono,
  bad rule), shown as recorded.
- **Duplicates are a `DuplicateChoice`**: ▲ the match in words, then the
  choices as a radio group of small buttons. Choosing saves, so the arrow keys
  never choose — each option is its own tab stop. A decision that cannot be
  changed here is shown as ● words, not controls.
- **Don't** render values as HTML/Markdown (they come from web pages); don't
  offer Accept on unverified evidence; don't box each card (a rule is enough);
  don't pass a border colour to a card (it overrides the tone's rule).

![Refresh review](screens/after-refresh-review-desktop.webp)

### 8.7 Forms

Label above (mono 10px uppercase), control (hairline box, `--outline-strong`,
square), hint below (12px muted), error below in `bad`. One filled primary button
at the end; Cancel is `quiet`. A form that belongs to the page is inline; a
decision gets a `Dialog`.

- **Don't** rely on placeholder as label; don't disable Submit without saying why.

### 8.8 Dialogs and sheets — `Dialog`, `Sheet`

`Dialog` for a decision (confirm, report a correction, research again); `Sheet`
(side panel, full screen on a phone) for a workspace (tool editor, chat). Both
trap focus, close on Escape and return focus. Scrim 28% ink, no shadow.

- **Don't** mark something `aria-modal` that isn't; don't nest dialogs.

### 8.9 Empty, loading, error — `EmptyState`, `Skeleton`, `RowStatus`

- **Empty**: one sentence naming what is missing and why, plus the next action
  ("No tools match State: Archived. [Clear filters]").
- **Loading**: skeleton rows in the table's shape; a spinner only inline.
- **Error**: say what failed and that nothing was lost; failing toward stale is
  shown, not hidden (Article 4). Row actions report inline (`RowStatus`).

### 8.10 Buttons — `Button`

| Variant | Look | Use |
|---|---|---|
| `default` | orange fill, #0F0F0F mono label | the one primary action on a surface |
| `quiet` | hairline box, ink label | everything else (default) |
| `outline` | orange-ink hairline + label | a secondary call to action on public pages |
| `ghost` | label only, muted | row actions, toolbars, Clear |
| `destructive` | bad-tone hairline + label, at rest | discard, delete, ban — confirm inline |
| `link` | orange-ink underlined | inline navigation |

### 8.11 Chat — AI Elements

Docked side sheet (440px; full screen on a phone). `Conversation` (live log,
sticks to bottom, "scroll to latest" button) → `Message`: assistant text is
unboxed prose; the user's turn is a square `secondary` block; cards (`ReviewCard`,
intake table, import card) span the full width. `Suggestions` stack as sentences
on the empty state. A running tool is a one-line status with a spinner (`Tool`
header). Manual citations render as `InlineCitation` + a `Sources` list — the
answer shows its evidence. `PromptInput`: attach, dictate, text, send.

- **Don't** use rounded bubbles or avatars; don't strip citations; don't open a
  floating card that can't fit the cards it contains.

![Chat](screens/after-chat-desktop.webp)

### 8.12 Navigation and IA

- **Public**: `TOOLS · PROJECTS · ABOUT · REPORT` in the top bar; status strip
  below (`86 TOOLS IN INVENTORY · LAB OPEN 9AM–9PM`).
- **Admin**: a section bar under the top bar on every admin page:
  `OVERVIEW ┃ INTAKE ┃ INVENTORY · REFRESH · MANUALS ┃
  MAINTENANCE · CORRECTIONS · PROJECTS ┃ PEOPLE · NOTION MIRROR ┃ ⌕ SEARCH ⌘K`,
  dividers between jobs, the most specific current page underlined in the
  accent (an item's page marks its surface), only surfaces the viewer's
  permissions open, **no counts**. On a phone it scrolls inside itself. The
  one list behind the bar, the home and the palette is
  `src/lib/admin/surfaces.ts` — a page added there appears in all three.
- **Page header**: `// ADMIN / GROUP` (plus `/ SURFACE` as a link on an item's
  page) → title → lede → facts line → actions (`AdminPageHeader`).
- **Tabs that are pages** (`LinkTabs`): Intake's `QUEUE · IMPORTS` under one
  header. Links with `aria-current`, not `role="tab"` — each tab is a URL; a
  tab the viewer cannot open is not shown.
- **One surface per job's page, actions in the header.** Adding equipment is
  one surface, **Intake**: importing a list is its header action (`IMPORT A
  LIST`), not a surface, tile or palette entry of its own. A page's primary
  action sits in its header's actions — Inventory's `ADD INVENTORY`, Refresh's
  `REFRESH RESEARCH…` (a dialog that picks the tools), Intake's `IMPORT A LIST`.
- **⌘K palette** (`CommandPalette`): `ADMIN PAGES` (with their group),
  `ACTIONS` (Add equipment, Refresh the catalog), `TOOLS` (display name, the
  official name muted, `DRAFT` marked). Every word typed must match; nothing
  fuzzy. `/` jumps to the page's filter search. The assistant joins it in
  phase 5 ("Ask the assistant: …").
- **Don't** make a page reachable only through a hub; don't list a surface that
  will refuse the viewer; don't put waiting counts in the bar; don't use
  `role="tab"` for navigation.

### 8.13 Queues — `QueueList`

Maintenance, corrections, projects and intake are one layout: `FilterBar`
(search + facets counted over every item) → the open work, one `ReviewCard`
each (status and priority as glyphs, who and when on the meta line, the
controls under the words) → `▸ SHOW 5 RESOLVED AND CLOSED`, a disclosure
holding the settled work, filtered too.

- **Open work is the page**; settled is one click away, never gone.
- A filter that empties the open list **names itself** (`Nothing here matches
  "belt" · Priority: High`) with Clear. An empty queue says what fills it and
  shows no filter bar.
- **Typed fields are a button until wanted.** A card's click-to-save controls
  (status, priority, assignee) are always there; a field somebody writes a
  sentence into (a ticket's resolution) is `ADD RESOLUTION`, or the saved words
  on two clamped lines with `EDIT RESOLUTION`, until pressed — then the box
  opens inline, focused, with Save and Cancel; Escape cancels; focus returns to
  the button; the outcome is the card's `RowStatus`.
- Cards may be grouped (intake by batch); the layout stays the same.
- **Don't** split a queue into Open / Settled tabs; don't box the cards; don't
  hide the controls behind a row click on a phone.

### 8.14 Status lines — `RowStatus`

One inline line for an action's outcome, in the muted, warn or bad ink:
`Saving… → Saved`, a warning when a change landed minus a guarantee, the
refusal's reason. Always in the DOM as a live region, empty until it speaks.
**"Saved" only for a write that landed**: a control that saves on change is
disabled until the page has hydrated (`useHydrated`), a change to the value it
already holds sends nothing, and an answer that does not match the choice is a
failure, not a success.
No toasts (owner decision). A page that could not read its data says so with
`EmptyState tone="bad"`, never an empty list.

### 8.15 Mobile behaviour

- 390px is a first-class width: tables become two-line lists, before/after
  stacks, bars scroll inside themselves, sheets go full screen.
- 16px gutters; no horizontal page scroll; touch rows ≥ 40px.
- The chat launcher must never cover the one action on screen (bulk bars reserve
  its corner; admin opens chat from the nav).

## 9. Do's and Don'ts

**Do**
- Snap to the 4px grid and the seven type steps.
- Put the label top-left and the value bottom-right: a technical-document flow.
- Say the numbers in words beside the graphics.
- Use one accent, once per surface, for the action.

**Don't**
- Round a corner, cast a shadow, add a gradient, blur glass.
- Use Crimson for large surfaces or for errors in dark mode.
- Use orange text on paper (use `--primary-ink`).
- Encode status in colour alone.
- Invent a new table, badge, button or dialog: use the system component, or add
  one to `src/components/system` when a pattern appears on a second surface.
