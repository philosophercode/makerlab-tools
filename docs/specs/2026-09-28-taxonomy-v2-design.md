# Taxonomy v2: Nine Categories, Research-Proposed Categories, `/admin/taxonomy` — Design Spec

**Date:** 2026-09-28
**Status:** Implemented in this PR (branch `v5/taxonomy-v2`). Based on the 2026-09-28 taxonomy review the owner approved.
**Target:** `v5/`
**Branch:** `v5/taxonomy-v2`
**Spec PR:** this PR · **Implementation PR:** this PR (spec and code together; the owner approved the review that is the design)

## 1. Summary

The review of the live inventory (2026-09-28, the public MCP's `list_tools` and `get_tool_details` for
all 101 tools) found 101 published tools in 38 subcategories under 9 free-text groups. Woodworking
held 43% of them as a catch-all; 11 subcategories had a single tool; three subcategory names repeated
under different groups ("Accessory", "3D Scanner", "Workstation"); about 20 "tools" were accessories,
consumables or furniture. Research already saw the category list, but a category it proposed was
**created silently on approval**, and MCP `create_tool` created categories with no person involved.

This change:

1. Replaces the free-text `group` with a **two-level tree** (`parent_id`), and gives every category a
   **slug**, a **description** (what belongs, what does not), a sort order and retirement
   (`retired_at`, `merged_into_id`).
2. Seeds **nine top-level categories** and their second level (§3), each described, and moves every
   tool into them with a deterministic, idempotent script (`npm run taxonomy:migrate`).
3. Makes **research decide the category**: its prompt lists every category as
   `slug — Parent › Name: description`; it answers one existing slug (required) and, only when none
   fits, a proposal. Matching is exact. **Nothing creates a category except a person accepting a
   proposal** — not approval, not research, not MCP.
4. Adds **`/admin/taxonomy`**: the tree with counts and descriptions, the proposals queue (accept /
   merge into / reject), rename, describe, retire, merge and move tools.
5. Adds a **consolidation audit** (`npm run taxonomy:audit`) that only writes proposals.
6. Adds two tool facets, **`item_kind`** (equipment / accessory / consumable / fixture) and
   **`parent_tool_id`** (accessory → tool), which fix "accessories as tools" without a category.

## 2. Goals / Non-goals

### Goals

- Every category has a unique slug, a description, at most one parent, and a place in a two-level tree.
- The public gallery shows nine process-based top-level categories; *Shop Infrastructure & Supplies*
  is hidden from it by default and still visible to staff and to the assistant for staff.
- Research always answers an existing slug; a new category is a proposal a person decides.
- Approval, MCP `create_tool`, the assistant and the audit can only **propose**.
- The recategorisation is one command, a dry run by default, deterministic and idempotent.

### Non-goals (this iteration)

- The other facets the review lists — `power_source`, `digital_fabrication`, `portable_checkout`,
  a controlled materials list — are a follow-up. `training_level` already exists.
- The reserved top-level categories (Metalworking, Molding & Casting, Measurement, Finishing & Paint,
  Computing) are not created; the audit or research proposes them when tools arrive.
- `category` as a refresh-research proposal field and in `CHAT_PROPOSAL_FIELDS` (review §4 item 6):
  `recategorize_tool` gives the assistant the same ability through the action layer; refresh research
  proposing a category is a follow-up.
- Translating the new strings: English now, the other 11 locales with Phase 9 (owner decision).

## 3. The tree

Nine top-level categories and their second level, exactly as the review's §3. Every node's
description is in `src/lib/taxonomy/tree.ts`.

