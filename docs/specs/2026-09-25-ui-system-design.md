# UI System (shadcn/ui, Tufte density, admin IA) — Design Spec

**Date:** 2026-09-25
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/ui-spike` (spike; not for merge as-is)
**Spec PR:** — · **Implementation PR:** — (one per phase, §9)

> **What changes:** this spec. **How it should look and behave:**
> [`docs/MakerLab_design/DESIGN.md`](../MakerLab_design/DESIGN.md), the living
> design-pattern document, which this spec updates and which outlives it.
> Screenshots: [`docs/MakerLab_design/screens/`](../MakerLab_design/screens/).

## 1. Summary

The v5 app has grown to 25 pages, 81 components and 7,315 lines of hand-written
CSS. The visual direction — the "Blueprint Archive": warm paper / near-black,
Safety Orange, square corners, mono `// CORNELL TECH` metadata — is right and is
kept. What is wrong is everything underneath it: there is no component layer, so
every surface re-solved the same problems. The audit (§4) counts **8 table
implementations, 17 badge families, 7 button families, 5 visual systems for
"review a proposal", 4 filter bars, 4 empty states and 7 dialogs**, a type scale
of 25 font sizes, 86 distinct padding values, and no loaded fonts at all.

This spec adopts **shadcn/ui on Tailwind 4** (Tailwind is already installed and
unused) themed onto the existing tokens, adds a small set of **app-level
components** (DataTable, FilterBar, StatusGlyph, ReviewCard, Tile, Sparkline,
PageHeader, EmptyState), adopts **Vercel AI Elements** for the chat, and applies
**Tufte's rules for information density**: dense but calm tables, numbers
right-aligned and tabular, status as a glyph *and* a word, sparklines where a
trend matters, one accent colour for action. It also reorganises the admin
(information architecture): a **tile home with live counts** grouped by job, and
a **section bar** so admin pages are no longer reachable only through `/admin`.

A spike on `v5/ui-spike` proved the approach on the three worst screens (§11):
the inventory page is **50% shorter on desktop (8,888 → 4,439 px) and 76% shorter
on a phone (31,561 → 7,678 px)** for the same 101 tools, with sorting, facet
counts, column visibility, keyboard navigation and bulk actions it did not have;
the admin home fits one desktop screen and answers "where is the work" before
anything is opened; one `ReviewCard` now renders both the refresh review page and
the assistant's proposals. **No architecture change**: no data model, capability,
route or permission changes (the spike adds one read, `loadAdminOverview`).

## 2. Goals / Non-goals

### Goals

- One component layer: every table is `DataTable`, every status is
  `StatusGlyph`, every review is `ReviewCard`, every button is `Button` — with
  the Blueprint identity as the theme, not as per-page CSS.
- `/admin` is a grid of tiles with live counts (and a 30-day sparkline where a
  trend matters), grouped by job, visible only to the permissions that open them.
- Every admin page carries the same section bar and page header; no page is
  reachable only by going back to `/admin`.
- The inventory, intake, import and refresh review screens show ≥2× the rows or
  cards per screen they show today, on desktop and on a phone.
- WCAG 2.2 AA for text contrast, non-text contrast and focus visibility in both
  themes (§8.2 lists what fails today).
- CSS shrinks from 7,315 lines to ≤ ~1,800 (§10); no page has a bespoke table,
  badge, button or dialog.
- The chat panel uses AI Elements (Conversation, Message, Suggestions, Loader,
  Tool, Sources, PromptInput) themed to the shared tokens.

### Non-goals (this iteration)

- **No visual rebrand.** Fonts, palette, square corners and mono metadata stay.
- **No new features.** The tile counts and the section bar are navigation over
  existing surfaces; nothing new becomes possible.
- **No data-model, capability or route changes**, beyond the read-only
  `loadAdminOverview` (spike) and count helpers it may grow.
- **No density toggle yet.** One dense-but-calm density is chosen (§5.3); a
  compact/comfortable switch is an open question (§13), not a phase.
- **Not the successor app.** Next-generation work happens in
  `philosophercode/blueprint`; this keeps v5 maintainable while it is live.
- **v4 (root `src/`)** is frozen and untouched.

## 3. Principles (Tufte-informed, as rules)

Each rule is checkable in review. DESIGN.md carries the do/don't examples.

1. **Maximise data-ink.** Every pixel of ink shows data or structure the reader
   needs. No boxed cells, no zebra stripes, no vertical rules, no drop shadows,
   no decorative icons inside tables. Rows are separated by a 1px hairline at
   10% ink (`--rule`), sections by whitespace and a tonal shift (the existing
   "No-Line" rule).
2. **Numbers are right-aligned and tabular** (`font-variant-numeric:
   tabular-nums`, mono) so a column of counts reads as a column. Dates are ISO
   (`2026-09-24`), locale-neutral and comparable.
3. **One accent for action.** Safety Orange marks the single primary action on a
   surface, the current location, and "waiting on you". It is never decoration
   and never a status colour. Orange *text* uses `--primary-ink` (§6.3).
4. **Status is a small glyph plus a word.** Shape carries meaning as well as
   colour: `● ok · ▲ warn · ■ bad · ○ idle · ◆ waiting on you · – settled`. The
   word is always present (visually, or to a screen reader in compact cells).
   Colour alone is never the signal.
5. **Words, numbers and graphics together.** A page header says its key numbers
   as a sentence (`101 TOOLS · 86 PUBLISHED · 11 DRAFTS · 97 NEED ATTENTION`); a
   facet menu shows how many rows each value leaves; a tile states what its number
   counts ("2 researched, waiting for you").
6. **Sparklines where a trend matters, nowhere else.** Word-sized (≈120×18),
   no axes, bars for daily counts (a line implies values between days), the last
   value in the accent, labelled in words for screen readers. Used on tiles for
   tickets, corrections and intake; not for stocks that do not move daily.
7. **Small multiples.** Parallel things share one layout so differences stand
   out: the four tile columns, the review cards, the facet counts.
8. **Density with calm.** 13px table text, ~34px rows, 11px mono labels, 4px
   spacing grid. Dense is achieved by removing chrome, not by shrinking type.
9. **Show the empty and the unknown honestly.** A zero is shown as a zero
   (muted); a number that could not be read says so and is never shown as zero
   (Article 4). An empty table names the filter that emptied it.
10. **Square, flat, snappy.** 0px radius, no shadows (the global rule stays),
    150–200ms linear transitions, focus as a 2px outline.

## 4. Audit (evidence)

Screenshots of every page, three roles (anonymous, student, super admin), two
widths (1440, 390), taken against a seeded 101-tool scratch database on :3041,
are in `v5/.livecheck/ui-spike/before/` (not committed; a curated, compressed set
is in `docs/MakerLab_design/screens/`). Code counts come from scripts over `src/`
excluding tests.

### 4.1 Findings that matter most

| # | Finding | Evidence |
|---|---|---|
| 1 | **No fonts are loaded.** Space Grotesk / Inter / JetBrains Mono render only where installed; everyone else gets Arial Narrow / Arial / Courier. The same Chromium on the same laptop rendered a different mono between two runs. | No `next/font`, `@font-face` or font link anywhere. |
| 2 | **Tailwind 4 is installed and unused**; all styling is 8 CSS files, 7,315 lines (globals.css 5,103). | 0 utility classes in TSX. |
| 3 | **The admin home is a text list**, and admin pages link to each other only through it. | `src/app/admin/page.tsx`; no admin nav. |
| 4 | **Two headers on every admin page**: an 88px display "ADMIN" plus the page's own eyebrow and h2 — ~250px before any data. | `admin/layout.tsx`. |
| 5 | **The inventory row is ~81px tall** (thumbnail, badges, edit button stacked); on a phone every tool is a ~300px card: **31,561px** for 101 tools. | before screenshots. |
| 6 | **8 table implementations** (4 CSS prefixes), 2 separate "table → cards on mobile" systems, 1 div-grid table with invalid row/sort ARIA. | `admin-table*`, `intake-table`, `td-*`, `tool-table`. |
| 7 | **Review UI solved 5 ways across 8 components**: intake chat table, intake queue, intake approve page, import review, refresh/chat proposals. The duplicate-resolution control alone exists 3 times (buttons, a `<select>`, read-only). | §4.3. |
| 8 | **Contrast failures**: Safety Orange text on paper is 2.58:1 (used 138× as text colour); white-on-orange buttons 2.84:1; Cornell Crimson error text on dark 2.82:1; the warning amber 3.77:1; every control border (`--outline`) 1.2–1.5:1. | §8.2. |
| 9 | **Focus**: 12 `outline: none`, only 13 `:focus-visible` rules; the chat composer has no visible focus; no button family has a focus style. | globals.css. |
| 10 | **The chat dialog is `aria-modal` with no focus trap, no Escape, no initial focus, no focus return**; the message list is not a live region; replies are not announced. | `ChatFab.tsx`. |
| 11 | **Radius and shadow are dead CSS**: `* { border-radius: 0 !important; box-shadow: none !important }` silently squares the tool page's 18px/12px radius design and kills its shadow; only chat and intake-table escape with `!important` (34 of them). | globals.css:50. |
| 12 | **Two palettes**: global tokens and 31 `--td-*` tokens written three times; `.admin-shell` remaps 7 of them; any other `--td-*` used in admin resolves to `unset`. | globals.css 2701–2835, 4046. |

### 4.2 Numbers

| Dimension | Count |
|---|---|
| Components (`src/components`, non-test) | 81 files, 14,497 lines; largest: PreliminaryToolPage 1,259, ChatFab 993, IntakeTableCard 696 |
| CSS | 8 files, 7,315 lines; 30 media queries over **14 breakpoints** |
| Font sizes | **25 distinct** (every 1px from 8 to 20) |
| Spacing | 86 padding shorthands, 45 margins, 24 gaps; 37% of atomic lengths off the 4px grid |
| Colours | 18 hardcoded outside tokens (36 uses), 3 different error reds, 3 different "text on primary" colours |
| Buttons | 148 `<button>`, 44 distinct class strings, **7 families** (heights 28–44px) |
| Badges/pills | **17 families, ~45 variants** (several byte-identical) |
| Cards | 12 live families (+1 dead) |
| Lists/queues | 9 implementations; 4 have identical declarations |
| Dialogs/sheets | 7, with 4 different semantics |
| Empty states | 4 classes, no component |
| Filters | 4 implementations |
| Removable CSS before any rewrite | ~620 lines exact duplicates (56 groups) + ~145 near-duplicates + ~526 dead (46 unused classes, the whole `id-card*` family) ≈ **1,300 lines (18%)** |
| Dead components | `UnitsList.tsx` (no importer) |

### 4.3 Where two pages solve one problem differently — and the pick

| Problem | Today | Pick |
|---|---|---|
| Tabular data | `admin-table`, `intake-table`, `td-kv-table`/`td-machines`, `tool-table` div grid, mirror mapping table | `DataTable` for lists of records; a plain `<dl>` key/value (`td-kv`) for one record's facts |
| Table on a phone | CSS `td::before` labels (×2), inventory 300px cards | `DataTable`'s `mobileRow`: a two-line list item |
| Filtering | gallery filter console, inventory selects, import filter chips, queue open/settled splits | `FilterBar` (search + facet menus with counts + Clear + count); queues use a facet, not a split |
| Status | 17 badge families, colour dots | `StatusGlyph` (glyph + word); `Badge` only for *labels* (tags), never status |
| Review / decide | 5 systems (above) | `ReviewCard` (§7.4) |
| Duplicate resolution | buttons / `<select>` / read-only | one `DuplicateChoice` control inside `ReviewCard`, radio semantics |
| Primary action | `admin-button.is-primary` (outlined), `admin-action-primary` (filled), `td-button-primary` (white on orange), `account-button.is-primary`, `intake-button primary` | `Button variant="default"`: filled Safety Orange, #0F0F0F text — one per surface |
| Destructive | `admin-button.is-danger` (red only on hover), `intake-button danger` | `Button variant="destructive"`, red at rest, confirm inline |
| Dialog / panel | chat overlay, flag modal, research-again inline "dialog", refresh inline panel, tool editor aside/sheet | `Dialog` for a decision, `Sheet` for a workspace (editor, chat), inline disclosure for a form that belongs to the page |
| Page header | gallery `title-row`, admin layout + `td-eyebrow` + h2, `td-hero` | `PageHeader` everywhere except the gallery hero and the tool hero |
| Empty state | `td-empty`, `admin-empty`, `empty-state`, `project-empty` | `EmptyState` (sentence + next action) |
| Outcome line | `RowStatus`, 8 other status classes, no toasts | `RowStatus` inline for row actions; `sonner` toast for page-level outcomes (§7.1; open question) |
| Disclosure | 11 `<details>`, 7 `aria-expanded` toggles | `Accordion`/`Collapsible` |
| Eyebrow/metadata | `.td-eyebrow` (not mono), `.eyebrow` (mono, dead) | mono 11px uppercase `label` style only |

