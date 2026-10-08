# Intake, research and naming

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Adding equipment (`pending_tools`, Phase 6; the image stage is gateway spec §3.5)

Three steps with a person at the end (spec §5.4). **Identify** in the chat,
**research** in the background — which now includes finding a product image —
**approve** on `/admin/intake`, choosing the image there — research never
creates a tool (Article 5).

- **The chat identifies and nothing more.** `identify_tools`
  (`capabilities/intake.ts`, `tools.add`, chat-only) records each item as a
  `pending_tools` row in one batch, runs the duplicate check
  (`src/lib/data/duplicates.ts` — normalised name-plus-brand, then `pg_trgm`
  at 0.5; different model tokens are never a match, and a merely *similar* name
  is stored pre-resolved as "It's a different tool" so it never blocks research
  — data-platform spec amendment 2026-09-24) and emits one `data-intake-table` part. `research_tool` and
  `propose_listing` are gone; the intake prompt allows two web searches, only
  to settle a model name.
- **No empty items** (data-platform spec amendment "No empty items",
  2026-10-07). A pending item's name must have one specific word
  (`intake/item-name.ts`): "Equipment not specified", "Unknown", "Item", "N/A"
  are refused everywhere a pending item is made or renamed — `identify_tools`
  (one placeholder saves none of the turn's rows; the error tells the model to
  ask for a name, a photo or a list), `createPendingBatch`
  (`PlaceholderItemNameError`), `updatePendingTool` (`placeholder_name`, 422
  on the PATCH route), the rename proposals, MCP `create_tool`, and an import's
  rows (skipped as `placeholder_name`). The prompt: when nothing is named, ask
  what it is and create nothing.
- **Many items at once** (data-platform spec amendment "Many items at once",
  migration `0025`). The prompt asks for every distinct object in every photo
  and every line of a list, one entry each, with `quantity`, `seenIn` and
  `confidence` (`sure`/`likely`/`unsure` — an item it cannot name is included as
  `unsure`, never dropped). Before any row is written,
  `intake/identify-items.ts` turns a count left in a name into the quantity and
  folds the same object seen twice into one item (never two serials, never
  `unsure`). **A photo that shows several items** is claimed by the first and
  **copied** to each other one (`files/share-photo.ts`, `copyToPublic` + a new
  `attachments` row — two rows must never share a blob, or one item's discard
  deletes another's picture); a lone photo with no mapping goes to every item.
  `pending_tools.identify_confidence` / `seen_in` are stored; the count is the
  existing `quantity` (units at approval).
- **The table card talks to routes, never to the model.** `IntakeTableCard`
  edits, removes and resolves duplicates through `PATCH
  /api/pending-tools/[id]`, and **Add to research (N)** is `POST
  /api/pending-tools/research` with exactly the ticked ids — after
  `ResearchSpendConfirm` shows the count, the allowance left (`researchLeft`,
  `intake/allowance.ts`) and about what it costs
  (`RESEARCH_ESTIMATED_USD_PER_ITEM`). `unsure` rows start unticked. **Just add
  to intake** sends nothing; **Discard (N)** asks, then PATCHes each.
  `/admin/intake`'s selection bar (`QueueList`'s `selectionActions`) has the
  same **Research selected (N)** and confirmation. Every check in that
  route runs before any row moves; add-unit items skip research; a `start()`
  that throws leaves the items `queued` with the reason in `research_error`,
  and the same POST is the Retry.
- **Research is a Workflow SDK run** (`src/workflows/research-batch.ts`, steps
  in `src/lib/research/steps.ts`): three items at a time by chunked
  `Promise.allSettled`, two model steps per item (search with `exa_search`,
  then a read step that fetches its candidate pages itself with `readPage` and
  hands the model their text, rather than giving the model a fetch tool),
  each with its own 240-second deadline and `maxRetries = 2` set as a property.
  The prompt, output parsing, error classification and assembly are
  `src/lib/research/*`. **Confidence is computed in code** (`scoreConfidence`),
  and the model's reported evidence is only ever lowered to match what
  verification found — so "research found nothing" grades low, never medium.
  Step code runs under plain Node: relative imports, no `"server-only"`
  anywhere below it, and `vi.mock` does not reach it under `@workflow/vitest`
  (models are stubbed at the Gateway's HTTP boundary with `test/gateway/*`
  instead). The research route imports `researchBatch`, which is what makes
  `next build` compile the workflow at all.
