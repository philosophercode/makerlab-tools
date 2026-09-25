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