## 5. Architecture

**No capability, surface, route or data-model change.** This is a presentation
refactor; each phase is behaviour-preserving and covered by the existing tests
plus new component tests. Capabilities, permissions (`can()`), server actions,
the URL-borne inventory filters and the revision tokens are untouched.

### 5.1 Tailwind and cascade layers

- `src/styles/ui.css` (new) is imported by the root layout **before**
  `globals.css`. It declares `@layer theme, base, components, utilities`,
  imports Tailwind's **theme and utilities but not preflight**, `tw-animate-css`,
  the dark `@custom-variant` (`[data-theme="dark"]`, or the system preference
  when no choice is stored — the app's existing rule), the status/ink tokens and
  the `@theme inline` mapping (§6).
- `globals.css`'s element defaults (`button, input, a`, `h1–h3`, `p`, `img`) move
  into `@layer base` so utilities can override them. Every class rule stays
  unlayered and wins as before — **behaviour-preserving for legacy pages**.
- Until phase 6 a **scoped preflight** in `ui.css` resets only what the new system
  owns (`.ui` roots and shadcn's `[data-slot]` elements), at zero specificity.
  Phase 6 swaps it for Tailwind's preflight once no legacy CSS depends on UA
  defaults.
- The global `*{border-radius:0!important; box-shadow:none!important}` stays: it
  is the identity. Consequence: shadcn's box-shadow focus rings would vanish, so
  **our copies use `outline`** (`focus-visible:outline-2 outline-ring`). This is
  the one systematic edit to shadcn sources.

### 5.2 Files

```
src/components/ui/            shadcn primitives (copied, themed): button, badge, checkbox,
                              dropdown-menu, popover, table, input, separator, tooltip,
                              sheet, accordion (+ dialog, select, tabs, command, sonner … per phase)
src/components/ai-elements/   AI Elements (copied from registry.ai-sdk.dev): conversation,
                              message, suggestion, loader (+ tool, sources, prompt-input, … phase 5)
src/components/system/        app-level: DataTable, FilterBar/FacetFilter/ColumnsMenu,
                              StatusGlyph/Glyph, Sparkline, Tile/TileGroup, PageHeader,
                              EmptyState, review/ReviewCard (+ ReviewValues/Sources/Note)
src/lib/admin/surfaces.ts     one list of admin surfaces → home tiles and section bar
src/lib/data/admin-overview.ts  the home's counts and 30-day series (aggregate SQL)
src/lib/utils.ts              `cn()` (clsx + tailwind-merge)
components.json               shadcn config (aliases @/components/ui, @/lib/utils)
```

`src/components/system` is the only place app code builds shared UI; pages
compose it. A pattern used twice becomes a system component (§10 rule).

## 6. Design tokens → shadcn variables

No second palette: shadcn's semantic colour names are mapped in `@theme inline`
**onto the tokens globals.css already defines and already swaps for dark mode**,
so dark mode and the `NEXT_PUBLIC_COLOR_*` brand override keep working with no
extra rules.

### 6.1 Colour

| shadcn / Tailwind token | Maps to | Light | Dark |
|---|---|---|---|
| `background` | `--background` | #F7F4EE | #0F0F0F |
| `foreground`, `card-foreground`, `popover-foreground` | `--on-surface` | #171717 | #F5F5F0 |
| `card`, `popover` | `--surface-container` | #FFFFFF | #1A1A1A |
| `muted` | `--surface-container-low` | #EEE8DE | #131313 |
| `muted-foreground` | `--on-surface-muted` | #59524A (7.0:1) | #A1A1AA (7.5:1) |
| `secondary`, `accent` (hover/neutral fill) | `--surface-container-high` | #E2D8CA | #2A2A2A |
| `primary` (fills) | `--primary` | #FF6B35 | #FF6B35 |
| `primary-foreground` | `--ink-on-primary` **(new)** | #0F0F0F (6.8:1) | #0F0F0F |
| `primary-ink` (orange text, marks, focus) | `--primary-ink` **(new)** | #B8431A (5.0:1 paper, 5.5:1 white) | = `--primary` (6.8:1) |
| `ring` | `--primary-ink` | | |
| `border` (hairlines) | `--outline` | #CFC6B8 | #2A2A2A |
| `input` (control boundaries, 3:1) | `--outline-strong` **(new)** | #8F8676 (3.3:1) | #6E6A64 |
| `rule` (table rows) | `--rule` **(new)** | 10% ink | 10% ink |
| `destructive`, `bad` | `--status-bad` **(new)** | #B31B1B (6.2:1) | #F0645A (6.1:1) |
| `warn` | `--status-warn` **(new)** | #8A5300 (5.8:1) | #E0A23A (8.6:1) |
| `ok` | `--status-ok` **(new)** | #2F7D4F (4.6:1) | #5CC98A (9.3:1) |
| `idle` | `--on-surface-muted` | | |
| `brand` (Cornell Crimson, heritage stamp only) | `--secondary` | #B31B1B | #B31B1B |
| `chart-1…5` | primary, muted, crimson, warn, ok | | |

Cornell Crimson stays a heritage accent; **it is not the error colour in dark
mode** (2.8:1). The `--td-*` palette is retired in phase 5 by mapping it onto
these tokens and then deleting it.

### 6.2 Type

| Role | Font | Size / line | Use |
|---|---|---|---|
| `display` | Space Grotesk 500, uppercase | clamp(42–88px) / 0.92 | gallery and tool hero only |
| `h2` page title | Space Grotesk 500, uppercase | 26–30px / 1.05 | `PageHeader` |
| `number` | Space Grotesk 500, tabular | 40px / 1 | tile headline |
| `body` | Inter 400 | 14–15px / 1.5 | prose, ledes |
| `table` | Inter 400 | **13px / 1.35** | table cells, review values |
| `label` | JetBrains Mono 500, uppercase, 0.08em | **11px** / 1.3 | eyebrows, column heads, buttons, glyph words |
| `micro` | JetBrains Mono, uppercase | 10px | column heads, captions |

Seven sizes (10, 11, 13, 14, 26–30, 40, display) replace 25. **Phase 1 loads the
fonts** with `next/font/local` from vendored WOFF2 files (all three are OFL;
~150 KB) so builds stay offline-safe (Article 3) and rendering stops depending
on the visitor's machine.

### 6.3 Spacing, radius, size

- 4px grid: 4, 8, 12, 16, 24, 32, 48. Page gutter 16px (phone) / 32px.
- Radius **0** everywhere (`--radius-*: 0`).
- Controls: 32px default, 28px `sm` (toolbars, facets), 24px `xs` (row actions).
  Touch targets on a phone stay ≥ 40px via row height, not button height.
- Breakpoints: Tailwind's `sm 640 / md 768 / lg 1024 / xl 1280` replace 14 custom ones.

## 7. Components

### 7.1 shadcn primitives adopted → what they replace

| shadcn primitive | Replaces | Notes |
|---|---|---|
| `Button` (variants `default`, `quiet`, `outline`, `ghost`, `destructive`, `link`; sizes `default/sm/xs/icon`) | 7 families: `admin-button`, `account-button`, `intake-button`, `td-button`, `admin-action`, `flag-submit/cancel`, chat icon buttons, `admin-filter-clear` | Mono uppercase label; `quiet` (hairline box) is the default; one `default` per surface |
| `Badge` | `tool-card-tag`, `admin-tag`, `account-tag`, `mcp-kind`, `td-chip` (labels only) | Tags/labels. **Status is StatusGlyph, not Badge.** |
| `Checkbox`, `Input`, `Textarea`, `Select`, `Label`, `Form` (react-hook-form not adopted; field layout only) | `admin-field`, `admin-filter`, `flag-*`, `account-field`, intake fields (112 controls) | Visible label always; hint text below; error text `bad` |
| `DropdownMenu` | `ProfileMenu`'s hand-rolled menu, gallery multi-select dropdowns, facet selects | Radix handles roving focus/Escape |
| `Popover` | gallery filter dropdowns | |
| `Dialog` | `FlagButton` modal, `ResearchAgainDialog`, `RefreshDialog` | Focus trap, Escape, focus return — fixes finding 10 for these |
| `Sheet` | `ToolEditorPanel` (panel and phone sheet), chat overlay | One side-sheet pattern |
| `Accordion` / `Collapsible` | 11 `<details>`, 7 `aria-expanded` toggles | |
| `Tabs` | gallery grid/table toggle, import filter chips, intake queue/imports split | `role=tab` where today there is `aria-pressed` |
| `Tooltip` | `title=` attributes on icon buttons | |
| `Table` (markup only) | — | used inside `DataTable` |
| `Command` (cmdk) | — | ⌘K palette, phase 4 (§7.5) |
| `Sonner` (toast) | — (page-level outcomes today are inline lines) | Open question: keep inline-only? |
| `Separator`, `Skeleton` | `skeleton-pulse`, `loading-line` (uses an undefined `--accent`) | |

### 7.2 App-level components (built in the spike unless marked)

| Component | Purpose | Replaces |
|---|---|---|
| **DataTable** | TanStack Table v8 state (sort, visibility, selection) + our markup: 13px, ~34px rows, hairlines, sticky header, right-aligned numeric columns, roving-tabindex keyboard (↑/↓ j/k, Space/x select, Enter activate, Home/End), header "select all shown", sticky bulk bar, phone `mobileRow`. Filtering stays with the caller (URL-borne filters are the page's business). | `InventoryTable`, `UsersTable`, `ImportTable`, `ImportMapping` preview, `MirrorMapping`, `IntakeTableCard`'s table, `RefreshList`, `ImportsList`, gallery table view |
| **FilterBar / FacetFilter / ColumnsMenu** | Search, single-value facets **with counts per value** (given the other active filters), Clear, "Showing n of N", Columns | `InventoryFilters`' selects, gallery filter console, import filter chips, queue splits |
| **StatusGlyph / Glyph** | glyph + word, six tones (§3.4) | 17 badge families' status uses, `card-status-dot`, `status-square`, `live-dot` |
| **Sparkline** | word-sized bars/line, last value in accent, `role=img` + sentence | — (new) |
| **Tile / TileGroup** | admin home tile: icon, mono title, headline number + what it counts, ≤4 facts with glyphs, optional sparkline; whole tile is the link; unreadable ≠ 0 | `admin-index-list` |
| **PageHeader** | `// ADMIN / GROUP` breadcrumb, title, lede, facts line, actions slot | admin layout header + `admin-section-head` + `td-eyebrow` (28 uses) |
| **EmptyState** | a sentence that names what is missing + the next action | `td-empty`, `admin-empty`, `empty-state`, `project-empty` |
| **ReviewCard** (+ `ReviewValues`, `ReviewSources`, `ReviewNote`) | one decision per card: label + marks + actions on one row; before/after side by side (stacked on a phone); sources as verbatim quotes with host and a verified/not-found glyph; notes | `ProposalCard`'s markup (done), then intake `ProposedRecord`, `IntakeRow`, `ImportTable` rows' duplicate cell, `IntakeTableCard` rows |
| **DuplicateChoice** (phase 3) | "this is a duplicate of X": add as unit / different tool / skip — radio semantics | 3 implementations (§4.3) |
| **AdminNav** | section bar (§8.1), `aria-current` on the most specific match | — (new) |
| **RowStatus** (kept) | inline outcome of a row action | already shared |
| **CommandPalette** (phase 4) | ⌘K | — |

### 7.3 Old → new (inventory)

| Old | New | Status in spike |
|---|---|---|
| `InventoryFilters.tsx` (307) + `InventoryTable.tsx` (217) | `InventoryBoard.tsx` (392) on `DataTable` (~310) + `FilterBar` (~200, shared) | page switched; old two files unused, kept for review — **to delete** |
| `admin-inventory-table`, `admin-filters`, `admin-attention*`, `admin-state`, `admin-thumb`, mobile inventory cards CSS (~330 lines) | utilities | CSS still present — **to delete** in phase 2 |
| `admin/page.tsx` list + `.admin-index*` CSS | tiles + `loadAdminOverview` | switched; `.admin-index*` CSS unused — **to delete** |
| `ProposalCard` markup + `admin-proposal*` CSS in `admin-refresh.css` (~150 lines) | `ReviewCard` parts | switched; CSS unused — **to delete** |

### 7.4 ReviewCard: the one review primitive

All five review systems decide the same thing — accept a value research or a
person proposed, or not — and share: a subject name; a status; a before/after or
a proposed record; evidence (sources, confidence); a duplicate match; accept /
reject / discard; an inline-confirmed destructive action; a status line. So:

```
LABEL   ◆ DIFFERS  ■ SAFETY  ▲ CHANGED SINCE                 [ACCEPT] [REJECT]
NOW ─────────────────────────────────  │ PROPOSED ───────────────────────────
value on the record (muted)               value found (ink)   Adds: PETG, TPU
SOURCES  ● "verbatim quote" formlabs.com   ■ "quote" example.com  quote not found
Why: the manual distinguishes pausing from stopping.
```

- **Refresh** and **chat proposals**: built (`ProposalCard` composes it).
- **Intake approve page** (`PreliminaryToolPage`, 1,259 lines): the proposed record
  becomes a list of `ReviewCard`s, one per field group, with `ConfidenceStrip` as
  the card header marks; the form stays editable in `ReviewValues`' "proposed"
  side. Largest single consolidation (§10).
- **Import review**: each row is a compact `ReviewCard` in a `DataTable`-backed
  list; `DuplicateChoice` inside.
- **Intake table in chat** (`IntakeTableCard`, 696): same rows, rendered as an
  AI Elements custom part (§8.3).

### 7.5 Command palette (⌘K)

Worth it for admins, **phase 4**: the admin has 10 surfaces, 100+ tools and a
chat. `Command` over three sources, all already on the client or one cheap read:
surfaces (from `ADMIN_SURFACES`, permission-filtered), tools by name/official
name/slug (match-sorter, as the inventory does), and actions ("Add equipment",
"Refresh catalog", "Open assistant"). Opens with ⌘K / Ctrl-K, and `/` focuses the
page's FilterBar search. Not shown to anonymous visitors (the gallery search is
their palette).

## 8. Information architecture

### 8.1 Admin

Today: ten surfaces in one text list, each a dead end back to `/admin`. Proposed,
grouped by the job a person is doing (and the order equipment moves through the
lab):

```
Overview ┃ Add equipment      ┃ Keep data fresh          ┃ Queues                          ┃ People & settings
         ┃ Intake · Import    ┃ Inventory · Refresh ·    ┃ Maintenance · Corrections ·     ┃ People · Notion mirror
         ┃                    ┃ Manuals                  ┃ Projects                        ┃ (· Tokens, later)
```

- **One list, two views.** `src/lib/admin/surfaces.ts` feeds both the home tiles
  and the section bar, so a new page appears in both or neither. Each entry keeps
  its own permission; nobody is shown a surface that refuses them.
- **Home = tiles**, four columns (one per job), each tile a live count with what
  it counts; accent border when the count is work waiting for a person; 30-day
  sparklines on tickets, corrections and intake. `loadAdminOverview` is 9
  aggregate statements in parallel plus the inventory read the table already
  runs, so a tile can never disagree with the page it links to.
- **Section bar** on every admin page (replaces the 88px "ADMIN" heading; an
  `sr-only` h1 keeps the outline). On a phone it scrolls sideways inside itself.
- **Merges, as IA not as routes** (phase 4): *Add equipment* becomes one page with
  tabs — Queue · Imports · Import a list — instead of imports being a list at the
  bottom of intake. *Keep data fresh*: Refresh and Manuals are views of the
  inventory's attention flags and could become inventory tabs; recommended to
  keep them separate pages for now (different permissions may diverge) but
  cross-link from the facet ("No manual → Manuals"). *Queues*: the three queues
  keep separate pages (separate permissions, each tested as its own); they adopt
  one `QueueList` layout (open work first, settled behind a disclosure — already
  the shared rule) and a FilterBar.
- **Tile counts become badges in the bar** only if the owner wants them (open
  question): a count in the nav is noise on pages where it is not the job.

### 8.2 Public pages

- **Gallery**: keeps the display header and grid; the table view moves to
  `DataTable` (fixing its invalid ARIA) and the filter console to `FilterBar`.
- **Tool page**: one column of facts, not panels: hero (image, name, official
  name, status glyph line: `● AVAILABLE · ▲ TRAINING REQUIRED · 2 UNITS`), then
  Safety (PPE, e-stop, restrictions — the one place a tinted panel is justified),
  then a dense `<dl>` of specs and materials, resources as a list with type glyphs,
  units as a small `DataTable`, projects. Remove the rounded `td-*` design that
  the global rule already squares.
- **Projects, About, /mcp, account/tokens, oauth**: `PageHeader`, `Button`,
  `EmptyState`, `DataTable` for tokens/connected apps.

### 8.3 Chat placement

- **Docked side sheet**, full height, 440px at ≥ `sm`, full screen on a phone
  (spike). Today it is a 360×560 floating card in which a proposal card or an
  intake table has no room (see before/after).
- The FAB stays as the launcher on public pages. **In admin**, the bulk-action
  bar and the FAB collide at bottom-right (seen in the spike); the admin opens the
  assistant from the section bar / ⌘K instead, and the FAB is hidden there
  (open question).
- On a desktop the sheet should not cover the page it is about: phase 5 makes it
  a push-aside panel on the tool page (content reflows to the remaining width).

## 9. Chat on Vercel AI Elements

The app keeps its own `/api/chat` route, tools and `useChat` (AI SDK v6); we
adopt **AI Elements' components**, copied into `src/components/ai-elements/` from
`registry.ai-sdk.dev` (the same copy-in model as shadcn), not the Chat SDK
template's backend. The template (chat-sdk.dev) is a pattern reference for
history, attachments and artifacts only.

### 9.1 Mapping

| ChatFab today (lines) | AI Elements | Notes |
|---|---|---|
| overlay + sheet + header (700–744) | `Sheet` + header | spike: docked side panel; phase 5 moves to `Sheet` for focus trap/Escape/return |
| message list `ul.chat-messages`, hand-rolled auto-scroll (605–611) | **`Conversation` / `ConversationContent` / `ConversationScrollButton`** | spike ✔: `use-stick-to-bottom`, `role="log"` (fixes "replies not announced") |
| bubbles `chat-msg-*` | **`Message` / `MessageContent`** | spike ✔: assistant = unboxed prose; user = square surface block; cards full width |
| `ReactMarkdown` + `.chat-markdown` (140 lines CSS) | **`MessageResponse`** | spike ✔ with react-markdown; upstream uses `streamdown` (open question §13) |
| starter chips `chat-suggestion` (tool starters, "Curate this entry", generic three) | **`Suggestions` / `Suggestion`** | spike ✔: stacked (upstream scrolls sideways; our starters are sentences) |
| typing dots, "Reading: manuals" | **`Loader`** (+ status line) | spike ✔ |
| tool status lines (`toolStatusLabel`, 9 tools) | **`Tool`** header (`ToolStatus` in spike) | spike ✔ collapsed state; full `Tool` (input/output) for admin curation turns |
| `<cite>` stripped, source parts never rendered (`stripCitations`) | **`Sources` + `InlineCitation`** | phase 5: manual page citations ("Form 4 manual p. 32") become inline citations and a Sources list — the answer shows its evidence |
| composer: attach, dictation, input, send (935–990) | **`PromptInput`** (attachments, speech button, submit status) | phase 5; keeps downscale, `/api/uploads`, `withRecentPhotos` |
| `IntakeTableCard`, `ChatProposalCards`/`ProposalCard`, `ImportCard` (`data-*` parts) | **custom parts inside `MessageContent`** | stay ours; they are `ReviewCard`s (§7.4) |
| allowance ceiling / sign-in row | `Message` with `data-kind="notice"` | spike ✔ |
| 9 inline SVG icons | `lucide-react` | |

### 9.2 Theming

AI Elements are shadcn components, so they inherit §6 unchanged: `bg-secondary`
user block, `text-muted-foreground`, `border-border`, `outline-ring` focus; the
global square rule removes their rounded corners. No chat-specific palette; the
428 + 177 lines of chat CSS and the 316-line `admin-import.css` that ChatFab loads
on every public page go in phase 5.

## 10. Consolidation plan (DRY)

Rule going forward: **a pattern used on two surfaces is a system component; a
page may compose, not restyle.** Enforced in review and by a lint rule banning
new `className` strings that start with `admin-`, `td-`, `intake-`, `account-`,
`chat-` after phase 6.

| Area | Now | After | Est. removed |
|---|---|---|---|
| CSS | 7,315 lines, 8 files | `ui.css` (~200) + `globals.css` chrome, gallery cards, tool hero, identity rules (~1,000–1,500) | **~5,500–6,000 lines (≈80%)**; 8 files → 2 |
| Tables | 8 implementations | `DataTable` + column defs | ~900 lines TSX+CSS |
| Review | 8 components, 5 systems | `ReviewCard` + per-flow composition | ~1,200 lines (PreliminaryToolPage alone ~500) |
| Buttons | 7 families, 44 class strings | `Button` (6 variants) | ~350 CSS |
| Status/badges | 17 families | `StatusGlyph` + `Badge` | ~400 CSS |
| Filters | 4 | `FilterBar` | ~450 (gallery console 325 CSS) |
| Dialogs | 7 | `Dialog`/`Sheet` | ~250 |
| Chat | ChatFab 993 + 605 CSS | AI Elements + ~500-line ChatFab (logic) | ~900 |
| Dead code now | `UnitsList.tsx`, `id-card*` CSS, 46 unused classes, spike-orphaned `InventoryFilters.tsx`, `InventoryTable.tsx`, `.admin-index*`, `admin-proposal*` CSS | — | ~1,300 |
| **Total** | | | **~8,000–9,000 lines, ~25 files** net of ~2,500 new system/ui lines |

Estimates, not measurements; each phase PR reports its actual diff.

## 11. The spike: what it proved and disproved

Built on `v5/ui-spike` against the live data paths (same reads, same server
actions, same permission checks), screenshots at 1440 and 390, dark and light.

| Prototype | Result |
|---|---|
| **shadcn on Tailwind 4 without preflight** | **Proved.** Theme + utilities import cleanly under cascade layers; legacy pages unchanged (same `npm test`, build, and visual check); shadcn components inherit the identity through `@theme inline` with no second palette. Two surprises, both solved: unlayered element rules (`button { font: inherit }`) beat utilities until moved to `@layer base`; without preflight, `<button>`/`<ul>`/`<dd>` carry UA styles, hence the scoped preflight. |
| **/admin tiles** | **Proved.** One desktop screen (900px) for all 10 surfaces with 26 live numbers and 3 sparklines vs a 1,303px text list with one number. 9 aggregate queries + the inventory read. |
| **/admin/inventory on DataTable** | **Proved.** 101 rows: desktop 8,888 → 4,439 px (row ~81 → ~35px), phone 31,561 → 7,678 px. Adds sorting, facet counts, Columns, keyboard (↑↓/jk, Space/x, Enter opens the editor), select-all-shown, sticky bulk bar. URL filter contract unchanged (`?attention=never_reviewed`). |
| **ReviewCard** | **Proved** for refresh and chat proposals (one component, both surfaces; every existing ProposalCard/RefreshReview/ChatProposalCards test passes unchanged). Refresh review 1,369 → 1,037 px. Not yet proved for the intake approve form (editable proposed record) — phase 3's risk. |
| **AI Elements chat** | **Partly proved.** Conversation/Message/Suggestions/Loader drop into ChatFab with its logic untouched; 47 ChatFab tests pass after 7 assertions moved from CSS classes to `data-role`/`data-kind`. The CLI is unusable non-interactively (it prompts to overwrite our themed `button.tsx`, and `ai-elements --help` installed every component's dependencies — reverted); copy-from-registry works. `PromptInput`, `Tool`, `Sources` not attempted. |
| **Contrast fix** | **Proved.** `--primary-ink` keeps the orange identity in dark mode and passes AA in light. |
| **React Compiler** | **Caveat.** TanStack's `useReactTable` opts `DataTable` out of compiler memoisation (lint warning). Acceptable at a few hundred rows; revisit if tables grow. |
| **TanStack v9** | npm's latest is v9 (new API); the spike pins **v8.21** (shadcn's DataTable pattern). Migration is a later, separate change. |

**Packages added (all shadcn / AI Elements requirements):** `radix-ui` ^1.6.7,
`class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.7.0,
`lucide-react` ^1.48.0, `@tanstack/react-table` ^8.21.3, `tw-animate-css` ^1.4.0,
`use-stick-to-bottom` ^1.1.6 (AI Elements `Conversation`). The shadcn CLI also
installed an unrelated npm package named `cn` twice (a mis-resolved alias); it was
uninstalled both times.

### Screens

| | Before | After |
|---|---|---|
| Admin home | [desktop](../MakerLab_design/screens/before-admin-home-desktop.webp) · [phone](../MakerLab_design/screens/before-admin-home-phone.webp) | [desktop](../MakerLab_design/screens/after-admin-home-desktop.webp) · [phone](../MakerLab_design/screens/after-admin-home-phone.webp) · [light](../MakerLab_design/screens/after-admin-home-desktop-light.webp) |
| Inventory | [desktop](../MakerLab_design/screens/before-inventory-desktop.webp) · [phone](../MakerLab_design/screens/before-inventory-phone.webp) · [light](../MakerLab_design/screens/before-inventory-desktop-light.webp) | [desktop](../MakerLab_design/screens/after-inventory-desktop.webp) · [phone](../MakerLab_design/screens/after-inventory-phone.webp) · [light](../MakerLab_design/screens/after-inventory-desktop-light.webp) · [facet](../MakerLab_design/screens/after-inventory-facet.webp) · [selection](../MakerLab_design/screens/after-inventory-selection.webp) |
| Refresh review | [desktop](../MakerLab_design/screens/before-refresh-review-desktop.webp) · [phone](../MakerLab_design/screens/before-refresh-review-phone.webp) | [desktop](../MakerLab_design/screens/after-refresh-review-desktop.webp) · [phone](../MakerLab_design/screens/after-refresh-review-phone.webp) · [light](../MakerLab_design/screens/after-refresh-review-desktop-light.webp) |
| Chat | [desktop](../MakerLab_design/screens/before-chat-desktop.webp) · [phone](../MakerLab_design/screens/before-chat-phone.webp) | [desktop](../MakerLab_design/screens/after-chat-desktop.webp) · [phone](../MakerLab_design/screens/after-chat-phone.webp) · [light](../MakerLab_design/screens/after-chat-desktop-light.webp) · [starters](../MakerLab_design/screens/after-chat-starters-desktop.webp) |

A side-by-side review page with the IA diagram, token palette and findings is
`v5/.livecheck/ui-spike/review.html` (local, not committed).

## 12. Accessibility and i18n requirements

**Accessibility (WCAG 2.2 AA), each checked in the phase that touches it:**

- Text ≥ 4.5:1, large text ≥ 3:1, control boundaries and focus indicators ≥ 3:1,
  in both themes (§6.1 values are computed; a unit test asserts the token pairs).
- Focus: every interactive element shows a 2px `--primary-ink` outline on
  `:focus-visible`; no `outline: none` without a replacement (lint rule).
- Status never by colour alone (StatusGlyph); sort state on the header cell
  (`aria-sort` on `th`, not on a button — fixes the gallery table).
- Tables: real `<table>`/`th scope`; one row in the tab order (roving tabindex);
  keyboard selection and activation; the phone list has the same actions.
- Dialogs/sheets: focus trap, Escape, initial focus, focus return (Radix) —
  applies to chat, flag, research-again, refresh, editor.
- Live regions: chat `role="log"`; outcome lines `role="status"`/`alert`.
- Every input has a visible label (fixes the two unlabeled inputs in
  `ProjectSubmitForm`); the hardcoded English "Dictate" label moves to next-intl.
- Motion: tw-animate respects `prefers-reduced-motion`; no pulsing indicators
  without a reduced-motion override.
- Targets ≥ 24×24 (2.5.8); rows give ≥ 40px touch height on a phone.

**i18n (Article 6):** every visible string through next-intl, including
aria-labels, sparkline sentences, facet names and glyph words; English added in
the same PR, other 11 locales fall back (the parity test enforces keys). ICU
plurals for counts (`selectedWord`). No string concatenation of translated
fragments except via message placeholders; `dir="rtl"` layouts use logical
properties (`ms-`/`me-`, `rtl:` variants — the chat sheet flips sides). Numbers in
tables stay Western digits and ISO dates (locale-neutral, comparable), prose
numbers via `Intl.NumberFormat`.

## 13. Phased build order

Each phase is its own spec amendment + PR, leaves `main` shippable, and ships
with tests and before/after screenshots at 1440/390 in both themes.

| # | Phase | Content | Tests |
|---|---|---|---|
| 1 | **Tokens + primitives** | `ui.css`, `@layer base` move, scoped preflight, fonts via `next/font/local`, `--primary-ink`/status/outline-strong tokens, shadcn primitives, `cn`, `components.json`, jsdom Radix polyfills, system primitives (StatusGlyph, Sparkline, PageHeader, EmptyState). No page changes except fonts. | token contrast unit test; primitive component tests; full suite; visual check of every page |
| 2 | **DataTable everywhere** | DataTable + FilterBar; inventory (spike code), users, imports list, refresh list, mirror mapping, tokens/connected apps, gallery table view; delete `InventoryFilters`/`InventoryTable` and their CSS | DataTable unit/component; each page's existing tests; e2e `admin-inventory` updated from `combobox` to facet menus |
| 3 | **Review surfaces** | ReviewCard + DuplicateChoice; refresh + chat (spike), intake approve page, intake queue, import review, IntakeTableCard | existing intake/import/refresh tests; e2e `intake.spec` |
| 4 | **Admin IA + home** | `surfaces.ts`, AdminNav, tiles + `loadAdminOverview` (spike), Add-equipment tabs, queues on QueueList + FilterBar, ⌘K palette | overview data test (PGlite); nav test; e2e admin navigation |
| 5 | **Public pages + chat** | gallery filter/table, tool page layout, projects/about/mcp/account/oauth; AI Elements: Sheet, PromptInput, Tool, Sources/InlineCitation (manual page citations), FAB rules; retire `--td-*` | ChatFab suite; e2e chat, gallery, tool-detail, theme-i18n, dark-mode |
| 6 | **Delete old CSS** | remove legacy classes and files, swap scoped preflight for Tailwind preflight, lint rule against legacy class prefixes and `outline:none` | full suite + e2e + screenshot sweep diff |

Phases 2 and 3 can run in parallel after 1; 4 depends on 2 (tables) only for the
queues; 5 depends on 1; 6 is last.

## 14. Testing

- **Unit**: `loadAdminOverview` against PGlite (counts per table, zero-filled
  30-day series); `fill`; token contrast pairs; `inventory-filters` (unchanged).
- **Component** (RTL + jsdom, Radix polyfills in `vitest.setup.ts`): DataTable
  sorting/aria-sort, selection + bulk bar, roving keyboard, empty state; facet
  counts and URL write-back; AdminNav most-specific `aria-current`; Tile's
  unreadable-is-not-zero; StatusGlyph never colour-only; ReviewCard via the
  existing ProposalCard/RefreshReview/ChatProposalCards suites.
- **E2E**: the inventory, intake, chat and navigation specs update selectors in
  the phase that changes them (spike did not run E2E — §15 risk).
- **What would embarrass us**: a tile showing 0 when the count failed; a facet
  that empties the table silently; a bulk refresh that sends rows the reviewer
  filtered away (selection survives filtering by design — the bar says how many);
  orange text failing contrast on paper; the chat panel covering the only Accept
  button on a phone.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Legacy CSS depends on UA defaults the eventual preflight removes | scoped preflight until phase 6; screenshot sweep diff before/after the swap |
| Unlayered legacy rules override new components where both apply | new components never carry legacy classes; `.ui` roots; delete per phase |
| Radix in jsdom (ResizeObserver, pointer capture) | polyfills added in `vitest.setup.ts` (spike) |
| E2E selectors (combobox → menu, `li.chat-msg` → `data-role`) | update in the same phase PR; spike lists them |
| Bundle size (+radix, lucide, tanstack) | tree-shaken per import; measure per phase; admin-only code stays in admin routes |
| React Compiler skips DataTable | acceptable at this scale; revisit |
| AI Elements CLI prompts/over-installs | copy from registry JSON; record deps per component |
| Fonts: `next/font/google` needs network at build | vendor WOFF2 + `next/font/local` |
| Maintenance mode (AGENTS.md) — this is a large change | phased, behaviour-preserving PRs; owner decides scope (§16) |

## 16. Open questions (owner)

1. **Scope under maintenance mode**: all six phases in v5, or phases 1–4 (admin)
   here and the public/chat work in Blueprint? *Owner, before phase 1.*
2. **Fonts**: vendor Space Grotesk / Inter / JetBrains Mono (recommended), or
   accept system fallbacks? *Owner.*
3. **Accent ink**: approve `--primary-ink` #B8431A for orange text on light
   surfaces (fills stay #FF6B35)? *Owner.*
4. **Crimson**: keep Cornell Crimson as a heritage accent only (not errors)? *Owner.*
5. **Nav counts**: show waiting counts in the section bar, or only on tiles? *Owner.*
6. **Chat**: streamdown (AI Elements default, adds code/math/mermaid) or keep
   react-markdown? FAB hidden in admin in favour of nav/⌘K? *Owner + Niti.*
7. **Density toggle** (compact/comfortable) — needed for Luis/Niti's daily use?
8. **Toasts** (sonner) for page-level outcomes, or keep inline-only?
9. **Screenshot of record**: keep the Stitch concept `screen.png` as the identity
   reference, or replace it with a real screen once fonts load? (Kept for now.)

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a
design changed usually outlives the change.

### 2026-09-25 — Owner decisions on the open questions (§16)

The owner answered all nine questions before phase 1 began:

1. **Scope:** all six phases in v5, phase by phase, each phase shippable on its
   own (§13 unchanged). Nothing moves to Blueprint.
2. **Fonts:** self-host Space Grotesk, Inter and JetBrains Mono (all OFL). No
   runtime request to Google Fonts; `next/font/local` over vendored WOFF2 (or
   `next/font/google`'s build-time self-hosting) are both acceptable. Phase 1
   uses `next/font/local` so the build stays offline-safe (§15).
3. **Accent ink:** `--primary-ink` #B8431A is approved for orange *text and
   marks* on light surfaces; orange *fills* stay #FF6B35 (§6.1 unchanged).
4. **Crimson:** heritage accent only. Errors and destructive actions use
   `--status-bad`, never `--secondary`.
5. **Nav counts:** waiting counts appear on the admin home **tiles only**, never
   in the section bar (§8.1's last bullet is decided: no).
6. **Chat:** adopt `streamdown` (AI Elements' default renderer) for Markdown,
   replacing `react-markdown` in the chat. Hide the floating chat button on
   admin pages; admins open the assistant from the section bar / ⌘K. Both land
   in phase 5 (chat), not earlier.
7. **Density toggle:** no. One density (§5.3 / §6); the open question is closed.
8. **Toasts:** no. `sonner` is **not adopted**; page-level outcomes stay inline
   (`RowStatus` and the page's own status line, `role="status"`/`alert`). The
   `Sonner` row of §7.1 and the §4.3 "Outcome line" pick are superseded.
9. **Screenshot of record:** keep the Stitch concept `screen.png` as the
   identity reference (DESIGN.md unchanged).

### 2026-09-25 — Phase 1 as built (tokens + primitives)

Branch `v5/ui-phase-1`. Where phase 1 differs from §13's row, and why:

- **Scope grew by owner direction:** the token-level contrast and focus fixes
  are applied to the *legacy* CSS now, not only to new components, and the
  audit's dead code is deleted now (§13 said "no page changes except fonts").
  Legacy pages therefore change in three ways only: the fonts load, orange text
  and error/warning text move to AA tokens, and keyboard focus is visible.
  - Orange **text** (`color: var(--primary)` / `var(--td-accent)`, and the
    same rule's orange border) → `--primary-ink`; white on an orange fill →
    `--ink-on-primary`; every `var(--secondary)` (all 40 were errors or
    warnings, none heritage) → `--status-bad`; `--td-warning` → `--status-warn`.
    Orange **fills** and standalone orange rules are untouched (identity).
  - Focus: one `:focus-visible` rule in `@layer base` (2px `--primary-ink`,
    offset 2px); all 12 `outline: none` and the 4 per-component focus outlines
    removed. `src/styles/focus.test.ts` bans `outline: none|0` until phase 6's
    lint rule.
  - **Not done here:** control boundaries on legacy inputs stay `--outline`
    (the owner's decision named ink and status colours); they move to
    `--outline-strong` as each control is replaced by `Input`/`Select`.
- **Dead code actually removed:** the 46 unused classes (all of `id-card*`,
  `detail-*`, `spec-chip*`, `meta-chip*`, `doc-chip`, `td-coming-soon`, …),
  `UnitsList.tsx` and its test, the 5 classes only it used, `--td-bg`, the
  composer's three identical icon-button blocks (merged), and the redundant
  focus rules — about 750 lines. The "~620 lines of exact duplicates" of §4.2
  were **not** merged: they are identical declaration blocks under unrelated
  selectors, mostly in different files loaded on different routes; merging
  them would couple unrelated components and reorder the cascade, and they go
  with their components in phases 2–6. Legacy CSS: 7,315 → 6,870 lines, plus
  `ui.css` (≈180).
- **Two token values changed** so every text/boundary pair passes on all three
  light surfaces, including the `muted` plate (#EEE8DE) that §6.1 did not
  check: `--status-ok` #2F7D4F → **#2B7549** (4.6:1 on muted), `--outline-strong`
  #8F8676 → **#8A8171** (3.2:1 on muted). `src/styles/tokens.test.ts` reads the
  values from the stylesheets and asserts every pair in both themes.
- **Open for the owner:** the approved `--primary-ink` #B8431A is **4.47:1 on
  the `muted` plate** (5.0 on paper, 5.5 on white). Kept as approved; the test
  pins it as the one known exception and DESIGN.md says orange text does not
  sit on `muted`. #B3401A would pass there (4.7:1) if the owner prefers.
- **Fonts:** `next/font/local` over vendored variable WOFF2 in `src/fonts/`
  (OFL licences beside them), weights 400–700, Inter pinned to its default
  optical size, subset to Latin + Latin Extended + Cyrillic (Space Grotesk has
  no Cyrillic) + punctuation, arrows and geometric shapes: 36 + 72 + 40 KB.
  CJK, Arabic, Hebrew and Devanagari fall through to system fonts, as before.
  `--font-display/body/mono` in globals.css are built from the next/font
  variables, so no legacy rule changed.
- **Tailwind sources** are limited to `src/` (`source("..")` on the utilities
  import). No legacy className is also a utility name except `sr-only`, whose
  utility matches the legacy rule.
- **`cn`** uses `extendTailwindMerge` so the `text-micro/label/table` steps are
  read as sizes; stock tailwind-merge read them as colours and dropped them.
- **Primitives shipped** (themed, logical properties for RTL, fade-only
  motion, outline focus): `button`, `badge`, `input`, `checkbox`, `separator`,
  `table`, `dropdown-menu`, `popover`, `tooltip`. `Badge` has no status or
  destructive variant (status is `StatusGlyph`). `sheet` and `accordion` wait
  for their phases. **System components:** `StatusGlyph`/`Glyph`, `Sparkline`
  (empty series safe), `PageHeader` (breadcrumb landmark named via next-intl
  `ui.breadcrumb`; `as="h1"|"h2"`), `EmptyState`. `Tile` is phase 4.
- **Packages added:** `radix-ui` ^1.6.7, `class-variance-authority` ^0.7.1,
  `clsx` ^2.1.1, `tailwind-merge` ^3.7.0, `lucide-react` ^1.48.0,
  `tw-animate-css` ^1.4.0. Not added: `@tanstack/react-table`,
  `use-stick-to-bottom` (phases 2 and 5).

### 2026-09-25 — Phase 2 as built (shared tables)

Branch `v5/ui-phase-2`. §13's row is built as listed — inventory, users,
imports list, refresh list, mirror mapping, tokens and connected apps, the
gallery table view — on `DataTable` + `FilterBar`. §7.2 also names
`ImportTable`, the `ImportMapping` preview and `IntakeTableCard`'s table as
DataTable users; those are review surfaces and move with `ReviewCard` in
phase 3, so `.admin-table` stays until then. Where phase 2 differs, and why:

- **Files.** `src/components/system/data-table/`: `DataTable`, `FilterBar`,
  `FacetFilter`, `ColumnsMenu`, `facet-options.ts` (`facetOptions`,
  `uniqueValues`) and `use-phone-layout.ts`. The spike's single `FilterBar.tsx`
  is split one component per file. Generic strings live in next-intl
  `ui.dataTable` / `ui.filters` (select all shown, "Showing n of N", Clear
  filters, Columns, the keyboard hint), so a page passes only its table's name.
- **One DOM on a phone, not two.** The spike rendered the table and the phone
  list together and let CSS hide one; with a role select or a ban button in a
  row that is two controls, two states and duplicate ids.
  `usePhoneLayout` (`useSyncExternalStore` over `matchMedia`) answers `null`
  on the server, during hydration and in jsdom — then both render and CSS
  decides, so the first paint is right at every width — and after hydration
  only the visible one renders. Component tests scope queries to
  `getByRole("table", { name })`.
- **`mobileRow` is optional.** A short, narrow table (the mirror's seven
  databases) stays a table on a phone and scrolls sideways inside itself.
- **Sticky header only where the page scrolls the table** (`stickyHeader`,
  default: when there is a phone list); its fill is the page background, so the
  two tables on the tokens card pass `false`. Column `meta` gained `rowHeader`
  (the row's name as `<th scope="row">`, which also names the row for
  assistive tech and tests) and `cellClassName` (body-only classes such as
  `align-top`).
- **Selection says what the filter hides.** Select-all takes the rows shown and
  keeps rows selected under another filter; the bulk bar reads "2 tools
  selected · 1 not shown by the filters", which is §14's "embarrass us" case
  (a bulk refresh sending rows the reviewer filtered away) made visible.
- **`NativeSelect`** (`ui/native-select.tsx`, shadcn's) is added beside §7.1's
  list for a short fixed choice inside a row or form — a person's role, a
  token's expiry, the allowance's person. It keeps the `combobox` role, the
  phone's own picker and every existing test and E2E selector. Facets over a
  table are `FacetFilter` menus, never a select (DESIGN.md §8.4).
- **Users** gained search and Role / Access facets, in the URL like the
  inventory's (`users-filters.ts`: `?q=`, `?role=`, `?access=`). `UsersTable`
  stays a server-safe component that works out each row's locks (the floor list
  is server configuration) and hands plain rows to the client `UsersRoster`.
  Its controls moved to `Input`, `NativeSelect` and `Button` (destructive
  "Ban" at rest, DESIGN.md §8.10), bounded by `--outline-strong`.
- **Refresh list** shows its proposal counts as right-aligned numeric columns
  (Safety, Differs, New, Not found) with a Note column for "Matches the
  manufacturer's pages" and the failure reason; the page's safety-first order
  is the unsorted order. **Imports** show Items and Possible duplicates as
  numbers, a dash while an import has not been read into rows.
- **Zeros are zeros.** Where the old inventory said "None" for no units, the
  table shows a muted `0` (rule 9); a dash means "not applicable yet", never
  zero.
- **Tokens and connected apps** are tables with ISO dates; revoke is one
  shared inline-confirm control (`account/RevokeControl.tsx`). The phone list
  keeps the human-readable dates. The create form moved to `Input`,
  `NativeSelect`, `Checkbox` and `Button`.
- **Gallery table view** is `GalleryTable` (its own file): `aria-sort` on the
  `th`, not on buttons in a div grid; the filtered, ranked order is the
  unsorted order; Enter on a row opens the tool. The filter console is phase 5.
- **Scoped preflight fix.** `ui.css`'s scoped reset now sets `border: 0 solid`
  (as Tailwind's preflight does), not only the colour: without it a
  `border-dashed` utility woke the UA's `medium` width on the other sides, and
  phase 1's `EmptyState` drew four dashed sides instead of two.
- **Not done here:** `PageHeader` and the facts line on these pages wait for
  phase 4, which replaces the admin layout's heading they would stack under;
  `RowStatus` and the queues are phase 4.
- **Removed:** `InventoryFilters.tsx`, `InventoryTable.tsx` and their tests
  (899 lines), the gallery's div-grid table and sort state, and the CSS they
  and the migrated lists owned — `admin-filters*`, `admin-inventory*`,
  `admin-attention*`, `admin-role-select`, `admin-ban-*`, `admin-person-*`,
  `admin-refresh-list/row/bar/open-tag`, `admin-select-cell`,
  `admin-import-list/section`, `account-list/row/prefix`,
  `admin-mirror-mapping`, `tool-table*` — 565 lines of legacy CSS net.
  `admin-state`, `admin-thumb`, `admin-date`, `admin-cell-note`,
  `admin-row-status` and `admin-table` are still used by phase 3/4 surfaces and
  stay.
- **Cells are render functions, not components.** `DataTable` calls a column's
  `header`/`cell` instead of mounting it (TanStack's `flexRender` mounts a
  function as a component). A page rebuilds its columns when a prop they close
  over changes — a server action's reference is new after every server
  re-render — and with `flexRender` every cell then remounted: the roster's
  `RoleSelect` lost the "Saved" it had just shown (caught by E2E
  `admin-users`). Hooks therefore live in the component a cell returns.
- **Measured** (1440 / 390, seeded 62-tool scratch database): inventory
  5,819 → 2,846 px desktop, 20,166 → 5,245 px phone; gallery table 4,280 →
  2,214 px desktop, 4,327 → 2,946 px phone. The roster is longer on a phone
  (1,605 → 2,026 px) because it no longer scrolls sideways.
- **Package added:** `@tanstack/react-table` ^8.21.3 (v8, as §11 pinned).

### 2026-09-25 — Phase 3 as built (review surfaces)

Branch `v5/ui-phase-3`. §13's row is built — `ReviewCard` + `DuplicateChoice`;
refresh and chat proposals (the spike's code); the intake approve page; the
intake queue; import review with its mapping preview; `IntakeTableCard` — plus
phase 2's handoff (`ImportTable`, the `ImportMapping` preview and the chat's
intake table on `DataTable`). Behaviour is unchanged: every existing
review/intake/import/refresh/curation test passes with selectors updated only
where the markup changed. Where phase 3 differs, and why:

- **Files.** `src/components/system/review/ReviewCard.tsx` holds `ReviewCard`,
  `ReviewValues`, `ReviewSources`, `ReviewNote` and `ReviewDiagnosis` (a
  failed run's recorded reason); `review/DuplicateChoice.tsx`;
  `system/Field.tsx` (label above, control, hint, error — DESIGN.md §8.7, used
  by every review form); `ui/textarea.tsx` (shadcn's, themed like `Input`);
  `admin/pending-status-tone.ts` (a pending item's status as a glyph tone,
  shared by the queue, the chat table and the import rows).
- **`ReviewCard` grew what the other surfaces needed**: `headingLevel` (the
  queue's names are h4 under batch h3s; the approve page's cards are h3/h4),
  `title` (the name as the link to the item), `media` (a thumbnail or a row's
  checkbox), `meta` (the mono who/when line), `as="section"` (the add-unit
  card is a region), and a `warn` tone (a decision still owed: low confidence,
  an undecided duplicate). A caller passes `border-t`, never a border colour:
  tailwind-merge lets a later colour override the tone's start rule.
- **`ReviewValues.before` is optional.** The intake approve page (the spike's
  known risk) has no "now": a new tool has no record. Its proposed record is
  one `ReviewCard` per field group — Names, **Safety and training** (safety
  first, bad-tone rule), Description and specs, Where it goes, the verified
  links — each all proposal, editable in place through `Field`. The training
  three-way select keeps its "staff to confirm" default with a warn rule until
  chosen, and research's verified training quotes are now `ReviewSources`.
  Display/official names with the uniqueness warning, the image choice, lab
  documents, duplicates and **Research again** all behave as before.
  `ConfidenceStrip` sits above the cards (not in a card header, as §7.4
  sketched: it is several lines, not a mark); its `id-card-*` rules were
  deleted in phase 1, so it is now drawn with utilities, ● held / ○ unknown in
  ink only (confidence spec §6: no traffic lights).
- **`DuplicateChoice` is a `radiogroup` of `radio` buttons that do not move on
  the arrow keys.** In APG's radio group an arrow checks the next radio; here
  choosing *saves* (the import's "Remove" is one arrow from "A different
  tool"), so each radio is its own tab stop and chooses on Space, Enter or a
  click. The match sentence describes the group; a decision that cannot be
  changed here (the chat table) is shown as words (`resolved`), not controls.
  It replaces the chat table's buttons, the queue's buttons and the import's
  `<select>`; the approve page keeps a one-line note (its duplicate was decided
  before research). "Add as another unit" still asks for the serial inline.
- **`DataTable` gained four options** for the review tables: `canSelectRow`
  (an undecided duplicate, a saving row) with `selectDescribedBy` (why its box
  is disabled) — select-all skips such rows; `labels.selectAll`;
  `alignTop` (rows of boxes); and **`layout="container"`** with
  `listSelectAll`. The chat panel is 360–440px wide on any screen, so the
  intake table's *own* width decides between the table and the list
  (`useContainerNarrow`, a `ResizeObserver` measured before paint), and never
  renders both; an unmeasurable container (jsdom) keeps the table. Container
  mode is for client-rendered panels only — there is no server first paint.
  The list has its own select-all ("Research all"), which the phone list never
  had. Each row's edit state (draft, serial, refusal) moved up into the card,
  keyed by id, because cells are render functions (phase 2's rule).
- **Import review** filters with `FilterBar`: search plus one "Show" facet
  whose menu counts each value, given the search (the six filter chips were a
  single-choice set). Selection is `DataTable`'s: the header box is "Select all
  shown", and the selection actions (set category/location, Remove, Suggest
  names, Clear, **Research selected (N)**) live in the sticky bulk bar, which
  says how many selected rows the filter hides. "Accept all exact" sits at the
  end of the filter bar because it does not depend on the selection. A phone
  gets one compact `ReviewCard` per row with the same boxes, labelled — 5,839 →
  2,636 px for the seeded 8-row import. The mapping preview is a `DataTable`
  whose headers hold the `NativeSelect`s; it stays a table on a phone.
- **Inline, not `Dialog`.** §7.1 lists `ResearchAgainDialog` and the refresh
  page's "Refresh again" panel under `Dialog`; both stay inline disclosures
  (a form that belongs to the page, DESIGN.md §8.7) so their behaviour and
  tests are unchanged; `Dialog` is not added. Their chips are `Button`s with
  `aria-pressed`.
- **Left for phase 4, as §13 says:** `PageHeader` on these pages (the admin
  layout's heading still stands above them), `RowStatus` and the legacy
  `admin-row-status` line on non-review surfaces, and the shared queue layout
  (`admin-queue`, `admin-queue-settled` stay around the intake queue's
  `ReviewCard`s). `RefreshDialog` (the inventory's bulk refresh panel) keeps
  its `admin-refresh-dialog` rules.
- **Removed:** `admin-intake.css` (567 lines) and `intake-table.css` (382),
  now imported by nothing; from `admin-refresh.css` everything but the
  inventory panel (210 → 20 lines); from `admin-import.css` the review page,
  mapping, table and phone stacking (270 → 54, the launcher and chat pieces stay for
  phase 5); from `globals.css` `.admin-table*`, `.admin-visually-hidden`,
  `.admin-muted`, `.admin-thumb.is-empty` and the last `id-card-*` rules
  (−101). **1,463 lines of legacy CSS deleted** (7 lines of new header
  comments), 27 added to `ui.css`
  (the `review-updated` wash and the `[data-checkerboard]` transparency
  pattern). Legacy CSS: 6,120 → 4,664 lines. Component TSX grew (+2,487 /
  −1,712, including ~440 lines of new system components): utilities are
  written where the legacy class names were, and the per-row state of two
  tables moved up.
- **Measured** (seeded scratch database, 1440 / 390): intake queue 1,733 →
  1,363 px desktop, 1,988 → 1,496 phone; approve page 1,894 → 1,688 /
  2,259 → 2,180; refresh review 2,001 → 1,438 / 2,602 → 1,970; import review
  1,289 → 1,165 / 5,839 → 2,636.
- **Packages added:** none.

### 2026-09-25 — Phase 4 as built (admin information architecture)

Branch `v5/ui-phase-4`. §13's row is built — `surfaces.ts`, the section bar,
the tile home on `loadAdminOverview`, Add equipment as tabs, the queues on one
layout with `FilterBar`, the ⌘K palette — plus phase 3's handoff (`PageHeader`
on every admin page, `RowStatus` where `admin-row-status` was still hand-drawn,
`EmptyState` on page-level empty and error branches). No data model,
capability or permission changes. Where phase 4 differs, and why:

- **One list, three views.** `src/lib/admin/surfaces.ts` (client-safe) holds
  every surface's key, href, group (`addEquipment`, `keepFresh`, `queues`,
  `settings`), permission, lucide icon and **count loader** (a name, so the
  module never pulls the database into the browser). `surfacesFor(identity)`
  feeds the home tiles, the section bar and the palette; `currentHref` marks
  the most specific surface a path is on. Tests pin each role: anonymous and a
  student see none; an admin (SuperMaker) sees all but People; a super admin
  sees all ten. Import a list gates on `tools.add`, which is not itself one of
  `ADMIN_SURFACE_PERMISSIONS`; every role holding it holds one that is, and a
  test asserts no role is shown a surface the layout would refuse.
- **Counts are per loader, and only the viewer's.** The spike's
  `loadAdminOverview()` read everything and failed as a whole.
  `loadAdminOverview(loaders, { userId })` runs one aggregate statement per
  requested loader (`COUNT_LOADER_READS`), each settled on its own: a failure
  is `null` for that tile only ("Could not be read", no facts or sparkline
  that would imply a number), and a SuperMaker's home never counts the people
  table. Intake's "identified" leaves out imported rows not yet sent to
  research — the queue does too, so the tile agrees with the page it opens.
  Sparklines (30 days, bars) on intake, maintenance and corrections only.
  `admin-tiles.ts` turns counts into tile content (pure, tested with the real
  English messages). The mirror tile says its state in words.
- **`Tile`** is one link whose accessible name is the title and whose
  description is the counts (`aria-labelledby` / `aria-describedby`, with
  `sr-only` separators so a screen reader hears "In progress: 1,"), so the
  links list is ten names, not ten paragraphs. The accent start rule and
  number mark waiting work only when it is above zero.
- **Section bar (`AdminNav`)** on every admin page: Overview, then each
  job's surfaces behind a divider, each group a named list, the palette's
  button at the end. **No counts** (owner decision 5). The 88px "ADMIN" is
  gone; an `sr-only` h1 keeps the outline, and `AdminNotice` (a refusal is the
  page) keeps its own h1, now a `PageHeader`.
- **`AdminPageHeader`** composes `PageHeader` with the `// ADMIN / GROUP`
  crumb from the surface's group, a crumb link back to the surface on an
  item's page (a refresh, an intake item, an import), and a facts line every
  page computes from the rows it already read (`2 TOOLS · 2 PUBLISHED ·
  0 DRAFTS · 2 NEED ATTENTION`). The facts use `admin.facts.*` ICU plurals.
  `admin-section-head`, `td-eyebrow` and `admin-lede` are gone from admin.
- **Add equipment is a route group, and its tabs are links.**
  `src/app/admin/intake/(tabs)/` holds Queue (`/admin/intake`), **Imports**
  (`/admin/intake/imports`, a new page — the list that sat under the queue)
  and Import a list (`/admin/intake/imports/new`) under one layout: the header,
  a facts line from the intake and imports loaders, and `LinkTabs`. Tabs
  that load a URL are a `nav` of links with `aria-current`, not `role="tab"`
  (which promises an in-page panel and arrow keys). Each tab keeps its own
  permission and is offered only to holders. An item's page (`[id]`,
  `imports/[id]`) stays outside the group. `ImportsList` lost its own header
  and button; its empty state carries "Import a list".
- **`QueueList`** (`system/queue/`) is the one queue layout: search and facets
  over every item (counts per value given the other filters), open work on the
  page, settled work behind a `<details>`, and an emptied list that names the
  filter (`Nothing here matches "belt" · Priority: High`) with Clear. The
  maintenance, corrections and projects queues and the intake queue (by batch,
  through `renderList`) use it; they became client components (their props
  were already serializable), and each card is a `ReviewCard` with status as
  `StatusGlyph`s. `TicketControls` moved to `Field` + `NativeSelect` +
  `Textarea` + `Button`; `CorrectionControls` and `PublishToggle` to `Button`.
  Filters are not written to the URL (a queue is worked, not linked).
- **⌘K palette** (`CommandPalette`, shadcn `Command` over `cmdk` in a themed
  `Dialog`): surfaces from `surfacesFor(role)`; tools by display name,
  official name or slug from `listToolIndex` (one narrow select in the admin
  layout; drafts only with `catalog.view_drafts`, archived never; a failed
  read is said in the palette); Add equipment and Refresh the catalog. Matching
  is `paletteScore` — every word must appear, prefix ranks above contains,
  never fuzzy. ⌘K / Ctrl-K toggles it, `/` focuses the page's filter search.
  **Phase 5's hook:** an `onAsk(query)` prop adds "Ask the assistant: …";
  nothing passes it yet.
- **`RowStatus`** gained a message form (`tone` + children) beside the codes
  form, one look, always a live region; it replaced every `admin-row-status`
  (import launcher, photo and resource editors, the tool editor's two lines,
  `RefreshDialog`) and the home's MCP token warning. `EmptyState` gained
  `tone="bad"` (an alert) for "could not be read" branches, and replaced
  `admin-empty` on every admin page and in the editor's empty sections.
- **Kept inline:** Research again and Refresh again stay inline panels (owner
  default), and `RefreshDialog` keeps its panel rules.
- **Removed:** the index list and its CSS, `countRefreshesWaiting`, the
  `admin-section*`, `admin-lede`, `admin-action*`, `admin-index*`,
  `admin-empty`, `admin-date`, `admin-row-status*`, `admin-unlinked*` and
  every `admin-queue*`/ticket/correction/publish/priority rule, `.admin-mirror`
  and `RefreshCatalogButton`'s inline stylesheet — **359 lines of legacy CSS**
  (legacy 4,664 → 4,318; `ui.css` unchanged), five dead message keys.
- **E2E:** selectors moved from the index list to the section bar and tiles;
  `admin-navigation.spec.ts` covers the bar on every page, the student's
  refusal without it, the tabs and ⌘K. `admin-users`' role change now waits
  for hydration before choosing: the heavier admin bundle made a select
  changed before React owned it a winnable race (the change looked saved and
  did not persist — worth a look in `RoleSelect`).
- **Measured** (seeded scratch database, 1440 / 390): maintenance 1,695 →
  1,532 / 3,115 → 2,448; corrections 1,188 → 1,067 / 1,496 → 1,227; intake
  queue 1,363 → 1,209 (imports moved to their tab); refresh review 1,438 →
  1,421. The home grew on a phone (1,419 → 2,302 px: ten tiles with counts
  and trends replace ten one-line links) and fits one desktop screen (937 px).
- **Package added:** `cmdk` ^1.1.1 (shadcn `Command`). `Dialog` is the
  existing `radix-ui` package.

### 2026-09-25 — Phase 5a as built (public pages)

Branch `v5/ui-phase-5a`. §13's phase 5 is split: **5a is the public pages** —
the gallery, the tool page, projects, about, `/mcp`, `/account/tokens`, the
OAuth pages, error / empty / loading states, the header and phones — and **5b is
the chat** (AI Elements, `Sheet`, streamdown, the FAB rules), untouched here.
Two owner requests of 2026-09-25 are built in this phase. Where 5a differs from
§8.2 / §13, and why:

- **One frame for working pages.** `system/PublicPage.tsx` holds `PublicPage`
  (a `main` reading column, 880px, `narrow` 560px for a single decision, `wide`
  for a grid, `PageHeader` as the h1), `PageSection` (h2 + lede, separated by
  whitespace only), `SectionLabel` and `Prose`. Projects (list, detail, new),
  about, `/mcp`, `/account/tokens`, `/oauth/sign-in`, `/oauth/consent` and
  `/auth/rejected` are on it; the rounded `td-panel td-prose` card is gone from
  all of them. `system/Markdown.tsx` renders a tool description, a project
  write-up and its preview with the page's tokens (GFM, no raw HTML), so pages
  no longer borrow the chat's `.chat-markdown` and its `--td-*` overrides.
- **Gallery on `FilterBar` (§8.2).** Search, then **Category / Material /
  Location** as `FacetFilter` menus with per-value counts (given the other
  facets). They are **single-valued**, like every facet in the app (a link
  names one value per dimension): the old console's multi-select categories
  and its "select a whole material group" heading are gone. The hero keeps the
  display title and gains a facts line (`18 TOOLS · 14 AVAILABLE NOW ·
  5 CATEGORIES`). Cards are one plate with the status as `StatusGlyph` + word
  and the category (the pulsing orange "in use" dot, colour alone, is gone). A
  tool with no photo shows its initials on an empty plate
  (`ToolImage`), not the browser's broken-image icon. The grid/table switch is
  a two-button group with `aria-pressed`, not `Tabs`: both views are the same
  list, and the choice is a URL parameter, not an in-page panel.
- **Sort and Group by (owner request (a)).** `ChoiceMenu`
  (`system/data-table/ChoiceMenu.tsx`) is a `FacetFilter`-looking radio menu
  with no counts and no "Any". **Sort:** Name A–Z (the default — "Best match"
  while searching, when the default is the search rank), Name Z–A, Category,
  Location, **Recently added** (`tools.created_at`, now carried as
  `MakerLabTool.addedAt`), **Most available** (units available now). **Group
  by:** None, **Category** (`3D PRINTING › FDM`), **Category group** (`3D
  PRINTING` — the cards' tag), **Location** (room). Grouped, the gallery is
  labelled `section`s in order (alphabetical, "Uncategorized"/"Unknown" last),
  each with an h2 heading **sticky under the top bar** (its height measured,
  since the bar wraps on a phone) carrying the count (`4 TOOLS`) — small
  multiples; the sort applies inside every section; in the table view each
  section is its own `DataTable` named by the section (`Tools: Laser`), same
  column widths, no sticky header of its own, the keyboard hint once. Cards
  under a group are h3. `gallery-filters.ts` (pure) owns the URL vocabulary —
  `?q=&category=&material=&location=&view=table&sort=&group=`, defaults left
  out, unknown values dropped — and `sortTools` / `groupTools`.
- **The gallery's URL is read on the client.** The gallery is one cached
  prerender for everybody (`cacheComponents`), so the server cannot hand the
  island its `searchParams` as `/admin/inventory` does. `useUrlSearch`
  (`components/use-url-state.ts`) makes the query string the state:
  `useSyncExternalStore` renders the defaults on the server and while
  hydrating, then the URL; writes are `replaceState` (no server round trip, no
  Back-button history per keystroke). A linked grouped view therefore paints
  ungrouped for one frame. The search box writes `q` untrimmed — trimming a
  controlled value would eat the space being typed.
- **The gallery table** gained Status (glyph + word), Room and Available
  (`available/units`, right-aligned) columns, and fixed column proportions so
  grouped tables line up.
- **Tool page (§8.2).** One column of facts: a mono `// TOOLS / INVENTORY /
  NAME` crumb; the hero (image plate, display title, **official name** in mono
  under it, a status line of glyphs and words — status, training, PPE, `1 OF 1
  UNIT AVAILABLE` — the description, the Safety doc / SOP buttons); **Safety**
  as the one tinted section (bad start rule, 5% bad wash; PPE as labels,
  e-stop, restrictions as a `<dl>`); **Details** as a dense `<dl>` (category,
  location, materials, training, map id, tags, notes); **Documents &
  resources** as a ruled list with the kind as a mono word (Safety in the bad
  ink, a lab document in the accent ink) and the manual **Contents** under its
  manual; **Physical machines** as a `DataTable` (`tool/UnitsTable.tsx`,
  status glyphs, ISO dates, a two-line item on a phone); **Maintenance
  history** (new, below); **Built with this**. The "at a glance" card (which
  repeated the materials) and the separate "Notes & tips" panel (which
  repeated the notes) are gone.
- **Maintenance history on the tool page** is one new read,
  `listMaintenanceHistoryForTool` (data/maintenance.ts): the ten newest logs
  across the tool's units with date, status, title, type and unit label —
  **no reporter name, email or description**, the line MCP already draws for an
  anonymous caller. It is cached with the catalogue
  (`getToolMaintenanceHistory`, tag `catalog`); maintenance writes do not
  invalidate that tag, so a new ticket appears when the catalogue's cache next
  turns over. The page says "No maintenance has been logged" when empty. This
  is the phase's one data addition (§5 said none beyond counts); it is a read
  of public fields only.
- **Tokens and `/mcp` (owner request (b))** — see the MCP access spec's
  amendment "One lifetime, a louder reveal, a setup prompt": 90 days for every
  token with no choice, the form and reveal in one 640px column, the
  "Save this token now…" warning above the token and beside **I've copied it**,
  and **Copy setup prompt for your AI** on `/mcp`'s Connect section and on the
  reveal. `/mcp` now puts Connect straight after the addresses; its tool list is
  a hairline-ruled list instead of a boxed card per tool (5,975 → 4,339 px), and
  Try it is on `Field` / `Input` / `NativeSelect` / `Checkbox` / `Button` /
  `RowStatus`. `CopyableCode` is a card-toned `pre` with a `Button` and a
  `role="status"` "copied" announcement. The account pages' error line used
  `--primary-ink` for errors and `--status-bad` for warnings (swapped); every
  outcome there is now `RowStatus` with the right tone.
- **Header.** "Sign in" is a hairline box in ink, so the bar keeps one accent
  (Report); **"Sign in as (dev)"** is muted and dashed, never wraps, and says
  "Dev" on a phone (its accessible name stays "Sign in as (dev)"). The profile
  menu keeps its own menu-button code — it already follows the APG pattern
  (arrows, Home/End, Escape returns focus, **Tab closes**); Radix's
  `DropdownMenu` traps Tab and would change behaviour its tests pin — but its
  panel loses the retired glass blur and glow for a card plate with a
  `--outline-strong` border.
- **Error, empty, loading.** `app/not-found.tsx` and `app/error.tsx` are pages
  in the system's frame (`PublicPage` + `EmptyState`, the error one
  `tone="bad"` with Try again), replacing Next's bare defaults. The gallery's
  loading fallback is skeleton plates in the grid's shape (reduced-motion
  safe). An emptied gallery names its filters (`No tools match "laser" ·
  Category: Laser.`) with Clear.