- **A third workflow step finds a product image** (gateway spec §3.5,
  `src/lib/research/image-steps.ts`'s `findImages`), after the read step
  succeeds: candidates from the read pages' `og:image`/`twitter:image`/JSON-LD
  and from Exa's own image links, probed for real dimensions and format
  (`src/lib/images/inspect.ts`, no deps), ranked by a model shown up to
  `IMAGE_MAX_RANKED` of them — which must give each a `subject` verdict; only
  the product itself is kept (never an accessory, consumable, part, packaging
  or another model), the manufacturer's pictures lead their view tier, and
  when none passes there is no image (`images.allRejected`; amendment "The
  product itself, or no image") — and — for the top candidate only — cleaned
  (background removed). **Never a generative redraw** (spec amendment "No
  generative redraw: deterministic cutout"): each probed candidate's
  background is classified from its border pixels (`images/background.ts`:
  `transparent` / `plain` / `busy`, recorded on the candidate); ranking is
  told the class and a clean background wins a close call (`images/rank.ts`,
  `BUSY_PENALTY`). Candidates include the pages' gallery `<img>`s, and size
  variants count once (`web/image-url.ts`); ranking also flags **composites**
  (banners, price overlays, collages — ranked below every plain photo, tagged
  "Banner") and boxes the product, and a rank 1 that is a composite, busy or
  small in its frame is **cropped** to that box, then cut when the crop's
  backdrop is plain (`images/crop.ts`, `images/clean-copy.ts`;
  `cleaned.kind` `cropped_and_cut` / `cropped` — amendment "Composites and
  product crop"). Otherwise a `plain` rank 1 is cut out by a flood fill from the frame
  that keeps the original's pixels (`images/clean.ts` — validated, feathered,
  trimmed; a rejected cut records `images.cleanNote`); a `transparent` rank 1
  *is* the clean version and gets no copy; a `busy` one gets none either
  (`cleanNote: "busy_background"`). `sharp` does the decoding, loaded through
  `images/downscale.ts`'s guarded `loadSharp` (Next's own dependency; without
  it nothing is classified or cut). **Cleaning needs a Blob store**; with none
  configured the stage skips it and offers the research candidates alone (the
  intake E2E runs on a server with a local store, so it cuts the stub's
  plain-backdrop product out, picks the cleaned copy and sees it in the
  gallery — see `e2e/intake.spec.ts`). The result is `images` on
  the stored `ResearchResult` (`src/lib/research/result.ts`): up to three
  ranked candidates plus the cleaned copy's private attachment id, or
  `imageError` when the stage failed — never a reason to fail research itself.
  **A photo uploaded in the chat skips nothing** (gateway spec amendment "An
  uploaded photo is a choice, not the product image"): it identified the item,
  the stage runs anyway, and the photo is offered beside what it found.
- **Nothing is stored until approval.** The preliminary page's "Product image"
  control (spec §3.5, the *ProductImage* group) offers the cleaned copy (when
  there is one), each ranked candidate with a "From `<host>`" attribution, each
  chat photo as "Your photo" (with a **Remove the background** checkbox, on by
  default), and "No image" — a choice, not a default. A found image is always
  preselected over a photo (`initialImageChoice`, shared with the assistant's
  **approve these**). `GET
  /api/pending-tools/[id]/cleaned-image` streams the private cleaned PNG to a
  reviewer holding `tools.approve`, rate-limited; nothing else can read it.
- **Product page first, front-facing covers, reviewer corrections** (gateway
  spec amendment "Product-page first, front-facing images, reviewer notes").
  `research/source-pages.ts` classifies a URL from its address (the brand's
  product page, a manual/wiki/support page, a video). The read step always
  reads a found product page, videos go last, and a video never satisfies
  `manufacturerPageFound` / `specsFromSource`. Ranking also reports each image's
  `view`, and back views, details and parts sort last. **Research again** opens an
  inline "Anything to focus on?" panel (`ResearchAgainDialog`, amendment "Guided
  redo"): focus chips (everything, or some of description / specs / links /
  image), quick suggestions, and an optional one-paragraph note (≤1000,
  `tools.approve`, fenced in both prompts, recorded as `research.reviewerNote`).
  A scoped redo sends `focus`; `completeResearch` then **merges** only those
  fields into the stored result (`research/focus-merge.ts` — evidence and
  confidence move only when specs or links did), an image-only focus is **Find a
  different image**, and the page marks what changed "Updated just now". **Find a different image**
  (`requestDifferentImage` → `src/workflows/image-retry.ts` →
  `research/image-retry-steps.ts`) reruns only the image stage, with its own note
  and at most one Exa search. It costs one against the daily allowance, keeps its
  state in `research.imageRetry` (no migration) and replaces `research.images`,
  releasing the old cleaned copy. **A step module exports only steps**: the
  shared probe/rank/clean middle is `research/image-stage.ts`, imported directly,
  because a workflow bundle keeps every export of a step module (a re-export once
  pulled `guardedFetch` into it and broke `next dev`).
- **A page our server cannot open is read from the search's copy** (gateway
  spec amendment "Search text fallback and confidence cap"). Research's Exa
  search returns page text (12k chars per result); `searchItem` carries the
  texts of candidate pages (`research/search-text.ts`), and the read step uses
  one when `readPage` failed (403 bot challenge, 429, timeout), was too large or
  had no text — never for a `blocked` (SSRF-guard) result. It is fenced and
  labelled "text captured by search", recorded as `research.searchTextSources`,
  and counts for `manufacturerPageFound` / `specsFromSource` only when it is the
  brand's product page. **Confidence is capped at medium** when every page read
  was a video, or none was (`readCap` in `capabilities/confidence.ts`), and the
  strip says why.
- **Approval is one transaction** (`approvePendingTool` / `approvePendingAsUnit`
  in `src/lib/data/pending-tools.ts`), composed with the audit trail and
  `invalidateCatalog()` by `src/lib/intake/approve.ts`. Approving published
  records `pending.approved` **and** `tool.published`; a lost audit event is a
  warning on a success, as everywhere else. **The image choice is resolved
  here too:** "cleaned" promotes the already-stored private attachment to
  public; "original" downloads the candidate's own URL, **cleans it** with
  the same deterministic crop and cutout rank 1 gets
  (`research/images/pick-clean.ts`, from the candidate's recorded
  `background` / `composite` / `productBox`, classified on the spot when
  absent; the downloaded bytes when no cut is possible), and stores it —
  except rank 1's original chosen beside its cleaned copy, stored uncut
  (amendment "The picked image is cleaned too"; refresh's accepted cover
  goes through the same `storeResearchImage`); "upload" takes one of the item's
  own photos — as taken (made public if it is still private), or, with
  `removeBackground`, read back from its store and given the same
  `cleanPickedImage` cutout, stored public as the item's
  `research_image_cleaned` copy (used as taken when no cut can be made). Stored copies are
  `attachments.origin` `research_image` / `research_image_cleaned` — see
  C11 in the gateway spec; a download or store failure is never a reason to
  fail the rest of the approval — it is the `image_not_attached` warning
  (`admin.warnings.image_not_attached`), the same "warning on a landed write"
  shape every admin surface uses. Low confidence keeps both Approve buttons off
  until "I've checked this" is ticked and a note written. **Training is the
  lab's call** (amendment 2026-09-24, `src/lib/intake/training.ts`): research
  leaves a pending item's `trainingRequired` null, the page starts at "Staff to
  confirm (saved as required)" beside any verified training quote, and approval
  stores `true` unless the reviewer chose "No training needed".
- **Starter questions** (gateway spec amendment "Tool-specific starter
  questions"). The read step's JSON also carries `starterQuestions`: three
  short questions (≤80 chars) a student might ask the assistant about the
  tool, in the same call, so no extra cost. `src/lib/starter-questions.ts` is
  the one rule — `cleanStarterQuestions` reads a model's answer leniently
  (trimmed, one line, ends in "?", once each, three at most, an over-long one
  dropped, never refused); `starterQuestionsFromEditor` refuses staff input
  over three or over 80 (`invalid_field`) rather than cutting it. They are
  optional on `ResearchResult` (old rows parse), a **Description** redo
  regenerates them (`focus-merge.ts`; a run with none keeps the stored ones),
  approval copies them onto `tools.starter_questions` (migration `0009`,
  `text[] not null default '{}'`), the tool editor edits them (three boxes,
  saved through `updateTool` with the revision check), and the catalogue
  carries them as `MakerLabTool.starterQuestions`. The tool page renders
  `ToolChatStarters`, which registers them with `ChatLauncherContext`;
  `ChatPanel` shows them as its chips while the path still names that tool (slug
  or id), and the generic, translated chips everywhere else and for a tool
  with none. The questions are data, English as written. Not carried by the
  Notion mirror (a new property would put existing mirrors in
  `schema_mismatch`) or MCP. **Backfill:** `scripts/generate-starter-questions.ts`
  (`--dry-run`, `--limit N`, `--ids a,b`) asks the `researchRead` model for
  tools whose list is empty, from name, description and resource titles only,
  and writes through `updateTool`; see `docs/deploy.md` Stage 2c.
- **The daily cron expires what nobody researched.** `identified` rows older
  than 14 days are discarded and their photos released (`runPendingExpiry`),
  just before the orphan sweep deletes them from Blob.

## Refresh research (`tool_refreshes`, `chat_proposals`; refresh research spec, migration `0012`)

Existing tools researched again, **blind**, with every change a proposal a person accepts
(Article 5). See the spec's 2026-09-23 amendment for the as-built detail.

- **The engine** is `research/engine.ts` (`runSearch`, `runRead`) — intake's steps and
  refresh's steps (`src/lib/refresh/steps.ts`, run by `src/workflows/refresh-batch.ts`)
  both call it. Refresh tells it only the tool's name and category name
  (`refresh/blind-input.ts`); the tool's own processed manual is given as its outline plus
  the passages for fixed spec-like queries (`refresh/manual-context.ts`, 16k budget). The
  read step asks every run for verbatim `citations` and an `emergencyStop`; code checks each
  quote against the page it names (`refresh/citations.ts`).
- **The diff is code** (`refresh/propose.ts`): kinds *differs* / *new* / *unverified*,
  safety fields first, list additions only, links the tool lacks, a cover only when it has
  none (ranked, never stored until accepted), a `floor_check` for a tool research could not
  identify. **Never PPE.** **Research never replaces a lab rule** (`refresh/lab-rules.ts`,
  amendment 2026-09-24): on a catalogue tool, restrictions only gain lines beside the lab's,
  training is never proposed off — in the diff, in `propose_change` (chat and MCP), in the
  conflict re-base and as `refusalFor`'s `replaces_lab_rule`. A pending item's values are
  drafts and may be replaced.
- **Queue**: `/admin/inventory` checkboxes → **Refresh research (N)** → `queueToolRefresh`
  (`tools.edit`, ≤ 25, the same daily ledger and lock as intake). **Review**:
  `/admin/refresh` and `/admin/refresh/[id]`. **Accept** writes through the editor's save
  path at `base_revision` (`refresh/apply.ts`, `refresh/decisions.ts`); a conflict writes
  nothing and re-bases the cards. A published rename needs `tools.publish`.
- **Research with the assistant** (§12): `capabilities/curation.ts` (`get_record`,
  `propose_change`) is composed by the chat route only for a caller who may curate the
  page's record (`lib/chat/curation.ts`); quotes are checked against what the turn read
  (`lib/chat/turn-sources.ts`); cards are `data-proposal` parts (`ChatProposalCards`), decided
  through `POST /api/chat-proposals` (`refresh/chat-decisions.ts`) — never a model tool.
- **Tests**: `refresh-batch.workflow.test.ts` stubs the Gateway's wire; the pure parts
  (`propose`, `citations`, `decide`, `blind-input`) have fixture tests shaped like the Aug 29
  reconciliation; `fixtures.test-helpers.ts` holds the shared fixtures.

## Bulk intake (`bulk_imports`, `research_allowances`; bulk intake spec, migration `0013`)

Importing a list — a CSV/TSV file, pasted cells, a plain list, a document or a PDF — as
**identified** pending items, reviewed before a cent is spent. Nothing an import makes is
researched or published on its own (Article 5). See the spec's 2026-09-24 amendment.

- **Parsing is code** (`src/lib/import/`, client-safe and plain Node): `table.ts` (RFC 4180,
  BOM, delimiter sniffing — tab first), `columns.ts` (header synonyms, the column map),
  `items.ts` (validation: names, http(s) links, lab documents by host, quantity 1–50,
  serials, `consumable?`), `line-list.ts` (plain lists), `detect.ts` (table / list /
  document). Only prose and PDF text reach a model: job **`importParse`**, no tools, the text
  fenced (`extract.ts`), run by `src/workflows/import-document.ts`. **Caps refuse, never
  cut** (amendment 2026-09-24): a document over 200,000 characters is `document_too_long`
  before any model call, worded in pages (≈ 3,300 chars a page, limit ≈ 60); over 1,000
  items is `too_many_items` with the count — a document that names that many fails as
  `too_many_items:<n>`, nothing written.
- **`src/lib/import/service.ts`** (`startImport`, `confirmImportMapping`) is the one path for
  `POST /api/imports`, the mapping step and the chat's `start_import`. Rows are made only by
  `addImportItems` (`data/bulk-imports.ts`): one transaction, the import locked, each row
  duplicate-checked against inventory, waiting items and the import's earlier rows.
- **The review page** `/admin/intake/imports/[id]` (`ImportReview`, `ImportTable`,
  `ImportMapping`; server actions in `app/admin/intake/imports/actions.ts`, each checking
  `tools.add` and ownership). **Research selected** goes to the existing research route 25 at
  a time from the browser (`import/research-queue.ts`) — a partial chunk at the allowance's
  edge, the rest said to wait. **Suggest names** is job **`nameSuggest`** (one call with Exa,
  name/brand/category only), workflow `suggest-names.ts`, charged a quarter item each.
- **Units and lab documents at approval**: `max(quantity, serials)` units of one tool
  (`import/resources.ts`); lab documents become `resources.origin = 'lab_document'` — never
  archived, never in the chat's manual list, never a `read_page` host, badged *Lab document*
  on the tool page. The list's own links are offered on the preliminary page.
- **Setup allowances**: `researchLimitFor` (`data/research-allowances.ts`) = 100 + running
  grants, used by research, refresh and Find a different image; granted on `/admin/users`
  (`users.manage`), audited `allowance.granted`.
- **Uploads**: kind `import` on `POST /api/uploads` (private, `tools.add`). The chat's
  paperclip takes list files and names them to the model as `[Attached documents: …]`.

## Taxonomy v2 (`categories` tree, `category_proposals`; taxonomy v2 spec, migration `0023`)

Nine top-level categories by process or shop, each with a second level, every category with a
slug and a description (`docs/specs/2026-09-28-taxonomy-v2-design.md`). **Nothing creates a
category except a person accepting a proposal on `/admin/taxonomy`** (or the one-off migration).

- **The tree** is `categories.parent_id` (two levels; a parent is top-level), with `slug` (unique,
  never changes; a row inserted without one gets one from the `categories_default_slug` trigger),
  `description`, `sort_order`, `gallery_hidden`, `retired_at`, `merged_into_id`. The free-text
  `group` is only a pre-v2 row's heading now; `listCategories()` answers `group` = the parent's name
  (or that old group) so every select reads the same, and leaves retired categories out. The seed is
  `src/lib/taxonomy/tree.ts`; the demo seed writes it.
- **`npm run taxonomy:migrate`** (dry run; `-- --apply` writes, one transaction) creates the tree and
  moves every tool by `src/lib/taxonomy/mapping.ts` (slug, then name, then old category), sets
  `item_kind` / `parent_tool_id` where still the defaults, and retires emptied old categories with
  `merged_into_id`. Deterministic and idempotent; **refuses while the dev server holds the PGlite
  lock**; production gets it through `npm run data:push`. **`npm run taxonomy:audit`** (`-- --dry-run`
  to only print) writes `review_category` proposals for 0–1-tool leaves, >25-tool categories and one
  name under two parents, and prints proposals pending over 14 days. It never changes the tree.
- **Research decides** (`research/prompt.ts` `categoryBlock`): every live category, uncapped, as
  `slug — Parent › Name: description`; the answer is `category: { slug, confidence }` (required, the
  nearest when none fits) plus an optional `categoryProposal`. `matchCategory` is **exact on the
  slug**; a pre-v2 `{ name, group }` answer still matches by name. `ResearchResult.category` gains
  optional `slug`, `confidence`, `proposal` (old rows parse).
- **Approval never creates a category**: `approvePendingTool` puts the tool in the chosen existing
  (live) category and records research's proposal — `categoryProposal`, or the pre-v2 `newCategory`
  — as a `category_proposals` row naming the new tool (`nearest_existing_id` = the chosen category).
  Accepting it later moves the tool in if it is still there. The preliminary page shows a ticked
  "Also propose a new category" box. **MCP `create_tool` matches or proposes**: slug, then exact name;
  anything else leaves the draft uncategorised and proposes (`source: mcp`), said in its warnings.
- **`/admin/taxonomy`** (`taxonomy.manage` — admin and super admin; surface key `taxonomy`, Keep data
  fresh, its tile counts pending proposals): the queue (Accept / Use this category instead / Reject;
  an audit flag: Merge into / Dismiss), the tree with counts, slugs, descriptions and the hidden badge
  (rename and describe inline, merge on a second click naming both, retire when empty, move a tool
  through the editor's revision check), old pre-v2 rows and retired ones apart, and **Propose a
  category**. Writes are `src/lib/data/category-admin.ts`, one transaction each, refusals as values.
- **Actions** (`lib/actions/taxonomy.ts`): `taxonomy.propose_category` (`propose_category`,
  `tools.edit`), `taxonomy.decide_proposal` (`decide_category_proposal`), `taxonomy.merge`
  (`merge_categories`, destructive: typed name, never MCP), `taxonomy.edit_category` (`edit_category`),
  `taxonomy.set_retired` (`retire_category`) — those four on `taxonomy.manage` — and
  `taxonomy.recategorize_tool` (`recategorize_tool`, `tools.edit`, revision token). Reads:
  `list_categories` (`tools.edit`) and `list_category_proposals` (`taxonomy.manage`, fenced, taints).
  Audited: `category.created`, `category.merged`, `category.retired`.
- **Hidden from the gallery**: *Shop Infrastructure & Supplies* (`gallery_hidden`, inherited). The
  catalogue carries `galleryHidden` and `categorySlug`; `visibleInGallery` leaves those tools out until
  the Category facet names the category; the assistant's `search_tools` / `list_tools` do the same for
  everybody but staff. `category` is the parent's name (a single-level category is its own heading,
  said once). The inventory's Category filter also takes a top-level name.
- **Facets**: `tools.item_kind` (`equipment` | `accessory` | `consumable` | `fixture`) and
  `tools.parent_tool_id` (accessory → tool). Not yet in the editor or the gallery.
- **Mirror**: the categories database gains `Slug`, `Description`, `Retired` as **optional**
  properties (`MirrorPropertySpec.optional`): a mirror made before them is not `schema_mismatch`, and
  the push leaves absent optional properties out (`absentOptionalProperties`). `Group` is the heading.

## Tool names: display and official (`tools.official_name`; tool display names spec, migration `0015`)

A tool has two names (`docs/specs/2026-09-24-tool-display-names-design.md`).
**`tools.name` is the display name** — short, what people say ("Makita Plunge Base",
"Formlabs Form 4"), no part numbers, ≤ 40 — and every surface that already read `name`
(gallery, tool page title, breadcrumbs, admin tables, chat, QR and unit labels, the mirror's
title, the slug) keeps reading it. **`tools.official_name`** (nullable) is the full product
name with model or part number, shown under the tool page's title when it differs
(`officialNameShown`), searched beside the name, given to research (`blindInput` →
`lookupName`) and returned over MCP as `official_name`.

- **One rule module**, `src/lib/tool-names.ts` (pure, no imports): `displayNameProblems`,
  `isValidDisplayName`, `cleanDisplayName` (the guard — removes part numbers, bracketed
  noise and spec runs, cuts at a word boundary to 40, never adds a word; keeps `Form 4`,
  `X2D`, `MK4S`, `Speedy 400`), `displayNameFrom`, `officialNameShown`, `lookupName`.
- **Research** asks for `officialName` and `displayName`; the official name is still stored
  as `ResearchResult.canonicalName` (key kept so old rows parse), the display name as
  optional `displayName`, always through the guard (`assemble.ts`). Old rows derive it
  (`researchDisplayName`).
- **Writes refuse, never cut**: `updateTool` and `approvePendingTool` answer
  `invalid_field` for a display name over 40; the editor says so before saving.
- **Refresh** proposes `official_name` (a proposal field) with a verified quote, and `name`
  only when the current display name breaks the rules — a lab's rule-following name is
  kept, like a lab rule. Chat/MCP `propose_change` refuse a `name` that breaks the rules.
- **Backfill**: `npm run names:backfill -- [--dry-run] [--ids] [--limit]`
  (`scripts/backfill-display-names.ts`, job `displayName`, flex): shortens names that
  break the rules and moves the long form to `official_name` only when that is empty.
  The model sees name, category, description and same-brand names; all answers are
  resolved together (`resolveDisplayNames`) before any write.
- **Says what it is, and unique** (amendment 2026-09-25). A display name that is only a
  brand ("Hakko", "Aoyue Int") is refused wherever a model answer is guarded
  (`isBareBrand`, `src/lib/tool-name-brand.ts`); the fallback is brand + category noun
  ("Hakko Soldering Station"), else the old name. Four bare digits are a model line
  ("Dremel 3000"). **Display names are unique across tools** (`normalizeName`, archived and
  drafts included; no index): `updateTool`, `approvePendingTool` and MCP `create_tool`
  refuse `duplicate_name` (`src/lib/data/tool-name-clash.ts`); the editor and intake page
  warn first. A collision keeps the distinguishing spec ("Ryobi ONE+ 4Ah Battery") —
  a spec is allowed only when needed (`specNeeded`; `src/lib/tool-name-choice.ts`).
  The display-name instructions are **one text**, `DISPLAY_NAME_RULES`
  (`src/lib/display-name-rules.ts`), shared by the backfill, research's read prompt and
  Suggest names.

## Tool descriptions: short (gateway spec amendment 2026-09-26 "Short descriptions")

- **The rule** (the owner's): say what the tool is and what students use it for, touching on a
  spec or two; **1–3 sentences, at most 5** for a complicated machine, about 450 characters
  (code's limit is `DESCRIPTION_LIMIT_CHARS`, 500), plain prose, **no Markdown list**. One
  module, `src/lib/description-rules.ts` (pure): `DESCRIPTION_RULES` (the text research's
  read prompt and the shorten script share), `descriptionProblems`, `newNumbers`.
- **Research** still gathers the full `specs` list (evidence, confidence), but approval no
  longer folds it into the description (`proposedDescription` is the description alone).
- **Shorten what is stored**: `npm run descriptions:shorten -- [--dry-run] [--ids] [--limit]`
  (`scripts/shorten-descriptions.ts`, job `descriptionShorten`, flex): rewrites descriptions
  that break the rule from **only the facts already in them**; a rewrite that still breaks
  the rule, is not shorter or adds a number is rejected; writes carry the revision read at
  selection (an edit meanwhile is skipped). Same target/lock handling as `names:backfill`.

## English resources only (gateway spec amendment 2026-09-26 "English resources only")

- **The rule** (the owner's): every link research or refresh keeps — manual, product page,
  video, other — is an English page or an English manual; a multilingual manual with an
  English section counts. Judged **in code, no model call**: `src/lib/research/language.ts`
  (pure) — `urlLanguages` (path/subdomain/query locale, PDF file-name tokens; a ccTLD is not a
  signal), `declaredLanguage` (`<html lang>`, now returned by `readPage` as `lang`),
  `textLanguage` (1,000-char windows, script then stop words; a manual needs one English
  window), `titleLanguage`, and `pageLanguage` (text → declared → URL; unknown is kept).
- **Where**: the prompt's `ENGLISH_PARAGRAPH` (both passes); `candidatePageUrls` skips
  candidates whose URL names only another language; `readCandidatePages` judges every page
  read (a manual on its whole text) and leaves non-English ones out as `skipped (not English:
  de)`, returning `languages`; `pickManualPdfs` skips non-English PDFs; `keepEnglishLinks`
  (`research/english-links.ts`) runs in `engine.ts` before verification, dropping into
  `droppedLinks`; `verifyUrl({ englishOnly })` drops a YouTube video with a non-English oEmbed
  title (research only). Refresh's diff lets `/en-us/x` be proposed beside a tool's `/de-de/x`;
  `propose_change` refuses a non-English resource (`not_english`).
- **Existing links**: `npm run resources:language -- [--json] [--ids] [--no-fetch]`
  (`scripts/resource-language.ts`) — read-only report (slug, title, URL, reason); opens links
  with no URL/title signal through `readPage` (6 s, four at a time, no PDFs or videos). Same
  target/lock handling as `names:backfill`.
