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