- **Shared fix.** `FilterBar`'s end group (count, Columns — and now Sort, Group
  by, View) wraps; unwrapped, it pushed the gallery 111px past a 390px phone.
- **Not done here (5b or later):** the chat (`ChatFab`, `.chat-*` CSS,
  `admin-import.css`'s chat pieces), `FlagButton`'s dialog, the QR arrival
  notice's chat hand-off (restyled only), and the `--td-*` mapping that
  `.admin-shell` still supplies for `ManualStateCounts`' `td-panel`.
- **Removed.** `account.css` (120 lines) and `mcp.css` (141) whole; from
  `globals.css` the gallery console, `technical-frame`, `tool-card*`,
  `tool-grid`, skeleton and loading-dots rules, the whole `.tool-detail` palette
  and every `td-*` page rule but `td-panel`, the projects gallery / detail /
  form rules, `chip`, `eyebrow`, `empty-state`, `project-empty`, two unused
  keyframes and the comments they left behind — **2,155 lines of legacy CSS
  net** (4,318 → 2,163; 21 added for the header). `TechnicalFrame.tsx` (no
  importers). `ui.css` unchanged.
- **Tests.** New: `gallery-filters.test.ts`; `GalleryShell.test.tsx`
  rewritten (facet counts, URL write-back and read, sort keys, group sections
  with counts, sticky headings, h3 cards, grouped tables); `ToolCard`
  (glyph + word, heading level, missing photo); `DetailShell` (status line,
  `<dl>` specs, units table, maintenance history); `maintenance.test.ts`
  (`listMaintenanceHistoryForTool`: no names, bounded); the token and prompt
  tests listed in the MCP amendment. E2E: `search.spec` moved to the
  `searchbox` and facet menus and gained a Group-by test; `tool-editor.spec`'s
  public unit row is the phone list; `intake.spec`'s cover selector;
  `projects.spec`'s error locator; new `account-tokens.spec`.
  `admin-overview.test.ts`'s "reported today" case compared a JavaScript UTC
  date with the database's `current_date` and failed every evening after 8pm
  in New York; it now asks the database for today.
- **Measured** (scratch database: the demo seed plus 16 tools across seven
  categories, three rooms; 1440 / 390, light, anonymous): gallery 1,635 →
  1,531 / 2,801 → 2,602 px; tool page (Form 4) 2,209 → 1,694 / 3,185 → 2,327;
  project 2,219 → 1,687 / 1,767 → 1,429; about 1,319 → 1,060 / 1,879 → 1,592;
  `/mcp` 5,975 → 4,339 / 7,667 → 5,799; `/account/tokens` (student) 1,609 →
  1,360 desktop, 1,858 → 2,031 phone (the new-token form is now full-width
  controls stacked, not a 560px box beside nothing). No page scrolls sideways at
  390px.
- **Packages added:** none. No shadcn primitive was added: `Dialog`/`Sheet`
  are for the chat and the flag dialog (5b); every public control here is an
  existing primitive.


### 2026-09-25 — Admin polish (owner requests after phase 4)

Branch `v5/admin-polish`. Six owner requests on the admin pages, built on the
phase 1–4 system. No data model or permission changes; one new read
(`lastRefreshedByTool`). Where the admin now differs from the phase-4
amendment, and why:

- **The Notion mirror's not-yet-connected state is on the system.** Its text
  was the legacy mirror CSS (19px display panel headings, a 1.6 line-height
  numbered list, `--td-*` hints) and read unlike every other admin page. The
  steps are an unboxed section with an `h3` in the same style as People's
  "Setup allowances", numbered in mono; `MirrorConnect` is `Field` + `Input` +
  `Button` (Test connection, then the one filled Connect) with its outcome in
  `RowStatus`; the "no key" and "needs a new token" notices are a warn-rule
  block. `admin-mirror-notice`, `-steps`, `-form`, `-field-hint` and the
  connect form's input rule are deleted; the connected state (`MirrorStatus`,
  `MirrorControls`, `MirrorMapping`) keeps `admin-mirror.css` for now.
