# Bulk Intake: Import a List of Equipment — Design Spec

**Date:** 2026-09-23
**Status:** Draft
**Target:** `v5/` (not Blueprint)
**Branch:** `v5/bulk-intake-spec`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

Adding equipment today is conversational: photos or a few names in the chat,
`identify_tools`, the intake table card, then **Research selected**. That suits three
printers, not an 80-row inventory spreadsheet or a pasted list from an old wiki.

**Bulk intake** is a new way into the same pipeline:

- **Import a list** on `/admin/intake` takes a CSV or TSV file, pasted text, or an
  unstructured document (plain text or a PDF export).
- It turns every row or line into a pending item in the **identified** state, exactly as if
  the chat had identified it. The existing duplicate check runs on each one.
- A **full-width review table** lets an admin fix names, pick which rows to research, and
  resolve duplicates, before a cent is spent on research.
- **Research selected** then feeds the existing research workflow, in batches.

Two extras the lab asked for:

- **Lab documents.** Each row can carry links to in-house material, such as Google Docs,
  SOPs or past-project notes. These are attached to the item as resources marked **Lab
  document** and pass through to approval unread. Research doesn't need them, and private
  Docs couldn't be fetched anyway.
- **Suggested names.** An optional cheap pass (one search plus a tiny model call per item,
  about 0.8¢) proposes the exact brand and model for vague names like "Drill master Heat
  Gun" or "Form 2", shown beside the original for one-click accept.

