# UI system

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## UI system (conventions)

- **UI system** (spec `docs/specs/2026-09-25-ui-system-design.md`, being
  adopted phase by phase): Tailwind 4 theme + utilities with no preflight,
  from `src/styles/ui.css` (imported before `globals.css`); shadcn primitives
  in `src/components/ui`, app-level ones (`StatusGlyph`, `Sparkline`,
  `PageHeader`, `EmptyState`) in `src/components/system`, classes joined with
  `cn` (`@/lib/utils`). Orange *text* is `--primary-ink`, errors are
  `--status-bad` (never crimson), focus is the global `:focus-visible` outline —
  never `outline: none`. Fonts are self-hosted (`src/app/fonts.ts`). New
  components never carry legacy classes: unlayered legacy CSS beats utilities.
  **Every list of records is `DataTable`** (`src/components/system/data-table/`:
  TanStack Table v8 state, our markup; `FilterBar` + `FacetFilter` with per-value
  counts + `ColumnsMenu`; `facetOptions`). The caller filters and, where the view
  is worth linking, writes the filters to the URL with `replaceState`
  (`inventory-filters.ts`, `users-filters.ts`). Below `sm` a `mobileRow` list
  replaces the table; `usePhoneLayout` renders only one of the two once the
  browser can say which, so a row's controls exist once. In jsdom both render:
  scope queries to `getByRole("table", { name })`. A table inside a panel
  (the chat's intake table) uses `layout="container"`: its own width decides,
  and an unmeasurable one (jsdom) keeps the table only.
  **Every review is `ReviewCard`** (`src/components/system/review/`:
  `ReviewCard`, `ReviewValues`, `ReviewSources`, `ReviewNote`,
  `ReviewDiagnosis`; `DuplicateChoice` for "this matched X" — a radio group
  whose arrows never choose, because choosing saves). Form fields are
  `system/Field` (label above, hint below, `hintId(id)` for
  `aria-describedby`). Refresh and chat proposals, the intake queue and approve
  page, import review and the chat's intake table are all on them (UI system
  phase 3); `admin-intake.css` and `intake-table.css` are gone.
  **Admin navigation** (phase 4): `Tile`/`TileGroup`, `LinkTabs` (tabs that
  are URLs: links with `aria-current`, never `role="tab"`) and `queue/QueueList`
  (search + facets over a queue, open work on the page, settled behind a
  disclosure) in `system/`; `AdminNav`, `AdminPageHeader` and `CommandPalette`
  (shadcn `Command` over `cmdk` in `ui/dialog`; since public polish in
  `palette/`, mounted in the site header for everybody — see below) in `admin/`. An inline outcome
  is `RowStatus` (codes, or `tone` + words); a page that could not read its
  data is `EmptyState tone="bad"`. `admin-row-status`, `admin-empty`,
  `admin-section*` and the `admin-queue*` rules are gone.
  **Public pages** (phase 5a): working pages are `PublicPage` + `PageSection`
  (`system/PublicPage.tsx`); Markdown on a page is `system/Markdown`, never the
  chat's `.chat-markdown`. The gallery is `FilterBar` + `FacetFilter` +
  `ChoiceMenu` (Sort, Group by), its state in the URL through
  `gallery-filters.ts` and `useUrlSearch` (the page is one cached prerender, so
  the island reads the query string itself); grouped, it is sticky-headed
  sections with counts. The tool page is one column (`DetailShell`, units as
  `tool/UnitsTable`, the maintenance history from `getToolMaintenanceHistory` —
  no names). `app/not-found.tsx` / `app/error.tsx` exist. `account.css`,
  `mcp.css`, the `.tool-detail` palette and the gallery/projects legacy rules
  are gone.
  **Public polish**: every list's toolbar is the one `FilterBar` (search with
  the count, then facets left and `secondary`/`end` right; a phone **Filters**
  `Sheet`, `ui/sheet.tsx`); view switches are `system/SegmentedControl`; the
  gallery table has a Status facet, Columns and sorting on every column
  (`useGalleryColumns`). The ⌘K palette (`palette/CommandPalette`) is in the
  header on every page (`HeaderSearch`): published tools from the root layout
  (`getPaletteTools`), the role from `PrimaryNav`'s identity
  (`lib/auth/identity-store.ts`), and on admin pages the server-resolved role
  and the drafts via `PaletteScope`, added to the published list. Floating menus use `FROSTED`
  (`system/frosted.ts`). The root always shows its scrollbar so the header
  never moves (`e2e/header-stability.spec.ts`). Save-on-click controls report
  "Saved" in a reserved `SaveSlot` (`admin/RowStatus.tsx`). The tool page is
  two columns on desktop and draws no empty section.
  **Chat** (phase 5b): AI Elements copied from `registry.ai-sdk.dev` into
  `src/components/ai-elements/` (Conversation, Message, PromptInput, Tool,
  Sources, InlineCitation, Suggestion, Loader), trimmed to what the chat uses
  — never run the AI Elements CLI (it prompts to overwrite `ui/` and installs
  every component's dependencies). The chat is a frosted `Sheet`; Markdown is
  streamdown with its `raw` rehype plugin dropped (model text never renders
  as HTML) and plain elements (`ai-elements/message-markdown.tsx`) styled by
  the pages' `MARKDOWN_PROSE`. A link whose address one of the turn's
  `search_manual` passages returned is an inline citation, and the cited
  pages are the answer's Sources (`chat/manual-citations.ts`). Messages carry
  `data-role` / `data-kind` for tests. Under the composer, always, the
`chat.aiNote` line ("MakerLAB AI can make mistakes…"), which also describes
the text field (identity spec amendment 2026-10-06). The floating button is not drawn on
  `/admin/*`: the section bar's **Ask the assistant** and ⌘K (`onAsk`, from
  `HeaderSearch`) open it. `FlagButton` is a `Dialog`. The `.chat-*` CSS and
  `admin-import.css` are gone.