| Top level (slug) | Second level (slugs) |
|---|---|
| 3D Printing (`3d-printing`) | FDM Printers (`fdm-printers`) · Resin Printers & Post-Processing (`resin-printers-post-processing`) · Printer Upgrades (`printer-upgrades`) |
| Laser Cutting & Engraving (`laser-cutting-engraving`) | (none — tools sit in the top level) |
| CNC & Waterjet (`cnc-waterjet`) | CNC Mills & Routers (`cnc-mills-routers`) · Waterjet (`waterjet`) |
| Power Tools (`power-tools`) | Saws & Cutters (`saws-cutters`) · Drills & Drivers (`drills-drivers`) · Sanders (`sanders`) · Routers (`routers`) · Rotary Tools (`rotary-tools`) · Nailers (`nailers`) · Heat & Glue (`heat-glue`) |
| Hand Tools (`hand-tools`) | Hand Saws (`hand-saws`) · Planes & Spokeshaves (`planes-spokeshaves`) · Files, Bits & Fastening (`files-bits-fastening`) |
| Electronics (`electronics`) | Soldering (`soldering`) · Rework & Reflow (`rework-reflow`) · Test & Measurement (`test-measurement`) · Components & Dev Boards (`components-dev-boards`) |
| Textiles, Vinyl & Crafts (`textiles-vinyl-crafts`) | Sewing & Embroidery (`sewing-embroidery`) · Vinyl & Craft Cutters (`vinyl-craft-cutters`) · Heat Press (`heat-press`) · Forming & Foam (`forming-foam`) |
| Scanning, XR & Media (`scanning-xr-media`) | 3D Scanners (`3d-scanners`) · VR/XR (`vr-xr`) · Cameras & Mounts (`cameras-mounts`) · Tablets (`tablets`) |
| Shop Infrastructure & Supplies (`shop-infrastructure-supplies`, **hidden from the public gallery**) | Dust Collection (`dust-collection`) · PPE (`ppe`) · Benches & Carts (`benches-carts`) · Batteries & Chargers (`batteries-chargers`) · Consumables (`consumables`) · Office (`office`) |

