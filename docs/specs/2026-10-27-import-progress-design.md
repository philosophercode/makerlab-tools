# Import Progress: Show the Batch Moving — Design Spec

**Date:** 2026-10-27
**Status:** Implemented (phases 1–3), with the as-built amendment below
**Target:** the app (repository root)
**Branch:** `claude/project-thread-bv63hi`
**Spec PR:** #198 · **Implementation PR:** this branch's PR

## 1. Summary

**Import a list** (bulk intake, [`2026-09-23-bulk-intake-design.md`](2026-09-23-bulk-intake-design.md))
works in silent jumps today. A table's **Continue** writes every row in one request and one
transaction; a document shows "Reading your list…" until it is done; **Research selected**
says only "chunk 2 of 4" while the chunks are sent, and then nothing while research runs.
On a 50-row sheet the person cannot tell whether the page is working, stuck or finished.

This spec makes the whole batch visible while it moves, on the import page **and** in the
chat:

- **A progress bar with stages:** *Read → Identified → Researching → Ready for approval*,
  with counts ("Identified 31 of 52").
- **The raw list stays on screen.** The file's own rows (or lines) are shown as they were
  sent, each with a marker. A row still waiting sits in a **Waiting** list; when it becomes
  an identified item it is **ticked off and leaves that list**, and the review table gains
  it. Rows that were skipped (no name, a placeholder) say why, so nothing silently drops.
- **Short status lines** say what is happening now ("Checking row 32 for duplicates",
  "Reading part 3 of 8", "Research running for 12 items, 28 queued").
- **Research keeps reporting after the send.** Rows tick from *queued* to *researching* to
  *ready for approval* (or *failed*, with Retry) without a reload.
- **The chat runs the same flow.** `start_import`'s card shows the same progress, live, and
  offers the same next step; the assistant can report progress and propose research, which
  the person confirms.

**One architecture change:** writing a table's rows moves from the request into a
**background workflow** (`importRows`), in slices, so the page can poll real progress and
the work survives a closed tab. Documents already run as a workflow; they gain progress
counters. Nothing about review, research or approval changes.

## 2. Goals / Non-goals

### Goals

- From **Import** to the last row researched, the page never sits more than one poll (3 s)
  without saying what is happening, and every stage has a count and a bar.
- The raw rows are visible during and after identification, each with its state; a row
  leaves the **Waiting** list the moment its item exists.
- Closing the tab does not stop identification. Coming back shows where it got to.
- The chat's import card shows the same progress live and links to the same page; the
  assistant can answer "how is the import going?" and propose **Research** for the rows,
  confirmed by the person.
- Upload limits are the same, and honest, on both paths (§3.5).

### Non-goals (this iteration)

- **Automatic research after identification.** Research spends the allowance; it stays a
  person's press (open question 1).
- **Approval in bulk.** Approval is unchanged and one by one (Article 5).
- **Server push (SSE / websockets).** Polling at the existing interval, only while
  something runs, is enough and fits the platform.
- **XLSX.** Still export to CSV (bulk intake §11 Q1).
- **Fixing the demo's upload failure.** The demo's "Something went wrong" on
  `demo.makerlabai.app` is a missing Blob store configuration, handled separately.

## 3. Architecture

### 3.1 Stages and where the counts come from

| Stage | Source of truth | Counted from |
|---|---|---|
| **Read** | `bulk_imports.progress` (new) | rows in the table / chunks read of a document |
| **Identified** | `pending_tools` with `import_id` | items written, skipped rows in `progress.skipped` |
| **Researching** | `pending_tools.status` | `queued` + `researching` |
| **Ready for approval** | `pending_tools.status` | `researched`; `failed` shown beside it |

Research and readiness need no new data: the existing statuses already say it. Only the
first two stages need counters, because their work happens before the rows exist.

### 3.2 `importRows` — a table's rows written in the background

Today `confirmImportMapping` → `addImportItems` writes every row in one transaction inside
the **Continue** request. New flow:

```text
Continue (or the chat's auto-confirm)
   │  validate the map (unchanged), status mapping → identifying, progress {total}
   ▼
start(importRows, [importId])            — src/workflows/import-rows.ts
   │  step per slice of 25 rows: normalize, duplicate-check, insert, progress.done += n
   │  (each slice its own transaction; earlier slices are committed, so the
   │   within-import duplicate check sees them through the import's batch_id)
   ▼
status identifying → ready, counts written (unchanged meaning)
```

- **A plain list** (read by code, `line-list.ts`) takes the same workflow, so it shows the
  same progress.
- **A document** keeps `importDocument`; its `extractImportChunk` steps add to
  `progress.chunksDone`, and `writeImportItems` writes through the same sliced writer.
- **Resumable.** A slice records the last source row it wrote. A replayed or restarted run
  starts after it, so no row is written twice.
- **Fallback.** If the workflow cannot start, the slices run in the request as today (one
  transaction per slice) and the page still shows the final counts; `start_failed` is no
  longer an outcome for tables.

### 3.3 The progress read

`imports.progress` (a read, `tools.add`, the import must be the caller's or they hold
`tools.approve` — same gate as `loadImport`):

```ts
interface ImportProgressView {
  import: ImportView;               // gains `progress` below
  stage: "reading" | "identifying" | "review" | "researching" | "done" | "failed";
  counts: {
    rows: number;                   // raw rows (or lines) in the source
    identified: number;             // items written
    skipped: number;                // rows that produced no item (with reasons in rowStates)
    queued: number; researching: number; researched: number; failed: number;
    approved: number; discarded: number;
  };
  /** Per raw row: what became of it. Only rows changed since `since` after the first call. */
  rowStates: { sourceRow: number; state: RowState; itemId: string | null; reason?: string }[];
  /** Items changed since `since`, as the review table shows them. */
  items: ImportItemView[];
  /** Pass back as `since` on the next poll. */
  cursor: string;
}
type RowState = "waiting" | "identified" | "skipped" | "merged" | "queued" | "researching" | "researched" | "failed" | "approved" | "discarded";
```

- **Incremental.** After the first call, only rows and items with `updated_at > since` are
  returned, so a 1,000-row import polled every 3 s reads a handful of rows a tick, not 1,000
  (Article 4).
- **Polled only while something runs** (stage `reading`, `identifying` or `researching`);
  it stops at `review`/`done`/`failed` and backs off to 10 s after a minute with no change.
- The page action and the chat card call the same function
  (`src/lib/import/progress.ts`); the `list_imports` capability gains the same `counts` so
  the assistant can report them.

### 3.4 The chat

- **`ImportCard` becomes live.** It renders the compact form of the same
  `ImportProgress` component: the bar, the stage line, the last few rows ticked, and
  **Review import**. It polls the progress read while the import is running, and stops when
  the chat is not visible.
- **Research from the chat.** A new action **`imports.research`** (`tools.add`,
  `assistant: "propose"`) queues the import's researchable rows (all, or the ids given)
  through the same chunked queue the page uses (§5 step 4 of bulk intake). The assistant
  proposes it ("Research 40 rows of ideal-lab-tools.csv — 40 of your 100 left today"); the
  person confirms on the existing confirmation card. The card's progress then moves into
  *Researching*. The page's **Research selected** calls the same action, so parity holds.
- **Column matching** stays a form on the page (`imports.confirm_columns` stays
  `assistant: "never"`). The chat keeps auto-confirming the suggested matches when they name
  a name column; otherwise the card says to match columns and links there.
- The prompt line for `start_import` changes from "point at Review import" to "say it is
  under way; the card shows progress; offer to research when it is identified".

### 3.5 Upload and size limits (checked 2026-10-27)

What each path allows today:

| | Import page | Chat |
|---|---|---|
| Text file (CSV, TSV, TXT, MD) | 5 MB (`IMPORT_MAX_TEXT_BYTES`) | 5 MB (same upload route, kind `import`) |
| PDF | 20 MB (`IMPORT_MAX_PDF_BYTES`) | 20 MB |
| Pasted list | 5 MB | 200,000 characters (`start_import`'s `text`), and the one-line composer flattens newlines |
| No Blob store | a text file is sent as its text instead | refused: "uploads unavailable" |
| Items / document text | 1,000 items; 200,000 characters of document text | same |

Two problems:

1. **Vercel caps a function's request body at 4.5 MB.** `POST /api/uploads` reads the
   multipart body in the function, and `POST /api/imports` takes a paste as JSON, so a
   text file or paste between 4.5 and 5 MB, and any PDF over 4.5 MB, is refused by the
   platform before our code runs, as a generic failure. The 5 MB and 20 MB limits are not
   real on the deployment.
2. **The chat has no Blob fallback** for a text list, though the page does.

Change:

- **Import uploads go browser → Blob directly** (Vercel Blob client upload, a token from
  `POST /api/uploads/token` with the same kind, permission, type and size checks), so the
  20 MB PDF and 5 MB text limits are real. Pasted text is capped at **4 MB** on both
  paths, said up front.
- **The chat falls back like the page:** with no Blob store, an attached text list is
  read in the browser and sent to `start_import` as its text, up to the same 200,000
  characters; above that the chat says to use the import page.
- **One limits module** (`src/lib/import/limits.ts`) feeds the page's hint, the chat's
  check and the routes, so the two paths cannot drift again.

A 5 KB CSV like the demo list is far below every limit; the demo failure is not a size
problem.

## 4. Data model

Migration **`0035_import_progress`** (or the next free number when it lands):

- `bulk_imports.status` gains **`identifying`** (CHECK widened): rows are being written.
- `bulk_imports.progress` **jsonb not null default `'{}'`**:

```ts
interface ImportProgress {
  total?: number;          // raw rows or lines to write
  done?: number;           // rows handled (written or skipped)
  lastRow?: number;        // the last source row a slice committed (resume point)
  chunks?: number;         // a document's chunks
  chunksDone?: number;
  skipped?: { sourceRow: number | null; reason: "no_name" | "placeholder_name" | "merged" }[];
  startedAt?: string;
}
```

- `bulk_imports.updated_at` already exists; `pending_tools.updated_at` already exists and
  drives the incremental read (index `(import_id, updated_at)` added).

Existing imports have `progress = {}` and a final status; the page derives their counts
from their items as today. No backfill.

## 5. Behavior / flow

**On the import page:**

1. **Import** (file or paste) → the import page opens at once.
2. **A table** shows the mapping step with the first rows, as today. **Continue** answers
   immediately; the page shows the **Read** stage complete and **Identifying 0 of 52**.
3. **While identifying:** the bar fills slice by slice; the **Waiting** list shows the raw
   rows not yet written; each written row is ticked and leaves it, and appears in the
   review table below. A skipped row is shown struck through with its reason ("no name").
   Rows the duplicate check flags show "possible duplicate of …" as they arrive.
4. **Done identifying:** "52 rows → 50 items, 2 skipped, 3 possible duplicates". The
   review table is fully usable; editing is allowed as soon as a row exists.
5. **Research selected (N)** → the bar's *Researching* segment grows as chunks are queued
   (as today), then keeps moving as research runs: each row ticks to *Ready for approval*
   with a link to its intake page, or *Failed* with **Retry**. A daily-limit stop says how
   many wait, as today.
6. **A document** shows "Reading part 3 of 8 — 41 items found so far" while it is read,
   then the same identifying and research stages.

**In the chat:**

1. The person attaches the CSV (or pastes a long list). The assistant calls `start_import`;
   the card appears, already moving: "ideal-lab-tools.csv — Identifying 12 of 52".
2. The assistant says one line: it is under way, the card shows progress.
3. When identified, the card reads "50 items, 3 possible duplicates" with **Review import**;
   the assistant offers to research them. On "yes", it proposes `imports.research`; the
   person confirms; the card moves into *Researching*.
4. "How's it going?" → the assistant reads `list_imports` (now with counts) and answers.

**Unhappy paths:**

- **The tab closes mid-way:** the workflow carries on; reopening shows the current stage.
- **A slice fails** (database error): the workflow retries the step; if it fails for good
  the import is `failed` with the rows written so far kept and the reason shown, and
  **Resume** restarts from `lastRow`.
- **Polling fails:** the last state stays on screen with "Reconnecting…"; the next good
  poll catches up through the cursor.
- **Research fails for a row:** shown on that row, the rest continue (unchanged research
  behavior).
- **Too many items / too long:** refused up front as today, with the count.

## 6. UI

- **New `ImportProgress`** (`src/components/admin/ImportProgress.tsx`), two densities:
  - **full** (import page, above the review table): a segmented bar (identified / researching
    / ready / failed over the total rows), a `role="status"` line that is the only live
    region (polite, announces stage changes, not every tick), and a collapsible **Source**
    panel — the raw rows in monospace, a header row, each row with a marker (○ waiting,
    ✓ identified, – skipped + reason, ↻ researching, ● ready, ✕ failed). Waiting rows are
    listed first; done rows collapse into "Done (38)" which expands.
  - **compact** (chat card): the bar, the stage line, the last three rows that changed,
    **Review import**.
- **Mobile:** the Source panel is collapsed by default; the bar and line stay.
- **Reduced motion:** the bar does not animate width changes.
- **Strings:** about 25 keys under `admin.import.progress.*` and `chat.importCard.*`,
  English first, other locales fall back (Article 6).

## 7. Relationship to existing work

- **Extends** bulk intake (phases 1–3, built): the mapping step, `addImportItems`,
  `importDocument`, the chunked research queue and `start_import`.
- **Uses** the Workflow SDK pattern of `importDocument` and `researchBatch`, and the
  assistant–GUI parity action layer (`imports.research` as a new `defineAction`).
- **Independent of** the demo's Blob configuration fix (separate work).

## 8. Security and safety

- **Authorization:** the progress read and `imports.research` require `tools.add` and the
  import to be the caller's (or `tools.approve`), exactly as the existing import actions;
  research keeps the research route's own checks per chunk (allowance, press limit).
- **Rate limiting:** the progress read is a server action behind the admin gate; polling is
  bounded (only while running, 3 s then 10 s, cursor reads). The upload token route uses
  the upload route's own limit (15 a minute per person) before issuing a token.
- **Write safety:** nothing new publishes. Research still needs a person's press or a
  confirmed proposal; approval is unchanged (Article 5).
- **Untrusted input:** raw rows are shown as text (no HTML, no links made from cells
  except the existing validated `http(s)` links). In the chat, row text stays fenced as
  untrusted in `list_imports`; the card renders it as text and never feeds it to the
  model.
- **Client uploads:** the token is scoped to one pathname prefix, content types and max
  size; the attachment is recorded by the completion callback, private, owned by the
  uploader, unclaimed — `startImport`'s ownership check is unchanged.
- **PII:** none new. Notes still never reach a search.

## 9. Phased build order

| # | Phase | Delivers |
|---|---|---|
| **1** | Progress on the page | Migration, `importRows` workflow with slices and resume, document chunk counters, the progress read, `ImportProgress` (full) with the Source panel, research progress after the send |
| **2** | The chat | Live `ImportCard`, `imports.research` (propose), `list_imports` counts, prompt change |
| **3** | Limits | Client uploads for kind `import`, 4 MB paste cap, the chat's text fallback, one limits module |

Each phase leaves `main` deployable; 2 and 3 can proceed in parallel after 1.

## 10. Testing

- **Unit:** slicing and resume (`lastRow`), stage derivation from counts, row-state
  derivation (written, skipped, merged, research statuses), the incremental cursor, the
  limits module (paste cap, page vs chat agree).
- **Integration (PGlite):** a 60-row table writes in three slices with progress after each;
  a duplicate in slice 3 of a row in slice 1 is flagged; a restarted run writes no row
  twice; the progress read returns only changed rows after the first call and refuses
  another person's import; `imports.research` queues in chunks of 25 and stops at the
  allowance with the waiting count.
- **Workflow:** `importRows` at the step boundary (as `import-document.workflow.test.ts`).
- **Component:** `ImportProgress` full and compact — waiting rows leave the list as they are
  identified, skipped rows show their reason, the bar's segments, the live region announces
  stage changes only; `ImportCard` polls while running and stops when done.
- **E2E:** upload a 30-row CSV, Continue, watch the Waiting list empty and the bar reach
  *Identified 30 of 30*, research 5 (stubbed), see them tick to *Ready for approval*.
- **Eval:** `evals/cases/bulk-import.yaml` gains "attached CSV, then 'research them'" →
  `start_import`, then a proposal of `imports.research`.

**Cases that would embarrass us:**
- The bar reaches 100% while rows are still waiting, or a skipped row disappears without a
  reason.
- A closed tab leaves an import stuck in `identifying` forever.
- A resumed run writes a row twice.
- Polling hammers the database on a 1,000-row import, or never stops.
- The chat researches without the person confirming.

## 11. Open questions

| # | Question | Recommendation | Who |
|---|---|---|---|
| 1 | Offer "Research every row once identified" as an opt-in at import time? | Not now; the chat's propose-and-confirm covers "keep it moving" without spending by default. Revisit after the demo import | Isaac |
| 2 | Slice size | 25 rows (matches research chunks); tune after a 500-row test | Implementer |
| 3 | Keep the Source panel open by default on desktop? | Open while identifying, collapsed once review starts | Isaac |

## Amendment 2026-10-27 — as built

Written by AI while building phases 1–3. Where the build differs from the text above:

- **The first slice is written inline.** `writeRows` (`lib/import/service.ts`) writes the
  first 25 rows in the request that starts or confirms the import, so the page opens on
  rows already identified, then starts `importRows` for the rest. If the workflow cannot
  start, the remaining slices are written inline; an import never waits on a run that
  never began.
- **The page's Research selected is unchanged.** It keeps its client-side queue of chunks
  over `pending.research`. `imports.research` (`research_import`, spend, `tools.add`,
  proposed, MCP never) is the assistant's door, wrapped by `researchImport` for parity;
  both start research through the same `startResearch`.
- **Counts are derived in the browser** from the merged rows (`lib/import/progress.ts`);
  the progress read returns the import and the rows changed since its cursor (now − 30 s,
  so a row committed during the read is not missed).
- **Direct uploads use the browser for completion, not Blob's webhook.** The flow is
  three calls to `POST /api/uploads/token`: `import.folder` (the caller's own prefix,
  `uploads/import/<user id>/`), the SDK's token request (folder, type and size checked;
  Blob enforces size and type in the token), and `import.complete` (the route `head`s
  the blob, checks folder and size, and records the attachment once — a second
  completion returns the first row). A webhook cannot reach a laptop and the page needs
  the id at once. Only files over 4 MB take this path; smaller ones still go through
  `POST /api/uploads`. A store that cannot sign (a private store linked by id alone, or
  the local folder) answers 501 and the browser falls back to `POST /api/uploads`.
  **Known gap:** a direct upload the browser never completes leaves a blob with no row;
  the unclaimed sweep only deletes files that have a row.
- **The chat's no-Blob fallback starts the import from the browser.** An attached text list
  is read in the browser and sent to `POST /api/imports` with `origin: "chat"` (the
  chat's auto-confirmed columns), and the message names it as `[Started imports:
  import_id=... name=...]`. `start_import` gains `importId` to show that import's card,
  for whoever may work it. The model never retypes a list's text. A PDF still needs the
  store; a text list over 200,000 characters is sent to the import page.
- **Paste cap:** 4 MB on the page (checked before sending) and on `POST /api/imports`
  (`too_large`, with `limitBytes`).
- **E2E** for the Waiting list was not added in this PR; the component and integration
  tests cover the same transitions.