- **A ticket's resolution is a button until it is wanted** (DESIGN.md §8.13).
  The always-open textarea made every open card two rows taller. Now: **Add
  resolution**, or the saved words on two clamped lines with **Edit
  resolution**; pressing it opens the box inline, focused, with Save and
  Cancel; Escape cancels; focus returns to the button; a landed save closes it,
  a refused one keeps the words in the box. Same action, same `maintenance.manage`
  write, one `RowStatus` per card. Maintenance at 1440 / 390 on the seeded
  scratch database: 1,532 → 1,426 / 2,448 → 1,857 px.
- **`RoleSelect` cannot say "Saved" for a write that did not land.** The
  phase-4 race, reproduced by holding the page's scripts back: a role chosen
  before its Suspense boundary hydrated was reset to the rendered value by
  hydration; when React replayed the queued `change` event it carried that
  reset value, `setUserRole` answered `ok` for a role the person already held,
  and the row said "Saved". Three guards: every click-to-save select
  (`RoleSelect`, the ticket controls) is **disabled until hydrated**
  (`admin/use-hydrated.ts`, `useSyncExternalStore` — disabled in the server's
  HTML); a change to the value already held sends nothing; and an `ok` whose
  `role` is not the one chosen is shown as `failed` with the held role
  restored. `admin-users.spec.ts` no longer waits for `networkidle`.