**Where every tool goes** is `src/lib/taxonomy/mapping.ts`, three rules, first match wins:
by **slug** (every tool the review listed; ⚑ items take the review's suggested place), by **name**
(tools the review named that the saved listing had no slug for — the Ryobi impact driver, the
Waveshare e-paper HAT, the Stanley wallboard saw), then by **old category** (`group › name`, the
review's "Old → new"). *Woodworking › General Hand Tool* is split tool by tool in the review and has
no default: a tool there that no rule places stays put and is printed as unmapped. The facets ride
along — accessories (printer upgrades, the plunge base → the router, the Apple Pencil → the iPad,
chargers and batteries, hose fittings, the tripod, the label-maker adapter), consumables (sanding
sheets, the replacement blade, dust masks) and fixtures (benches and carts).

## 4. Data model (migration `0023_taxonomy_v2`)

### 4.1 `categories`

| Column | Notes |
|---|---|
| `slug` text not null, unique (`categories_slug_key`) | Backfilled from `group` + `name` (`category_slug_base`, numbered on a collision). A row inserted without one gets one from the `categories_default_slug` trigger, so the Notion import and older code keep working. Never changes on a rename. |
| `description` text | What belongs and what does not. Research reads it. |
| `parent_id` uuid → `categories.id` on delete set null | Replaces the free-text `group` for new data. Two levels: a parent must itself be top-level. |
| `sort_order` int default 0 | Tree order. |
| `gallery_hidden` bool default false | Set on Shop Infrastructure & Supplies; children inherit it. |
| `retired_at` timestamptz | Retired categories leave every select and research's list. Never deleted. |
| `merged_into_id` uuid → `categories.id` on delete set null | Where a merged category's tools went. |

`group` stays and is still read (a pre-v2 row's heading) until `taxonomy:migrate` retires those rows.
The name index is now `categories_name_group_parent_key` on `(lower(name), lower(coalesce(group,'')),
coalesce(parent_id::text,''))`, so one name may sit under two parents but not twice under one.

### 4.2 `category_proposals`

`id`, `kind` (`new_category` | `review_category`), `name`, `parent_id`, `description`, `reason`,
`source` (`research` | `refresh` | `chat` | `mcp` | `audit` | `gui`), `subject_type` / `subject_id`
(the tool that prompted it, or the category the audit flagged; text, not a foreign key), `flag` (the
audit's reason code), `nearest_existing_id` (research's best existing slug, resolved), `status`
(`pending` | `accepted` | `rejected` | `merged`), `resulting_category_id`, `decided_by`, `decided_at`,
actor columns and timestamps. A pending `new_category` of the same name under the same parent, or a
pending audit flag on the same subject, is answered rather than repeated.

### 4.3 `tools`

`item_kind` text not null default `equipment`, CHECK in (`equipment`, `accessory`, `consumable`,
`fixture`); `parent_tool_id` uuid → `tools.id` on delete set null.

### 4.4 Research result

`ResearchResult.category` gains optional `slug`, `confidence` (`high` | `medium` | `low`) and
`proposal` (`{ name, parentSlug, description, reason }`). Every older row still parses. The model's
answer is `category: { slug, confidence }` plus an optional top-level `categoryProposal`; the pre-v2
`{ name, group }` still reads (a stub, an older model), matched by name as before.

## 5. Behavior / flow

### 5.1 `npm run taxonomy:migrate` (dry run by default; `-- --apply` writes)

`scripts/taxonomy-migrate.ts` over `src/lib/taxonomy/migrate.ts`. Target is the import scripts'
order (`DATABASE_URL`, else `PGLITE_DATA_DIR`); **it refuses while the dev server holds the PGlite
lock** (`PgliteLockedError`), dry run included. The plan is a pure function of the rows:

1. A pre-v2 row (it has a group) that holds one of the tree's slugs is renamed `<slug>-legacy`.
2. The tree is created parents first; an existing tree row gets only what is missing (parent,
   description, sort order, the hidden flag) — a name or description somebody edited is theirs.
3. Every tool not already in the tree is moved by the mapping; facets are set only where still the
   defaults. A tool already in a tree category is never moved again.
4. Every pre-v2 category left with no tools is retired with `merged_into_id` = where most of its tools
   went (or the review's default target).

Everything is one transaction. A second run prints "Nothing to do". The catalogue is cached for
minutes; production gets the result through `npm run data:push`.

### 5.2 Research decides

`categoryBlock` lists **every** live category, uncapped, `slug — Parent › Name: description`. The rule
(both passes): answer exactly one slug, the most specific that fits, always (the nearest when none fits
well), with a confidence; fill `categoryProposal` only when none fits; never invent a slug.
`matchCategory` is exact on the slug (trimmed, lower-cased); an unknown or retired slug is no match.

### 5.3 Approval and `/admin/taxonomy`

The preliminary page preselects the matched category; when research proposed one it shows a ticked
"Also propose a new category …" box. Approval (`approvePendingTool`) puts the tool in the chosen
existing category (a retired one is refused) and, in the same transaction, records a
`category_proposals` row (source `research`, subject the new tool, nearest = the chosen category). The
pre-v2 `newCategory` field is accepted and recorded the same way — never created.

`/admin/taxonomy` (`taxonomy.manage`; in the admin nav under *Keep data fresh*; its tile counts
pending proposals): the queue first — **Accept** creates the category (fresh unique slug) and moves the
proposal's tool in if it is still where approval put it; **Use this category instead** (merge) sends the
tool to an existing category; for an audit flag, **Merge into this category** merges the flagged one;
**Reject** / **Dismiss** records the decision. Then the tree with counts, slugs, descriptions and the
hidden badge; each category can be renamed and described inline, merged (a second click naming both),
retired when empty, and its tools moved; old pre-v2 rows and retired categories are listed apart;
**Propose a category** is a form.

### 5.4 `npm run taxonomy:audit` (writes proposals; `-- --dry-run` only prints)

Flags a leaf category with 0–1 tools (`sparse`, the parent as the suggested merge target), a category
over 25 tools (`crowded`), the same name under two parents (`duplicate_name`) — each a
`review_category` proposal — and prints proposals pending over 14 days. It never renames, moves,
merges or retires. Idempotent.

### 5.5 MCP `create_tool`: match or propose

A candidate's category is matched by `slug` (new optional field), else by exact name (and heading
when given). Anything else is **not created**: the draft has no category and a `category_proposals`
row (source `mcp`, subject the draft) waits, and the warnings say so.

## 6. UI

`/admin/taxonomy` (`TaxonomyBoard`, `taxonomy-tree.ts`), strings under `admin.taxonomy.*`,
`admin.taxonomyTitle`/`taxonomyLede`, `admin.nav.surface.taxonomy`, `admin.home.taxonomyUnit`, five new
`admin.errors.*` codes; the preliminary page's category confidence and proposal box
(`admin.intake.categoryConfidence*`, `proposeNewCategory`); card sentences `actions.summary.taxonomy_*`.
English only (Phase 9 translates).

The gallery leaves hidden-by-default categories out until the Category facet names one (the facet
lists it with its count); a single-level category is said once ("Laser Cutting & Engraving", not
"… › Laser Cutting & Engraving").

## 7. The action layer (assistant–GUI parity)

| Action | Tool | Risk | Permission | Chat | MCP |
|---|---|---|---|---|---|
| `taxonomy.propose_category` | `propose_category` | catalog | `tools.edit` | propose | propose |
| `taxonomy.decide_proposal` | `decide_category_proposal` | catalog | `taxonomy.manage` | propose | propose |
| `taxonomy.merge` | `merge_categories` | destructive (typed name) | `taxonomy.manage` | propose | never |
| `taxonomy.edit_category` | `edit_category` | catalog | `taxonomy.manage` | propose | propose |
| `taxonomy.set_retired` | `retire_category` | catalog | `taxonomy.manage` | propose | propose |
| `taxonomy.recategorize_tool` | `recategorize_tool` | catalog (revision token) | `tools.edit` | propose | propose |

Reads: `list_categories` (`tools.edit`; slugs, paths, descriptions) and `list_category_proposals`
(`taxonomy.manage`; fenced as untrusted text and on `OUTSIDE_CONTENT_TOOLS`). No tool name hits the
assistant's deny list. Audited: `category.created`, `category.merged`, `category.retired`. Counts: action
tools 36 → 42 (super admin), 32 → 38 (admin); chat tools 54 → 62 and 49 → 57.

**`taxonomy.manage`** is held by **admin and super_admin**: SuperMakers run the catalogue day to day, and
a merge is audited and reversible by restoring and moving tools back. Proposing needs only `tools.edit`.

## 8. Security and safety

- Nothing creates a category but a person accepting a proposal (Article 5). The server actions check
  their own permission; a card commits only at the click; merge needs the category's name typed and is
  never over MCP or from a tainted turn.
- Research's and MCP clients' words (proposal names, descriptions, reasons) reach a model only through
  `list_category_proposals`, fenced; the research prompt's category lines are staff's own entries,
  clipped to one line.
- The Notion mirror's new category properties (`Slug`, `Description`, `Retired`) are **optional**: an
  existing mirror without them is not `schema_mismatch`, and the push leaves them out of its pages.

## 9. Knock-on changes

- Catalogue: `category` is the parent's name (or a pre-v2 group, or a single-level category's own
  name), `categorySub` the category; `categorySlug` and `galleryHidden` are carried.
- Inventory: the heading is the parent; the Category filter also takes a top-level name.
- Assistant: `search_tools` / `list_tools` leave hidden categories out for everybody but staff unless
  the category is asked for by name; `get_tool_details` answers for any published tool.
- Import mappers: Notion rows import as pre-v2 rows (slug from the trigger); `taxonomy:migrate` re-homes
  them. The demo seed is the v2 tree.
- `data:push` copies `category_proposals` and defers the new self-references (derived from the schema).

## 10. Testing

Schema and migration (`taxonomy-v2-migration.test.ts`: slug backfill read from the migration file,
the trigger, uniqueness, facets, proposals); the migration plan on a fixture database
(`taxonomy/migrate.test.ts`: every rule, legacy slug clash, unmapped, retirement, idempotence, facets
never overwritten); the audit (`taxonomy/audit.test.ts`); research parsing, the prompt and matching
(`research/taxonomy-v2.test.ts`); data writes (`data/category-admin.test.ts`); actions and permissions
including the adjacent-permission refusal and the typed-name merge card (`app/admin/taxonomy/actions.test.ts`);
the page (`TaxonomyBoard.test.tsx`); the knock-ons (`taxonomy/surfaces.test.ts`); approval and MCP
`create_tool` (updated suites); Playwright `e2e/taxonomy.spec.ts` on its own port.

## Amendments

### 2026-09-29 — Facets: the report, the editor, the tool page and the filters

**What was wrong.** After `taxonomy:migrate -- --apply` on the local and hosted databases the owner
read "0 facet updates" and concluded no tool had an item kind or a parent. The facets *were* written
(local SQL: 16 accessories — 5 with a parent — 3 consumables, 4 fixtures, 82 equipment). Every
facet rides along with its tool's move (§5.1 step 3), and the report counted those under
"tools moved"; `facets` counted only writes on tools that did **not** move, which on a first run is
always zero. Nothing in the app read `item_kind` or `parent_tool_id`, so nothing contradicted it.
The mapping keys on the slug (never the display name), so `inventory:cleanup`'s renames (PR #105)
could not have mattered, in either order.

**Changes.**

1. **The report says it.** The dry run prints `Facets: N set with a move, M on tools already
   placed.`; `--apply` prints `… T tools moved (N with facets), M facet updates on tools already
   placed, …` (`formatApplyReport`). The plan is unchanged: a facet still at its default is set on
   a tool that moves *or* one already placed; a chosen one is never overwritten. Idempotent.
2. **Five more slugs mapped** (`mapping.ts`), so a re-run places them without an old-category
   rule: the two hosted-only tools — `apple-homepod-2nd-generation` → **Cameras & Mounts**
   (`cameras-mounts`; no audio category exists and the tree prefers an existing leaf — propose
   "Audio & Smart Home" on `/admin/taxonomy` if more audio arrives) and
   `nest-protect-smoke-and-co-alarm` → **PPE** (`ppe`, the nearest safety leaf) as a **fixture**
   — and the three the cleanup bundle added after the review (`creality-ender-3-v3-3d-printer`,
   `glowforge-aura`, `bofa-ad500-fume-extractor`).
3. **The editor** (tool editor panel, `/admin/inventory` and edit mode) gains **Item kind** (a
   select over `TOOL_ITEM_KIND`) and **Accessory of** (a picker over every tool not archived, not
   itself an accessory, not this one — `listParentToolOptions`). Both save through the existing
   `saveTool` action and `updateTool`'s revision check, sending only what changed. `updateTool`
   refuses (`invalid_field`) an unknown kind, the tool itself, a parent that is itself an
   accessory, and giving a parent to a tool that has accessories: **one level**, so no chain and no
   cycle.
4. **The tool page** says **Item kind** (when not equipment) and **Accessory of** *tool* (a link)
   in Details, and a parent's page lists **Accessories**. Both come from the cached published
   catalogue (`toolRelations`); a draft or archived relative is not linked.
5. **Filters.** The gallery and the inventory gain an **Item kind** facet (`?kind=`). The gallery's
   visibility is unchanged: Shop Infrastructure stays hidden by default, so most consumables and
   fixtures appear once its category is chosen.

**The facet mapping** (every other tool is equipment with no parent):

| Item kind | Tools (slug → parent) |
|---|---|
| accessory, with parent | `original-prusa-i3-mk3s-enclosure-bundle` → `prusa-i3-mk3s`; `ultimaker-metal-expansion-kit` → `ultimaker-s5`; `ultimaker-s5-air-manager` → `ultimaker-s5`; `makita-plunge-base` → `makita-rt0701c`; `apple-pencil` → `ipad-6th-generation-mr7f2ll-a` |
| accessory, no parent | the Ryobi ONE+ 1.5/3/4 Ah batteries and two chargers, the DeWalt charger (a battery or charger serves a whole platform; `parent_tool_id` names one tool), `fulton-hose-ring-clamp`, `peachtree-woodworking-supply-pvc-hose`, `powertec-hose-coupler-70136` (dust-collection fittings), `tripod-with-adapter`, `label-maker-ac-adapter` |
| consumable | `dust-masks`, `hercules-sanding-sheets`, `suizan-replacement-blade` |
| fixture | `festool-bench`, `woodworking-tools-storage-bench`, `plywood-stacking-rolling-cart`, `valley-craft-a-frame-bin-cart`, `nest-protect-smoke-and-co-alarm` |

**Re-running** (both databases; stop `npm run dev` first for the local one):
`npm run taxonomy:migrate` (dry run — expect the two hosted-only tools to move and nothing else),
then `npm run taxonomy:migrate -- --apply`.

**Testing.** `taxonomy/migrate-facets.test.ts` (every mapped slug seeded under the cleanup's names,
cleanup before and after the migration, facets filled on already-placed tools, a chosen facet kept,
the report wording, the hosted-only tools, every cleanup-bundle slug mapped);
`app/admin/inventory/actions.facets.test.ts` (load, save, conflict, clear, refusals);
`ToolFieldsForm.test.tsx`, `tool/relations.test.tsx`, `GalleryShell.test.tsx`,
`InventoryBoard.test.tsx`, `inventory-filters.test.ts`, `gallery-filters.test.ts`; Playwright
`e2e/tool-facets.spec.ts` (read-only) and the Trotec facet round trip in `e2e/tool-editor.spec.ts`'s
serial describe.