**The chat hands off.** Dropping a CSV or a long list into the chat doesn't process it in
the conversation. The assistant creates an import and answers with a card ("42 items found
→ Review import"). Small additions keep using `identify_tools` as today.

No architecture change: one table, one page, one capability tool, reusing `pending_tools`
and the research workflow.

## 2. Goals / Non-goals

### Goals

- **Import sources:**
  - CSV and TSV with a header row, with column matching suggested automatically and
    confirmed once;
  - pasted text, whether spreadsheet cells (tab-separated) or a free-form list;
  - unstructured documents (`.txt`, `.md`, `.pdf` text) parsed by a model into items, with
    **no web search** at this stage.
- **Recognized columns:** name, brand, model, serial number, category, location, quantity,
  notes, links (product or manual URLs) and lab-doc links.
- **Quantities and serials make units.** "Quantity 3" or three serial numbers produce one
  pending item with 3 units, not 3 tools.
- **Duplicates.** Every imported item runs the existing duplicate check against the
  inventory, other pending items, *and the other rows of the same import*.
- **The review table** handles 500 rows: search, filter (duplicates, unnamed, selected),
  select all/some, inline edit, bulk-set category or location, remove.
- **Research in batches.** Research selected (N) queues in chunks of 25 (the per-request
  limit), and an admin can grant a **setup allowance** above the daily 100.
- **Lab documents** are carried as resources marked `Lab document` and survive approval
  unchanged.
- **Imports are resumable.** A half-reviewed import waits on `/admin/intake`, and nothing
  expires until the pending items' own 14-day rule applies.

### Non-goals (this iteration)

- **XLSX, Google Sheets or Airtable connectors.** The page tells people to export CSV. A
  spreadsheet parser dependency is proposed separately if CSV proves painful (§11).
- **Reading lab documents for research or chat.** That needs a Google Drive connection;
  later, and Blueprint-flavoured.
- **Importing photos in bulk from a folder.** Rows can reference product-page links; photos
  come from research's image finder or are added later.
- **Updating existing tools from a sheet.** Bulk intake adds equipment. Changing existing
  records is refresh-research's job.
- **Blueprint's setup wizard.** It may reuse this importer later, but that isn't designed
  here.

## 3. Architecture

### 3.1 The pipeline

```text
Upload / paste / chat hand-off
      │
      ▼
bulk_imports row (status: parsing)            — the source kept as private Blob + metadata
      │  parse step (in the request for CSV/TSV; a workflow step for documents)
      ▼
pending_tools rows (status: identified, import_id set, batch_id = import's batch)
      │  duplicate check (existing), plus within-import duplicates
      ▼
/admin/intake/imports/[id]  — review table: edit, select, resolve duplicates,
      │                        optional "Suggest names" pass
      ▼
Research selected (N) → existing POST /api/pending-tools/research, chunked by 25
      │
      ▼
existing research workflow → preliminary pages → approve (unchanged)
```

### 3.2 Parsing

- **CSV and TSV** use a small RFC 4180 parser in `src/lib/import/table.ts`, with quoted
  fields, embedded commas and newlines, and a UTF-8 BOM. It is dependency-free, and
  pure-function tested.
  - **Header matching** is by synonyms: "Item", "Tool", "Equipment" → name; "Make",
    "Manufacturer" → brand; "Qty", "Count" → quantity; "SOP", "Doc", "Google Doc" → lab
    docs.
  - The admin confirms or changes the match in a small mapping step before rows are
    created.
- **Pasted spreadsheet cells** are TSV and follow the same path.
- **Free-form lists and documents** go to `extractInventoryItems(text)`:
  - a `researchRead`-job model call, Luna by default, with the flex tier;
  - structured output of `{ items: [{ name, brand?, model?, quantity?, serials?,
    category?, location?, notes?, links?, labDocs? }] }`;
  - chunked at about 8k characters, so a long document becomes several calls;
  - no tools, and the document text is fenced as untrusted data;
  - it runs as a workflow step because a long PDF can take a while.
- **Validation** before any row is created: every item needs a name. URLs are checked to be
  `http(s)`; anything else goes into notes. Quantity is 1–50. Serials are one line each.

### 3.3 Suggested names (optional, per import)

`suggestNames(items)` runs as a workflow over the selected rows, 5 at a time:

- one Exa search, with highlights and no page text;
- one small model call returning `{ canonicalName, brand, confidence: "exact" | "likely" |
  "unsure", sourceUrl }`.

The review table shows the suggestion beside the original name, with **Accept**, **Accept
all exact** and **Ignore**. Accepting edits the pending item's name through the existing
`updatePendingTool`, so the duplicate check runs again. About 0.8¢ per item; it counts
against the research allowance at a quarter of an item each.

### 3.4 Lab documents

- **Each `labDocs` URL becomes an intake resource** `{ title, url, type: "Other", origin:
  "lab_document" }` on the pending item, stored in `research`-independent pending metadata
  so a research rerun never drops it.
- **At approval** they become ordinary resources with `origin = 'lab_document'`. The tool
  page labels them *Lab document*, and they sit above manufacturer links.
- **They are never fetched.** No link check, no archiving, nothing passed to research. They
  may be private.
- **Titles** come from the row ("SOP", "Past projects") or default to the link's host plus
  "Lab document".

### 3.5 The chat hand-off

A new chat capability tool `start_import` (`chatOnly`, `tools.add`):

- **When** the user attaches a CSV, TSV or text document, or pastes a list longer than
  about 15 lines, the intake prompt tells the model to call `start_import` with the
  attachment id or the text. It does not attempt `identify_tools` on it.
- **What it does:** creates the `bulk_imports` row and runs the same parse path, then
  returns a `data-import-card`: "42 items found (3 possible duplicates) → **Review
  import**".
- **Small lists** (up to about 15 items, or photos) keep using `identify_tools` and the
  in-chat table.

## 4. Data model

### 4.1 `bulk_imports` (migration: next free number)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `batch_id` | uuid | Shared by its pending items (`pending_tools.batch_id`) |
| `source_kind` | text CHECK | `csv`, `tsv`, `paste`, `document`, `chat` |
| `source_attachment_id` | uuid fk `attachments`, set null | The uploaded file, private Blob |
| `source_name` | text | Original file name |
| `column_map` | jsonb null | Header → field, as confirmed |
| `status` | text CHECK | `parsing`, `ready`, `failed` |
| `parse_error` | text null | |
| `row_count`, `item_count`, `duplicate_count` | integer | For the list and the chat card |
| `created_by` | text fk `user` | |
| `created_at`, `updated_at` | timestamptz | |

`pending_tools` gains:

- `import_id` (uuid fk `bulk_imports`, set null) and `source_row` (integer, for "row 14" in
  errors);
- `lab_docs` jsonb (`{ title, url }[]`, default `[]`);
- `quantity` (integer default 1);
- `serials` (text[] default `{}`).

On approval, `quantity` and `serials` create units.

### 4.2 The setup allowance

`research_allowances(user_id, extra_items, granted_by, expires_at)`: a super admin grants,
say, +400 items for 7 days to whoever is loading the inventory. The research route adds it
to the daily 100. Every grant is audited (`allowance.granted`).

## 5. Behavior / flow

1. **`/admin/intake` → Import a list.** Choose a file, or paste. For CSV/TSV, a preview of
   the first 10 rows with suggested column matches opens; confirm the matches to continue.
2. **Parsing.** CSV takes seconds, in the request. A document shows "Reading your list…"
   and polls.
3. **Review** (`/admin/intake/imports/[id]`):
   - a table of name, brand, category, location, quantity, lab docs, duplicate status and a
     select checkbox;
   - filters: all, duplicates, needs a name, selected;
   - bulk actions: set category, set location, select all shown;
   - an optional **Suggest names** button.
4. **Research selected (N).** Queued in chunks of 25. The page shows progress per chunk and
   a clear stop when the day's allowance runs out ("37 queued; 63 wait for tomorrow's
   allowance or a setup allowance"). Nothing silently drops.
5. **After research,** items appear on `/admin/intake` as today and are approved one by
   one, or later through the refresh review's proposal cards.

**Unhappy paths:**
- **A CSV with no recognizable name column:** the mapping step asks which column holds the
  name.
- **A document that yields no items:** "No equipment found in this document", with the
  first lines shown so the admin can see why.
- **Mixed lists** (tools plus consumables like "10 boxes of screws"): the extractor marks
  likely consumables `notes: "consumable?"`, and the table offers a filter to deselect them
  before research.
- **An import abandoned halfway:** its items follow the existing 14-day expiry for
  `identified` items, and the import row stays as history.

## 6. UI

- **`/admin/intake`:** an **Import a list** button beside the queue, and an "Imports"
  section listing recent imports and their counts.
- **The import page:**
  - full-width table, virtualized above 200 rows;
  - sticky action bar (selected count, Suggest names, Research selected);
  - mobile shows one card per row, like the stacked intake table.
- **Chat:** the `data-import-card` shows the counts and a Review button.
- **Strings:** about 60 keys under `admin.import.*`, English first.

## 7. Relationship to existing work

- **Builds on** the intake pipeline: `pending_tools`, `createPendingBatch`, the duplicate
  check, the research route and limits. It also uses the guided redo and reviewer notes.
- **Uses** the Gateway model registry (Luna, flex tier) and Exa (for suggested names).
- **Shares the proposal and review approach** with refresh-research (#41), though it
  doesn't depend on it.
- **v5 only.** Blueprint may reuse `src/lib/import/*` later.

## 8. Security and safety

- **Authorization:**
  - importing, reviewing and researching need `tools.add`;
  - approving still needs `tools.approve`;
  - granting a setup allowance needs `users.manage` (super admin).
- **Untrusted input.**
  - Uploaded files are private Blob, with type and size checks (CSV/TSV/text ≤ 5 MB, PDF ≤
    20 MB).
  - Document text is fenced as data for the extractor, which has no tools and can only
    return items for a person to review.
  - Lab-doc URLs are never fetched server-side. They are validated as `http(s)` and
    rendered as links with `rel="noopener noreferrer"`.
- **Cost:**
  - parsing a document costs about a cent per 100 items;
  - suggested names about 0.8¢ per item;
  - research uses the existing allowances.

  A 400-item import researched fully is roughly $12–14 at current measured costs. Setup
  allowances are the explicit, audited way past the daily cap.
- **PII:** none expected. If a sheet has personal names in notes, they stay in notes and are
  never sent to search. Only name, brand and model go to Exa.

## 9. Phased build order

| # | Phase | Delivers |
|---|---|---|
| **1** | CSV/TSV/paste import | Parser, column mapping, `bulk_imports` + migration, pending rows with quantity/serials/lab docs, review table, chunked research, setup allowance |
| **2** | Documents and suggested names | Model extraction workflow for free text and PDF text; the Suggest names pass |
| **3** | Chat hand-off | `start_import` capability and the import card |

## 10. Testing

- **Unit:**
  - the CSV parser (quotes, embedded newlines, BOM, ragged rows);
  - header synonym matching;
  - quantity and serials into units;
  - lab-doc URL validation;
  - extractor output parsing (malformed JSON rejected, fields capped);
  - chunking;
  - allowance arithmetic.
- **Integration** (PGlite, MSW, model stubs):
  - an import creates identified pending items with `import_id` and the right batch;
  - within-import duplicates are flagged;
  - chunked research respects 25 per request and the allowance;
  - lab docs survive a research rerun and become `Lab document` resources on approval;
  - suggested-name accept re-runs the duplicate check;
  - `start_import` from chat returns the card and doesn't call `identify_tools`.
- **Component:** mapping step, review table (filters, bulk set, selection with duplicates),
  import card.
- **E2E:** paste a 12-line list, map nothing (free text), review, fix one name, deselect
  one, research the rest (stubbed), and see them on the intake page. Separately, upload a
  CSV with lab-doc links and approve one; its tool page shows the Lab document link.

**Cases that would embarrass us in production:**
- A 300-row sheet silently researches only 100.
- "Quantity 5" becomes five separate tools.
- A private Google Doc link is fetched and fails loudly on every item.
- A pasted list with a prompt-injection line creates an item nobody saw.
- Personal names from a notes column end up in a web search.

## 11. Open questions

| # | Question | Recommendation | Who |
|---|---|---|---|
| 1 | XLSX support | Not in v1; add a small, maintained parser only if CSV export proves painful | Isaac |
| 2 | Default setup allowance size and length | +400 items for 7 days, granted by a super admin | Isaac |
| 3 | Show lab documents to students or staff only? | Everyone by default; a per-link "staff only" flag later if needed | Isaac, Niti |
| 4 | Treat consumables differently? | Filter them out of research by default; a separate consumables list is a later feature | Isaac, Luis |

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited.

### 2026-09-24 — Phases 1–3 built: import, review, chunked research, documents, suggested names, chat hand-off

**Status.** Built on `v5/bulk-intake` (off `main` at `948bcd7`): all three phases of §9.
**Not built:** the two E2E scenarios of §10 — the unit, integration (PGlite), workflow and
component tiers cover the same paths offline, and the live check below ran them for real.
No import has been run on production data.

**As built, and where it differs from the text above** (choices the spec left open took the
simplest option consistent with it):

- **§4.1 migration `0013_bulk_intake`.** `bulk_imports` as specified plus three columns:
  `format` (`table` | `list` | `document` — how the text is read; `source_kind` still says
  where it came from), `source_text` (**the source text is kept on the row**: the file as
  UTF-8, the paste, or a PDF's extracted text, capped at 200,000 characters for a document —
  what makes a half-mapped import resumable and what the document workflow reads, without a
  Blob read per step) and `workflow_run_id` (diagnosis). **`status` gains `mapping`**: a
  table waits there until its columns are confirmed, then becomes `ready`; `parsing` is only
  a document being read. The uploaded file is still kept: private Blob, claimed by the import
  (`attachments.owner_type = 'bulk_import'`, a new owner). `pending_tools` gains the four
  specified columns (`import_id`, `source_row`, `lab_docs`, `quantity` with a 1–50 CHECK,
  `serials`) and three more: **`links`** (product or manual links from the list, offered at
  approval — below), **`notes`** (the list's notes — kept on the row, never sent to a search,
  §8 PII) and **`name_suggestion`** (the Suggest names answer awaiting Accept/Ignore).
  `research_allowances` as specified. `resources.origin` (`lab_document`, CHECK) is new.
- **§3.2 parsing.** `src/lib/import/`: `table.ts` (the RFC 4180 reader, delimiter sniffing —
  tab first, so pasted cells are TSV even when cells hold commas; `,` `;` `|`), `columns.ts`
  (synonyms; a header row is recognised when one cell is exactly a known header or two
  digit-free cells contain one; with no header the columns are numbered and the first wordy
  one is suggested as the name), `items.ts` (validation), `detect.ts`, `preview.ts`. A
  `.csv`/`.tsv` file is always a table; other text is a table only when tab-separated or
  headed — **a comma list with no header ("Prusa MK4, 3 units") is a list**. **A plain list is
  read by code, not a model** (`line-list.ts`): one entry a line, bullets and numbering
  dropped, "3x"/"x3"/"(3)"/"– 3 units"/"qty 3" as quantity, "SN:"/"S/N" as a serial, URLs as
  links, and a short line ending in a colon ("3D printers:") as the category hint of the lines
  under it. Only prose and PDF text go to the model. Model and name compose as the tool's
  name ("Laser cutter" + "Speedy 400" → "Laser cutter Speedy 400"; brand + model when there
  is no name); the brand stays in `brand`, where the duplicate check reads it. At most 1,000
  items an import (refused with the count, never cut).
- **§3.2 the extractor** is its own job, **`importParse`** (`MODEL_IMPORT_PARSE`, Luna,
  **flex**), not `researchRead` — the job registry names each call's purpose. No tools; each
  chunk (≈ 8,000 characters, cut at a line break) is fenced with `fenceUntrusted` and the
  system prompt says any instruction inside is data. The answer must be `{ "items": [...] }`
  JSON (a fenced block tolerated), or the chunk fails; items without a name are dropped,
  strings capped, 200 items a chunk at most. The workflow (`src/workflows/import-document.ts`)
  reads three chunks at a time; a chunk refused for good is left out and the rest are written;
  every chunk failing fails the import with the first reason; nothing named is `no_items`.
  PDF text comes from the manual extractor (`extractManual`, unpdf); a scan is refused as
  `no_text_in_pdf`.
- **§3.3 Suggest names** is job **`nameSuggest`** (`MODEL_NAME_SUGGEST`, Luna, flex): **one
  `generateText` call with Exa as its tool** (five results, highlights, no page text) — the
  Gateway runs the search inside that one request, so "one search plus one small call" is one
  request. Only name, brand and category hint reach the prompt. An unusable answer is an
  `unsure` suggestion of the original name. Workflow `src/workflows/suggest-names.ts`, five at
  a time, rows still `identified` only, at most 100 a press. **The charge** is
  `ceil(n / 4)` rows in `research_requests` with no item, counted and inserted under the same
  per-person lock as research. Accept goes through `updatePendingTool` (so the duplicate check
  re-runs); **Accept all exact** takes every `exact` suggestion on an identified row.
- **§2 duplicates within an import.** Rows are inserted one at a time and each is checked
  before its insert against the inventory, other pending items **and the rows of the import
  inserted before it** (`createPendingBatch` with `checkWithinBatch`). A renamed imported row
  is re-checked against the whole import (the chat's batch keeps excluding its own siblings).
  A row matching an earlier row of the same import offers **Merge into row N** besides
  "a different tool" and "remove": its quantity, serials and links move onto the earlier row
  (capped at 50) and it is discarded.
- **§3.4 lab documents.** A link on a Google Docs/Drive, Notion, SharePoint, OneDrive,
  Dropbox or Box host is a lab document **in any link column**, not only a "Doc" column —
  that is the private material research must never open. A column's header titles its lab
  documents after the words that only mean "link" are dropped ("SOP / Doc" → "SOP", "Past
  projects" stays, "Google Doc" gives the default "docs.google.com — Lab document"). At
  approval they become `Other` resources with `origin = 'lab_document'`; an **add-unit** item's
  lab documents join the tool it joins unless it already links them. They are excluded from
  what approval hands the manual archive, the archiver skips `lab_document`
  (`skipped: lab_document`), `listResourcesForTool` (the chat's manual attach) leaves them
  out, and `read_page` never allows their hosts. The tool page lists them first, badged *Lab
  document*, opened in a new tab with `rel="noopener noreferrer"`. Shown to everyone (open
  question 3, as recommended).
- **The list's own product/manual links** (spec §2 names the column; §4.1 had no home for
  it) are offered on the preliminary page under "From the imported list", ticked, and become
  ordinary resources on approval (`Manual` for a `.pdf`, else `Other`, titled with the host;
  `importLinkUrls`, a subset of the row's own links — anything else is `invalid_field`). They
  are never given to research (§8: only name, brand and model reach a search).
- **§2 quantity and serials.** `quantity` is at least the number of serials. Approval creates
  `max(quantity, serials)` units — "#1", "#2", … — the first with the serial the reviewer
  confirmed on the page, the rest with the remaining serials; **Add unit** adds that many
  units numbered on from the tool's. The review table edits quantity (1–50, never below the
  serials).
- **§4.2 setup allowance.** `researchLimitFor(user)` = the daily 100 + every grant still
  running, over the one rolling-24-hour ledger; the research route, **Refresh research** and
  **Find a different image** all use it. Granted from a "Setup allowances" section on
  `/admin/users` (`users.manage`; +400 for 7 days by default, 1–2,000 items, 1–30 days; the
  person must hold `tools.add` and not be banned), audited as `allowance.granted`.
- **§5 step 4 chunked research.** The browser sends the selection to the existing
  `POST /api/pending-tools/research` 25 at a time, one after the other
  (`import/research-queue.ts`), so every check that route makes is made per chunk. A
  `daily_limit` refusal carrying `remaining > 0` sends exactly that many; everything after
  waits, stays selected and is said ("N wait for tomorrow's allowance or a setup allowance").
  The route's own press limit (10 a minute) is waited out from `Retry-After`, not failed.
  Rows with an undecided duplicate or not researchable are not sent and are counted in the
  message.
- **§5/§6 the pages.** `/admin/intake` gains an "Imports" section (recent 20) and **Import a
  list** → `/admin/intake/imports/new` (file or paste). Review is
  `/admin/intake/imports/[id]` (`tools.add`, and the import is the caller's or they hold
  `tools.approve`). Filters: all, duplicates, **needs a name** (no brand and no digit in the
  name), **consumables** (the `consumable?` note — shown, never deselected automatically:
  open question 4's default filter is a filter the reviewer applies), **suggested names**,
  selected. **"Virtualized above 200 rows" is progressive rendering**: 200 rows, then 200 more
  as the end scrolls into view (or **Show more**) — no windowing library. The action bar is
  sticky; below 720 px rows stack as cards. Page actions are server actions
  (`app/admin/intake/imports/actions.ts`), each checking `tools.add` and ownership itself;
  every row id must belong to the import. Items appear on `/admin/intake` as today once
  sent to research; an imported row still `identified` is listed only on its import's page,
  so a 400-row import does not bury the queue. Approval is unchanged (Article 5).
- **§8 uploads and the route.** The one upload route gains kind **`import`** — private,
  `tools.add`, CSV/TSV/text/Markdown up to 5 MB or PDF up to 20 MB, a list's type judged by
  its extension when the browser says `application/vnd.ms-excel`, `application/octet-stream`
  or nothing. **`POST /api/imports`** starts an import (`{ text }` or `{ attachmentId }`) —
  a route rather than a server action because a pasted 5 MB list is past a server action's
  body limit; its own limiter tier `imports` (6 a minute). The attachment must be the
  caller's own upload and unclaimed. With no Blob store a text file is imported as its text
  (no copy kept); a PDF needs the store.
- **§3.5 the chat hand-off.** `start_import` (chat-only, `tools.add`) takes `attachmentId`
  or `text`, runs the same path — a table whose suggested columns name a name column is
  imported with them, otherwise the card says to match the columns — and writes
  `data-import-card` (`ImportCard`: "42 items found (3 possible duplicates) → Review
  import"). The chat's paperclip accepts list files too: they upload as kind `import`
  (a student is told only staff can import) and reach the model only as
  `[Attached documents: attachment_id=… name=…]`. The composer is one line, so a pasted
  multi-line list arrives flattened; attaching the file is the path the prompt names first.
- **Tests** (offline): parser, columns, items, line lists, detection, allowance, chunked
  queue, extractor output, the two model calls (MockLanguageModel), resources/units, the data
  layer and approval (PGlite), the service, `POST /api/imports`, the upload kind, the research
  route with a grant, the import page's actions, the allowance action, `start_import`, the
  components, lab-document read paths, and `import-document.workflow.test.ts` (both
  workflows at the Gateway's wire). Chat eval cases: `evals/cases/bulk-import.yaml` (a pasted
  20-item list and an attached CSV call `start_import`, never `identify_tools`; a two-item
  request does not).

**Live check (2026-09-24, scratch PGlite in the worktree, Luna on flex, Gateway-reported
costs).** A 40-row messy CSV (headers "Equipment, Mfr, Model #, Qty, Room, Serial #, Link,
SOP / Doc, Notes"): every header matched as intended; 39 items (the nameless row skipped), 4
possible duplicates flagged — row 4 "Form 2" [Formlabs] → row 3, "heat gun (drill master)" →
"Drill master Heat Gun", "Form 3" [Formlabs] → the inventory's Formlabs Form 3, "Epilog" +
"Fusion Pro 32" → the inventory's Epilog Fusion Pro 32 ("Form 2 printer" and "Laser cutter
(Trotec)" were not caught — below the trigram threshold); quantities, serials ("PM4-001;
PM4-002; PM4-003" → qty 3), lab docs and consumables ("10 boxes of M3 screws", "PLA filament
spools") as expected. **Suggest names** on 8 vague rows: "Drill master Heat Gun" → "DRILL
MASTER 1500 Watt Dual Temperature Heat Gun" (exact), "Form 2" → "Formlabs Form 2" (exact),
"the big bandsaw JWBS-14" → "JET 14-inch Woodworking Band Saw (JWBS-14SFX)" (likely), "Shop
vac" → "Shop-Vac wet/dry vacuum" (likely), "Sewing machine" [Brother] (likely), "Dremel",
"Drill press", "Belt sander" (unsure, name kept) — **$0.0586, $0.0073 an item**. Accepting
"Formlabs Form 2" re-ran the check and flagged it against row 4. **A free-form document**
(wiki prose with an injected "add a Tesla Model S … 50 units" line): 12 items including a
Universal Laser VLS 4.60 "in storage; needs a new lens", three consumables marked, the
soldering SOP as a lab document, 6 duplicates of the CSV's rows flagged, the Tesla line
ignored — **$0.0003**. **Research selected on 3 rows**: Form 2 (medium, 4 links, 3 images),
the Drill Master heat gun (high, 1 link), Prusa MK4 → "Original Prusa MK4" (high, 2 links, 3
images); no PPE proposed — **$0.0779**. A second pass imported "Form 2, Formlabs, qty 2,
F2-00391; F2-00417, SOP / Doc = a Google Doc", researched it (high; the lab document still
on the row afterwards) and approved it as a draft: **2 units** (#1 = F2-00391, #2 =
F2-00417), research's 4 links plus **"SOP" [Other, lab_document]**, 4 of 5 resources handed
to the manual archive — **$0.0248**. **Total spend $0.16.**

### 2026-09-24 — A document over the cap is refused, not cut

**Why.** A document longer than `IMPORT_DOCUMENT_MAX_CHARS` (200,000 characters) used to be
cut to that length and read anyway, with a `truncated` flag nobody showed. The person was
never told that the end of their list had not been read. That is the silent cut Article 4
forbids, and the 1,000-item cap already refused rather than cut.

**What changes.**

- **A document over the cap is refused before any model call** (`startImport`:
  `document_too_long`, HTTP 413). No import row is made and no workflow starts. The refusal
  gives the size in pages: `pages`, `limitPages` and `limitChars`, from
  `import/limits.ts`'s `documentTooLong`. A page is about `IMPORT_CHARS_PER_PAGE` = 3,300
  characters, so the limit is about 60 pages. `pages` is always at least the limit plus one,
  so a document just past the cap never reads "about 60 pages; the limit is about 60". The
  page reads: "This document is about 85 pages of text; the limit is about 60 pages (200,000
  characters). Split it into parts and import each." The cap stays 200,000. A document at
  the cap is read whole. `chunkDocument`'s own cap is now only a guard.
- **The 1,000-item refusal carries the count.** `too_many_items` answers `count` and `limit`
  (table, list, route and chat). The message reads: "This list has 1,240 items; the limit is
  1,000 items per import. Split it into parts and import each." The mapping step words it
  with the table's row count.
- **A document that names more than 1,000 items now fails with the count.** Before, the
  import was cut to 1,000. Now it fails as `parse_error = "too_many_items:<n>"`
  (`tooManyItemsReason`), is rendered from the new key `admin.import.failed.too_many_items`,
  and writes no rows. The extraction has already run by then, because the count is only known
  once the document has been read. With 200 items a chunk at most and 25 chunks, this can
  happen in principle but is rare.
- **The chat's `start_import`** relays the same numbers (`importErrorText`): "That document
  is about 85 pages of text; the limit is about 60 pages (200,000 characters) … Ask the person
  to split it into parts and import each."
- **Strings.** `admin.import.errors.document_too_long` is new.
  `admin.import.errors.too_many_items` is reworded to take `{count}`.
  `admin.import.failed.too_many_items` is new. All are English only, and other locales fall
  back to English.

**Tests.** `limits.test.ts` covers pages, the cap and the reason. `service.test.ts` covers
refusal before a run starts, a document at the cap read whole, and the count on a table and a
list. `imports/route.test.ts` covers the 413 bodies. `import-document.workflow.test.ts`
covers a document naming 1,200 items failing with nothing written. `intake.test.ts` covers
the chat wording. `ImportLauncher.test.tsx` and `ImportReview.test.tsx` cover the messages.