- **The home's tiles line up** (DESIGN.md §8.2). The four job columns stacked
  tiles of different heights, so rows were ragged. The columns now share one
  row grid (`TileGrid`; each `TileGroup` a CSS subgrid spanning the same number
  of tracks): a tile spans two tracks and fills them, a **half tile** one —
  People, the mirror, Projects with nothing waiting, and a tile whose count
  could not be read. Inside, the parts keep their places and the sparkline is
  pinned to the foot. Sparklines were too faint: bars 45 → 75% ink, a zero day
  a 2px stub at 40% (was 1px at 15%), 22px tall. The Inventory tile says what
  it counts — "of 104 tools need attention", beside "Published — in the
  catalog" and "Drafts and archived" — so it no longer looks like it
  contradicts the status strip's published count. Phone: one column, same
  order. Home at 1440 / 390, seeded: 937 → 1,028 / 2,302 → 2,192 px (the rows
  are taller where the tallest tile sets them; the phone is shorter).
- **Intake is one surface.** "Import a list" is no longer a surface: gone from
  `surfaces.ts` (and so from the section bar, the tiles and ⌘K), and from
  Intake's tabs, which are now **Queue · Imports**. Importing a list is
  Intake's header action (`ImportListAction`, shown to `tools.add` holders, not
  shown on the import page itself); `/admin/intake/imports/new` keeps its URL,
  its own `tools.add` check and sits under the Imports tab, and the section bar
  marks Intake there. The Intake tile carries the imports as a line, "Imported
  lists waiting for review", read only for a viewer holding `tools.add`
  (`AdminSurface.alsoCounts`, `countLoadersFor`) and counted in the home's
  "items waiting on you". The header's title is "Intake" under the `// ADD
  EQUIPMENT` crumb.
- **Page actions.** `/admin/inventory` has **Add inventory** in its header —
  the same chat intake seed as the home's Add equipment (there is no second way
  to add a tool). `/admin/refresh` has **Refresh research…**, a `Dialog`
  (`RefreshPicker`) that picks tools with presets (Never reviewed, No manual,
  Not refreshed in 90 days), a category, a name search and a `DataTable` with
  boxes, then queues through the inventory's `queueToolRefresh` — `tools.edit`,
  25 a press, the shared daily allowance, open refreshes not selectable. A
  dialog rather than an inline panel because it is a decision with its own
  list, not a form that belongs to the page. The empty queue's sentence points
  to the button.
- **Screens** (before/after, 1440 and 390, both themes for the home, demo seed
  and a seed with every tile non-zero): `v5/.livecheck/admin-polish/shots/`,
  not committed.
- **Packages added:** none.

### 2026-09-25 — Admin polish, continued (one-shot buttons, names, lab-day sparklines)

Same branch, three more owner requests after the amendment above:

- **One-shot actions keep their state in the button** (DESIGN.md §8.10).
  `AsyncButton` (`system/AsyncButton.tsx`): idle → pending (spinner over the
  label, which stays in place invisible, so the width never shifts; disabled,
  `aria-busy`) → done (check + "Done" for 1.5 s, announced in a live region,
  then the label) → error (label, reason on a `RowStatus` line). `onRun`
  answers `true`, a translated sentence, or `false` for a failure the caller
  reports elsewhere. Used by the header's catalog refresh, the tool editor's
  **Looks good** and a resource's **Re-process** (the editor's `run` now
  answers whether the write landed; its own status line still carries a
  refusal's reason). The catalog button no longer leaves "Catalog refreshed"
  standing beside it.
- **Names.** The catalog cache button is **Refresh catalog** in every locale
  (its `aria-label`, which said "from Notion" and did not contain the visible
  words, is gone); the refresh surface is **Refresh research** on its tile, in
  the section bar and in ⌘K, matching its page header.
- **Sparklines count the lab's days.** `loadAdminOverview` bucketed by the
  database's `current_date` and `created_at::date` — UTC on Vercel — so from
  8pm in New York a ticket filed that evening fell off "today" (and the test
  "reported today… last slot" failed after 8pm Eastern). The loader now takes
  the lab's today from `labToday(now)` and buckets timestamps by
  `(created_at at time zone LAB_TIMEZONE)::date`; `date_reported` was already a
  lab date. `now` is injectable, and the tests run on a fixed clock with a
  23:30 Eastern case, a 00:30-next-day case and a `LAB_TIMEZONE=UTC` case.

### 2026-09-25 — Public polish (owner requests after phase 5a)

Branch `v5/public-polish`. Owner requests after phase 5a and admin polish:
bring the admin's quality to the public Tools pages, steady the header, make
⌘K work everywhere, and finish the Manuals and queue pages. No data model or
permission changes. Where the app now differs from the amendments above:

- **Header does not move.** Measured with visible scrollbars, the whole bar
  shifted 8px (1440 → 1432px client width) between a page that scrolls and one
  that does not (`/projects`, `/admin/research` against `/`): the themed
  `::-webkit-scrollbar` is a classic scrollbar even where the OS overlays.
  The root now reserves the gutter (`scrollbar-gutter: stable`), and
  `e2e/header-stability.spec.ts` asserts every header control's box is
  identical across `/`, `/projects`, `/about`, a tool page and admin pages at
  1440 and 390, with scrollbars shown.
- **Frosted menus.** The profile menu (and the ⌘K dialog) sit on a
  `--surface-frosted` plate: the card colour at 88% with
  `backdrop-filter: blur(16px) saturate(140%)`, a hairline `--outline-strong`
  border, no shadow; solid `--surface-container` where `backdrop-filter` is
  unsupported. This reverses DESIGN.md §5's "no glass" for overlays only, by
  owner request: text over a moving page must stay readable (AA at 88%).
- **⌘K everywhere.** The palette moved out of the admin layout into the site
  header (`SitePalette`): pages (Tools, Projects, About, MCP), categories (a
  filtered gallery link), tools by display name, official name or slug, and —
  for a viewer whose role opens them — admin pages and actions. A header
  field, "Search tools… ⌘K", opens it (an icon button on a phone). `/` still
  focuses the page's own filter search.
- **Gallery toolbar.** One `FilterToolbar` layout shared with the inventory:
  full-width search, then facets left and Sort / Group by / view right, the
  count as a quiet line; on a phone a **Filters** button opening a sheet with
  the facets (active count on the button). The view switch is a
  `SegmentedControl`: both halves outlined, the chosen one filled.
- **Cards** show the image, the display name and the category only;
  availability and training live on the tool page and in the table.
- **Gallery table** gained a Status facet, the Columns menu, and sorting on
  every column, over the same filter state as the grid.
- **Tool page, denser.** A smaller image beside the title; the status line on
  one line; Details, Documents, machines and specs in two columns on desktop;
  Safety as a compact block; empty sections are left out rather than drawn
  as placeholder boxes. The crumb is `Tools › <tool>`.
- **Manuals** (`/admin/research`): a state strip, the manuals as a
  `DataTable` with state facets and **Re-process**, plain-English help.
- **Queues.** Controls in one aligned row, `RowStatus` inline beside them in a
  reserved slot, the resolution editor in its own full-width slot, so nothing
  moves when "Saved" appears or the editor opens.

As built (same branch):

- **Header.** `scrollbar-gutter: stable` alone did not fix it — Chromium
  ignores the gutter for a styled `::-webkit-scrollbar` — so the root has
  `overflow-y: scroll` as well. The active nav link already changed colour and
  underline only, so no width reservation was needed. The frosted plate is
  the `FROSTED` utility string (`system/frosted.ts`, `supports-[backdrop-filter]`
  variants), shared by the profile menu and the palette.
- **Toolbar.** `FilterBar` itself is the shared layout (every list already
  used it); new props `secondary` and `activeCount`. The count sits at the end
  of the search row rather than at the start of row 2, which is what lets row 2
  fit at 1024. With two facets and a grouping set, the right group wraps under,
  right-aligned. `ui/sheet.tsx` is added (Radix Dialog, fade only).
- **Gallery.** `?status=` joins the URL vocabulary; room and zone are one
  column; official name and materials are optional columns. Column visibility
  is page state, shared by every grouped section's table.
- **Tool page.** The crumb is `// TOOLS › NAME`; "Back to all tools" is gone
  (the crumb is the way back).
- **⌘K.** Messages moved from `admin.palette` to `palette`. The admin section
  bar no longer carries its own palette button — the header's field is on
  every page. Pages, categories and tools for everybody; admin pages and
  actions only through `surfacesFor(role)`.
- **Manuals.** New read `listManualLibrary` (same current-PDF rule and buckets
  as `countManualsByState`, asserted against it) and action
  `reprocessLibraryManual` (`tools.edit`, tested for the adjacent-permission
  refusal). "Run npm run manuals:index" is replaced by a sentence for staff;
  the CLI stays in `v5/AGENTS.md`.
- **Removed.** `ManualStateCounts`, `.td-panel`, the `.admin-shell` `--td-*`
  mapping (the mirror and editor rules read the theme tokens), `.page-shell`,
  the profile panel's own plate rules and the header's catch-all button rule:
  legacy CSS 1,801 → 1,750 lines (85 deleted); 74 dead message lines across
  the 12 locales; the tool page's placeholder branches.
- **Measured** (scratch database: demo seed + 16 tools, 6 manuals, tickets,
  corrections, projects; light): tool page (Form 4) 1,694 → 1,095 px desktop,
  2,327 → 1,698 phone; a sparse tool 1,644 → 900 / 2,164 → 1,342; gallery
  phone 2,602 → 2,391 (no tags on cards); gallery table 1,084 → 1,124 desktop
  (the two-row toolbar). Manuals grew (900 → 944 / 889 → 1,454): it now lists
  the manuals. Maintenance 1,426 → 1,381 desktop. Screens at 1440 / 1024 / 390
  (toolbar also 800), both themes: `v5/.livecheck/public-polish/`, not
  committed.
- **Not done:** the owner's "Remove instead of Ban" on the People page was
  not built on this branch (it needs the owner's direct go-ahead as an
  auth/security change); Ban is unchanged.
- **Packages added:** none.
