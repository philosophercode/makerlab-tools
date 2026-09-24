# Manual Text and Search: Read Manuals by Page — Design Spec

**Date:** 2026-09-23
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/manual-search-spec`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

The app already keeps a copy of each tool's manual PDF in Blob (`lib/manuals/archive.ts`),
so a manual survives the manufacturer moving it. Nothing reads that copy as text:

- **Chat** attaches up to 3 whole PDFs to the conversation (`MAX_PDFS_PER_CHAT`). A
  200-page manual is tens of thousands of tokens on every turn, answers can't say which
  page they came from, and a manual larger than the model's file limit is skipped.
- **Research** now reads manuals as text (amendment "Manuals as text and flex tier"), but
  only when Exa happened to capture that text. A manual PDF without Exa text is skipped.

This spec **processes a manual when it is saved**:

1. **Extract** its text page by page, plus the chapter outline the PDF carries.
2. **Store** the pages and outline beside the archived copy.
3. **Split** it into passages that keep their chapter and page numbers, and index each
   passage twice: **full-text search** (exact words, part numbers, error codes) and a
   **vector embedding** (meaning: "how do I clean it" finds "Maintenance › Wiping the
   build plate").
4. **Search** both together and hand the model the few best passages, each labelled with
   its page: *"Replacing the resin tank — Form 4 manual, p. 42"*, linking to that page of
   the stored PDF.

Chat gets a `search_manual` tool in place of whole-PDF attachments. Research reads the
stored text of a manual it already has. The whole thing is cheap: embedding a 200-page
manual costs about a fifth of a cent, once.

## 2. Goals / Non-goals

### Goals

- Every archived manual PDF with a text layer has its **pages, outline and indexed
  passages** stored, processed on save and by a one-time backfill.
- Chat answers manual questions from **retrieved passages with page citations**, links to
  `…/manual.pdf#page=N`, and stops attaching whole PDFs when text exists.
- **Hybrid retrieval** (full text + vectors, fused) scoped to one tool's manuals, or across
  all manuals for "which machine can…" questions.
- Research uses a tool's stored manual text on refresh, and extracts a newly found manual
  PDF itself instead of depending on Exa's copy.
- Staff-uploaded PDFs on a resource (SOPs, lab guides) go through the same pipeline and
  are searchable, respecting the file's access.
- Works identically on PGlite (local, tests) and Neon (production).

### Non-goals (this iteration)

- **OCR of scanned manuals.** A PDF with no text layer is marked `no_text` and keeps
  today's behaviour (attached as a file). OCR is phase 3.
- **Table reconstruction.** Tables come out as their text in reading order. Good enough for
  retrieval; a spec table is still read correctly by the model in most manuals.
- **Model-rewritten text.** No LLM "cleans up" the extracted text. What is stored is what
  the PDF says, so a citation is always checkable.
- **Non-PDF manuals** (HTML manual pages). They stay links; research already reads them as
  pages.
- **A reranker.** Measure retrieval first (§10); add `cohere/rerank-v4-fast` only if the eval
  shows misses a reranker would fix.

## 3. Architecture

### 3.1 The pipeline

```
archiveManual(resource)            (existing: download → Blob → attachments row)
        │
        ▼
indexDocument(attachment)          (new workflow step, same workflow)
   1. read the bytes back from Blob
   2. extract   → pages[] + outline[]            (unpdf, deterministic)
   3. classify  → ready | no_text | failed
   4. chunk     → passages with section path + page range
   5. embed     → one Gateway call per ≤ 96 passages  (job `embed`)
   6. write     → manual_documents, manual_pages, manual_chunks  (one transaction)
```

- It runs as a **workflow step after `archiveManualStep`**, so the daily cron and approval
  both trigger it, retries are the workflow's, and a failure never blocks archiving.
- **Idempotent:** keyed on the attachment id plus `extractor_version` and
  `embedding_model`. A re-run with the same versions is a no-op; bumping either
  re-processes (that is how a better chunker or a new embedding model rolls out).
- Staff-uploaded PDF resources call the same step when their attachment is saved.

### 3.2 Extraction

**`unpdf`** (Mozilla's pdf.js packaged for serverless; no native binaries, runs on Vercel
Functions and in Node scripts):

- **Pages:** `extractText(pdf, { mergePages: false })` gives one string per page. Lines are
  rebuilt from the text items' positions, hyphenation at line ends is joined, and repeated
  running headers and footers (the same line on most pages) are dropped.
- **Outline:** `pdf.getOutline()` gives the bookmark tree; each entry's destination resolves
  to a page number. Stored as `{ title, page, level }[]`.
- **No outline?** Headings are inferred from font size: text items clearly larger than the
  page's body text, on their own line, become level-1/2 headings. Marked
  `outline_source = 'inferred'` so it can be told apart from the PDF's own.
- **Printed vs physical page numbers:** citations use the PDF's page index (what
  `#page=N` opens). If the PDF has page labels (`getPageLabels()`, e.g. "iv", "3-12"), the
  label is stored per page and shown alongside: *"p. 42 (printed 3-12)"*.
- **Classification:** `no_text` when the average page has under 100 characters of text
  (a scan); `failed` on an encrypted or corrupt file. Both are recorded with a reason.
- Limits: 25 MB (the archive limit), 1,000 pages, 60 s. Beyond them: `failed`, reason
  `too_large`.

### 3.3 Chunking

Passages are built **inside sections**, never across a chapter boundary:

- Target ~600 tokens (≈ 2,400 characters), 80-token overlap, split on paragraph, then
  sentence boundaries.
- Each passage records `page_start`, `page_end`, and `section_path`
  (`["Maintenance", "Resin tank", "Replacing the tank"]`).
- **Contextual header:** the text that is embedded and full-text indexed is prefixed with
  `"<tool name> — <document title> › <section path>"`. That cheap header is what lets
  "how do I change the tank on the Form 4" match a passage whose own text never says
  "Form 4". The stored `content` is the passage alone, for display.

### 3.4 Embeddings

- New job **`embed`** in `lib/ai/models.ts`: **`openai/text-embedding-3-small`** through the
  Gateway, `dimensions: 512`, override `MODEL_EMBED`.
  - Chosen for Cornell (OpenAI, same as Luna), price ($0.02 / M tokens) and because it can
    be shortened to 512 dimensions with little quality loss, which keeps storage small.
  - The dimension is fixed in the schema. Changing model or dimension means bumping
    `embedding_model` and re-embedding (§3.1), which costs cents.
- Queries are embedded the same way at search time (~10 tokens, a negligible cost).

### 3.5 Retrieval

`searchManuals({ query, toolIds?, limit = 8, viewer })` in `lib/manuals/search.ts`:

1. **Full text:** `websearch_to_tsquery('english', query)` against a generated `tsvector`
   (GIN index), plus an exact match on part-number-like tokens (`E-302`, `3401-038`).
2. **Vector:** cosine distance on `embedding` (HNSW index), top 30.
3. **Fuse** with reciprocal rank fusion (k = 60), take the top `limit`.
4. **Expand:** merge adjacent passages from the same section so the model gets a readable
   span, not fragments.
5. Filter by the attachment's access for the viewer (§8).

Returns passages with `toolName`, `documentTitle`, `sectionPath`, `pageStart/End`,
`pageLabel`, `content` and `pdfUrl#page=N`.

### 3.6 Chat

- New capability tool **`search_manual({ query, tool? })`**. On a tool's page the tool is
  preset; from the general assistant the model may name one or search all.
- **Table of contents in context:** on a tool page, the system prompt gets that tool's
  manual outline (titles and pages, typically 1–2k tokens), so the model knows what the
  manual covers before searching and can answer "is there a section on…" directly.
- Answers cite pages as links: *"Replacing the resin tank (Form 4 manual, p. 42)"*. The
  prompt says: answer from passages, cite the page, say when the manual doesn't cover it.
- **Whole-PDF attachment stays only as fallback** for manuals that are `no_text`, `failed`
  or not yet processed. `MAX_PDFS_PER_CHAT` applies only to those.

### 3.7 Research

- **Refresh research** (spec 2026-09-23-refresh-research) of a tool with a processed manual
  gives the read step the manual's outline plus the passages retrieved for a fixed set of
  queries ("specifications", "technical data", "dimensions", "materials", "getting
  started", "safety warnings" — the last only as context; PPE is still never proposed),
  within the existing 16,000-character manual budget.
- **New tools:** when the search finds a manual PDF, research downloads it (through the SSRF
  guard), extracts text in memory with the same extractor, and uses its outline plus the
  pages richest in spec-like lines. Nothing is stored at this point; the manual is
  processed for real when it is archived after approval.
- This replaces the "manual PDF with no Exa text is skipped" gap from the manuals-as-text
  amendment.

## 4. Data model

Migration `0010_manual_text` (next free number at build time):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE manual_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
  tool_id uuid REFERENCES tools(id) ON DELETE CASCADE,       -- denormalised for scoping
  title text NOT NULL,
  status text NOT NULL,              -- ready | no_text | failed
  status_reason text,
  page_count integer,
  outline jsonb NOT NULL DEFAULT '[]',   -- [{ title, page, level }]
  outline_source text,               -- pdf | inferred | none
  extractor_version text NOT NULL,
  embedding_model text,              -- e.g. openai/text-embedding-3-small@512
  processed_at timestamptz NOT NULL,
  created_at, updated_at
);

CREATE TABLE manual_pages (
  document_id uuid NOT NULL REFERENCES manual_documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL,      -- 1-based PDF index
  page_label text,                   -- printed label, when the PDF has one
  text text NOT NULL,
  PRIMARY KEY (document_id, page_number)
);

CREATE TABLE manual_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES manual_documents(id) ON DELETE CASCADE,
  tool_id uuid,                      -- copied from the document, for filtering
  ordinal integer NOT NULL,
  section_path text[] NOT NULL DEFAULT '{}',
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  content text NOT NULL,
  search_text text NOT NULL,         -- contextual header + content
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding vector(512)
);
CREATE INDEX manual_chunks_tsv_idx ON manual_chunks USING gin (tsv);
CREATE INDEX manual_chunks_embedding_idx ON manual_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX manual_chunks_tool_idx ON manual_chunks (tool_id);
```

- **PGlite:** add the `vector` extension from `@electric-sql/pglite-pgvector` in
  `lib/db/pglite.ts` (and the test factory). **Neon:** pgvector is built in; the migration's
  `CREATE EXTENSION` is enough.
- **Size:** a 200-page manual ≈ 300 passages. At 512 float dimensions that is ~2 KB of vector
  plus ~3 KB of text per passage, about 1.5 MB per manual with its pages. 100 manuals ≈ 150
  MB, inside Neon's free 0.5 GB but worth watching; `halfvec(512)` halves the vector part if
  needed.

## 5. Behavior / flow

- **Approval / daily cron:** archive → index. A manual shows its state in the tool editor's
  resource row: *Searchable · 212 pages*, *No text (scanned)*, *Failed: encrypted*, or
  *Processing*.
- **Resource URL changes or the file is replaced:** the attachment changes, the old document
  cascades away, the new one is processed.
- **Tool archived:** its documents stay (the attachment stays) but search excludes archived
  tools.
- **Backfill:** `npm run manuals:index [--dry-run] [--ids …] [--limit N]`, same shape as the
  starter-question backfill. It prints pages, passages, tokens and the Gateway-reported cost.
- **Admin:** a *Re-process* action on the resource row, and on `/admin/research` a count of
  manuals by state.

## 6. UI

- **Chat:** citations render as links with the page (`p. 42`), opening the stored PDF at that
  page in a new tab. No new chat components beyond the tool-call status line ("Searching
  the Form 4 manual…").
- **Tool page:** the Manual resource shows *Searchable* and, when an outline exists, a
  collapsible **Contents** list linking to each chapter's page. Cheap and useful even without
  chat.
- **Editor:** processing state and *Re-process* (§5). All strings through next-intl
  (Article 6).

## 7. Relationship to existing work

- **Gateway spec** §3.4 (manuals in chat): superseded for processed manuals; the PDF
  attachment remains the fallback.
- **Manuals as text and flex tier amendment:** research's manual text now comes from our own
  extraction first, Exa's copy second.
- **Refresh research (#41):** consumes stored manual text (§3.7).
- **MCP (#42):** expose `search_manual` as a read tool with the same access rules.
- **Bulk intake (#43):** unaffected; imported tools get manuals through research as usual.

## 8. Security and safety

- **Manual text is untrusted.** Passages go to models inside the existing
  `<untrusted-page>` fence, labelled with document and page; the chat and research prompts
  already treat fenced text as data.
- **Access:** a document inherits its attachment's `access`. `private` files (staff SOPs)
  are searchable only by signed-in lab staff; students and anonymous chat see only public
  documents. The filter is in the SQL, not after it.
- **Downloads** for research go through `guardedFetch` (SSRF guard), same limits as archiving.
- **PDF parsing** runs pdf.js with scripting disabled (`isEvalSupported: false`), a page cap
  and a time cap, so a hostile PDF can cost at most one failed step.
- **Nothing logged beyond ids, counts and hosts.**

## 9. Phased build order

1. **Extract and store** (no vectors): `unpdf`, migration without `manual_chunks`, the index
   step after archiving, backfill, editor state, research uses stored/extracted text. Chat
   unchanged. Ships value on its own (research gap closed, tool page Contents).
2. **Search:** pgvector (+ PGlite extension), `manual_chunks`, `embed` job, hybrid search,
   `search_manual` in chat with page citations, outline in the tool-page prompt, whole-PDF
   attachment demoted to fallback. Retrieval eval (§10) gates it.
3. **Later, if the eval asks for it:** reranker, OCR for `no_text` manuals (a vision model
   page by page, or a dedicated OCR service), `halfvec`.

## 10. Testing

- **Extraction:** fixture PDFs committed under `v5/test/fixtures/manuals/` (small, generated
  or openly licensed): one with an outline, one without (inferred headings), one with page
  labels, one scanned image-only, one encrypted. Assert pages, outline, labels, status.
- **Chunking:** passages never cross sections, page ranges are right, overlap holds,
  headers/footers removed.
- **Search:** PGlite with pgvector, a fake embedding model with fixed vectors; fusion order,
  tool scoping, access filtering (a private SOP never reaches an anonymous search).
- **Retrieval eval (live, `.livecheck`):** 3 real manuals (Form 4, X2D, Carvera), 30
  hand-written questions each with the expected page. Report recall@8 and cost. Gate for
  phase 2: recall@8 ≥ 0.85.
- **Chat evals** (`evals/cases/`): "how do I replace the resin tank on the Form 4" must call
  `search_manual` and cite a page; a question the manual doesn't cover must say so.
- **Workflow:** archive → index runs once, retries on a transient Blob error, `no_text`
  doesn't retry.

## 11. Open questions

- **Embedding model:** `openai/text-embedding-3-small@512` (proposed) vs
  `voyage/voyage-4-lite` (same price, retrieval-tuned). The retrieval eval can run both for
  under 5¢; default to OpenAI unless Voyage is clearly better.
- **Neon plan:** confirm the storage allowance before the backfill runs in production.
- **Cross-tool search in the general assistant:** on by default, or only when the student
  names a tool?
- **OCR:** how many archived manuals are scans? The backfill's `no_text` count answers it.

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited.

### 2026-09-23 — Phase 1 built: extract and store (§3.1, §3.2, §3.7, §4, §5, §6, §9, §10)

**Status.** §9 phase 1 is built on `v5/gateway-images` (uncommitted): `unpdf` 1.8.1, migration
`0010_manual_text`, the index step, the backfill, the editor state, the tool page's Contents and
research's use of stored/extracted text. **Not built (phase 2):** the `vector` extension,
`manual_chunks`, the `embed` job, hybrid search, chat's `search_manual`, the outline in the chat
prompt, demoting chat's PDF attachment. Chat is unchanged.

**As built, and where it differs from the text above:**

- **§4 data model.** `manual_documents` and `manual_pages` exactly as written (including the
  unused, nullable `embedding_model`), minus `CREATE EXTENSION vector` and `manual_chunks`. Status
  and outline source are `text` columns with named CHECKs from `MANUAL_DOCUMENT_STATUS` /
  `MANUAL_OUTLINE_SOURCE` in `vocabulary.ts` (the `inListCheck` convention), plus an index on
  `tool_id` and the `updated_at` trigger (hand-appended, as in 0007). **"Processing" is not a
  stored status**: it is a current PDF with no document row yet.
- **§3.1 per resource, not per attachment.** The step is `indexManualStep(resourceId)`, run by
  `archiveManuals` after every archive that did not fail (including `already_archived`,
  `has_file` and `no_url`), and it processes every *current* PDF of the resource: the archive of
  the link the resource carries now, or any uploaded/imported file. That one rule covers
  staff-uploaded PDFs: adding a resource with an uploaded file now starts the same workflow
  (`resource-actions.ts`), where the archive skips (`has_file`/`no_url`) and the index step reads
  the upload — private files too, through `@vercel/blob` `get` with the token. There is no
  "replace the file" action in the editor today, so the file-replacement case of §5 only arises
  through a link change (new attachment → new document; the stale copy is never processed).
- **§3.1 retries.** Only a transient Blob read or an unreachable database is retried
  (`RetryableError`); `no_text` and `failed` are stored and never retried; a missing blob is a
  non-transient failure with nothing stored. The index step's outcome is counted apart
  (`indexed`, `indexFailed`) and never changes the archive's counts.
- **Idempotency** is `attachment_id` + `EXTRACTOR_VERSION` (`unpdf-1/extract-2`). A re-process
  upserts the document in place and replaces its pages in the same transaction.
- **§3.2 extraction details added while testing on 15 real manuals** (the lab's SOP/manual PDFs,
  archived into a scratch copy of the local database: 14 ready, 1 no_text, 781 pages, 2.6 s):
  - pdf.js here runs without a worker and does not yield to timers, so the 60 s cap is enforced
    by a **deadline checked between pages** (and a yield every 10 pages), not only a timer.
  - Lines are rebuilt in content order (an EOL mark or a baseline move ends a line); running
    headers/footers are lines among a page's first or last two that repeat — digits ignored — on
    at least half the pages (minimum three); **bare page numbers** ("12", "- ii -") at a page's
    edges are dropped too; runs of dot leaders collapse to "…". These are formatting only.
  - **Identifier bookmarks** (one word with an underscore — Google Docs anchors like `_tyjcwt`,
    file names like `P322_681_eng`) are dropped, and when they are most of the outline it is
    discarded and headings are inferred instead (both Formlabs manuals needed this).
  - **Inferred headings**: lines ≥ 1.2× the body size, ≥ 3 letters, ≤ 100 chars and 12 words,
    not ending like a sentence; consecutive same-size lines are one heading; sizes are kept
    largest-first within 1.5 headings a page; levels come from sizes used more than once, so a
    cover title does not push the chapters down (level 3 exists but is not shown). Inference is
    still imperfect on multilingual and scanned-then-OCR'd manuals — noted, not fixed.
  - `isEvalSupported: false` is passed, but unpdf's serverless pdf.js build contains no eval
    path at all.
- **§3.7 research.** Phase 1 has no passage search, so the "fixed set of queries" is replaced by
  `manualDigest` (`manuals/digest.ts`): the outline (≤ 25% of the budget, levels 1–2), then the
  pages with the most spec-like lines (a number with a unit, dimensions, "Label: 12…"), with the
  opening page of a "Specifications / Technical data" chapter favoured, shown in page order,
  each headed `[page N (printed L)]`, within `RESEARCH_MANUAL_TEXT_MAX_CHARS` (16,000).
  - **Our extraction first, Exa second**: the read step looks each target URL up in the stored
    text (`findStoredManualByUrl` — by `attachments.source_url` or `public_url`; a hit is not
    downloaded), else extracts a downloaded PDF in memory (30 s), else uses Exa's copy as before.
    The fence says which (`manualSource: stored | pdf | search`).
  - **Refresh research does not exist yet** (spec #41 is not built). `findStoredManualForTool`
    is its entry point; today the stored text reaches research through the URL lookup, which
    also covers a new tool whose manual another tool already holds.
  - Research now reads a PDF up to the archive's **25 MB** (`readPage`'s new `maxPdfBytes`
    option; chat's `read_page` keeps 10 MB) with a 30 s budget for a `.pdf` URL.
  - **A manual PDF Exa returned but the search did not list** is now read
    (`research/manual-pdfs.ts`): Exa results whose URL is a `.pdf` and whose captured text names
    the model (a model word like "x2d", else the brand) cross to the read step with their text,
    and one takes a read slot when none of the chosen pages is a PDF (after the product page; a
    video first gives way). This is the X2D `csm.bblcdn.cn` case.
- **§5 / §6 UI.** The editor row says **"Text stored · N pages"**, not "Searchable" — nothing is
  searchable until phase 2. No **Re-process** action and no `/admin/research` counts yet
  (`npm run manuals:index -- --force --ids …` re-processes). The tool page's **Contents** is a
  native `<details>` under a public, published manual's link, levels 1–2, at most 60 entries,
  each `<pdf>#page=N` in a new tab; it is cached with the catalogue, so a manual processed after
  a page was cached shows its Contents when that cache turns over (step code cannot call
  `revalidateTag`). English strings only (`messages/en.json`); other locales fall back.
- **Backfill** (`scripts/index-manuals.ts`) adds `--force`. It prints no cost line: phase 1 makes
  no Gateway calls. The nightly cron is unchanged: it archives due manuals (and so indexes them);
  manuals archived before this change are reached by the backfill, not the cron.
- **§8 access.** The tool page lists only public files on published resources; the research URL
  lookup cannot match a private upload (it has neither `public_url` nor `source_url`);
  `findStoredManualForTool` does include private documents — it is for staff-only background
  research.
- **§10 tests.** Fixture PDFs are generated without a dependency (`test/fixtures/manuals/
  build-pdf.ts`, `fixtures.ts`, `generate.ts`; a test checks the committed files match):
  outline, no outline (inferred), page labels, scanned (image only), encrypted (a Standard
  `/Encrypt` dictionary with a non-empty user password) and corrupt. Unit tests cover the
  extractor, digest, index step, data readers, backfill, research integration and both UI pieces;
  `archive-manuals.workflow.test.ts` runs archive → index once in the real step bundle.

**Live checks (2026-09-23).** Local database: **0** stored PDFs (the imported data has two
Manual resources and no archived copies), so `manuals:index --dry-run` and the real run were
no-ops (0.6–0.7 s). The 15-manual figures above come from a scratch copy. X2D: the live
`x2d.ts` search did not return a manual PDF this time, and `csm.bblcdn.cn` is unreachable from
this network (connection timeout), so the X2D manual could not be extracted here; Exa's copy
remains the fallback there. Form 4 (`.livecheck/x2d-manual.ts form4`): the manual PDF was read,
extracted (outline of 16 chapters plus spec-rich pages, 15.8k chars) and given as text; read
cost $0.0011 (flex), `manualFound` true, 28 specs.

### 2026-09-23 — Phase 2 built: search (§3.3–3.6, §4, §5, §6, §9, §10, §11)

**Status.** §9 phase 2 is built on `v5/manual-search`: pgvector, `manual_chunks`, the `embed`
job, hybrid search, `search_manual` in chat with page citations, the outline in the tool-page
prompt, whole-PDF attachment demoted to fallback, Re-process and `/admin/research` counts.
The retrieval gate (§10, hybrid recall@8 ≥ 0.85) **passes**: 0.97 with the default model.

**As built, and where it differs from the text above:**

- **§4 data model.** Migration **`0011_manual_chunks`** (0010 was phase 1): `CREATE EXTENSION
  IF NOT EXISTS vector` (hand-prepended — drizzle-kit does not generate it) and `manual_chunks`
  exactly as written, plus an index on `(document_id, ordinal)` for the rebuild and merge
  reads, plus **`manual_documents.chunker_version`** beside the existing `embedding_model`.
  Drizzle has no `tsvector` type; the column is a `customType` with `generatedAlwaysAs`.
  PGlite loads `@electric-sql/pglite-pgvector` 0.0.9 (the one package added) in every
  instance — `PGLITE_EXTENSIONS` in `db/pglite.ts`, which the tests' `createPgliteDb` and the
  scripts use too — and it is in `serverExternalPackages` for the same reason as PGlite.
- **§3.1 idempotency.** Passages are keyed on `CHUNKER_VERSION` (`chunk-2`) and the embedding
  model key (`openai/text-embedding-3-small@512`), both written in the same transaction as
  the passages; either differing makes the document stale. Re-extracting a document (a new
  `EXTRACTOR_VERSION`, `--force`) deletes its passages and clears both versions in the text
  transaction, so passages are never older than their pages. **Text first, passages second,
  as two transactions**: embedding happens outside any transaction (a Gateway call must not
  hold one open), and an embedding failure leaves the stored text intact. Transient embedding
  failures (429, 5xx, timeout, no answer) make `indexManualStep` throw a `RetryableError`; on
  the retry the text is skipped (already at this version) and only the embedding is redone.
  Auth, an unknown model and a wrong vector length are not retried. The archive's counts are
  untouched; the run adds `passagesBuilt` / `passagesFailed`.
- **§3.3 chunking.** As written (~2,400 characters, ~320 characters of overlap, paragraph →
  sentence → word splits, never across a section, pages recorded, contextual header on
  `search_text` only). Additions found necessary on real manuals:
  - Extracted text has no blank lines, so a "paragraph" is a run of lines ending at a sentence
    end, a blank line or a page break.
  - **Numbered headings the outline lacks become subsections** ("2.2 Technical
    specifications", "3.1.4 Radio interference" — two or more number parts, a capitalised
    title of ≥ 2 words, no trailing page number). The Form 4 PDF has no usable bookmarks and
    its inferred outline is 16 chapters; without this every passage of "2. Introduction"
    shared one header and the spec table was hard to retrieve. This alone took Form 4's vector
    recall from 0.77 to 0.87 (`chunk-1` → `chunk-2`).
  - The overlap is an exact suffix of the previous passage, so search can merge adjacent
    passages without repeating the seam.
- **§3.4 embeddings.** Job `embed` is an **embedding** job in `MODEL_JOBS` (`kind:
  "embedding"`, `embeddingModelFor`, never `languageModelFor`; `LanguageJob` now excludes it).
  The dimension is asked for through the Gateway's provider options (`openai.dimensions`,
  `voyage.outputDimension`) and **checked**: a vector that is not 512 long is an error before
  the insert. `MODEL_EMBED_TIER` exists (the registry's shape) but embedding calls send no
  tier. ≤ 96 inputs per call, one call at a time; cost is `providerMetadata.gateway.cost`.
- **§3.5 retrieval — the lexical list is idf-weighted, not `ts_rank_cd` of the whole query.**
  `websearch_to_tsquery('english', q)` is still the parser, but its AND semantics matched
  almost nothing for a natural question, and OR-ing its terms (the first version) let common
  words ("printer", "print", the tool name every contextual header carries) decide the order:
  hybrid recall fell *below* vector-only (Form 4 0.77 vs 0.87, X2D 0.93 vs 0.97). The list is
  now Σ over the query's lexemes of `idf(lexeme) × ts_rank(tsv, lexeme)`, with idf computed
  over the passages being searched (BM25's formula) — a lexeme in every passage weighs
  nothing. Full-text-only recall rose from 0.73–0.90 to 0.83–1.00, and hybrid now matches or
  beats both lists on three of four manuals. The exact part-number match is its own ranked
  list in the fusion. RRF k = 60, top 8, as written. A query that cannot be embedded degrades
  to the lexical lists (`vectorFailed`).
- **§8 access, in SQL.** "Signed-in lab staff" is `can(viewer, "tools.edit")` (admin and
  super_admin): they search private files, hidden (unpublished) resources and draft tools'
  manuals too. Everyone else — anonymous visitors, students, MCP (no identity) — sees only
  public files on published resources of published tools. Archived tools and stale archive
  copies are never searched. A private passage has no `pdfUrl`; the prompt says to cite it in
  bold, unlinked.
- **§3.6 chat.** `search_manual({ query, tool? })` in a new `manuals` capability (after `web`),
  open to everyone, registered on MCP too (§7). `tool` is a catalog name or slug; an unknown
  one is refused, never widened to all manuals. Each passage returns `citation` ("Form 4
  Manual, p. 42", "pp. 42–43", "(printed 3-12)" when the label differs), `url`
  (`…#page=N`), `section`, and its text fenced with `fenceUntrusted` (the existing
  `<untrusted-page>` convention; its preamble says "web page", which is inexact for a manual
  but kept rather than forking the fence). On a tool page the route loads that tool's
  searchable manuals (`chat/tool-manuals.ts`): their outlines go in the prompt (levels 1–2,
  ≤ 8,000 characters, level 2 dropped first) and **their resources are skipped by the PDF
  attachment**, so `MAX_PDFS_PER_CHAT` counts only `no_text`, `failed`, unprocessed or
  embedding-pending manuals. **"The manual does not cover it" is the model's judgement**:
  vector search always returns nearest passages, so the tool answers `no_results` only when no
  searchable manual is in scope; the prompt requires the model to say so when the passages do
  not answer. The status line is "📖 Searching the {tool} manual…" when the model names a
  machine, "📖 Searching the manual…" otherwise (the client does not know the focused tool's
  name). Chat stays `openai/gpt-6-luna`.
- **§5/§6 admin.** The editor tag reads **Searchable · N pages** once passages exist, else
  "Text stored · N pages". **Re-process** (resource rows with a PDF, `tools.edit`) marks the
  documents stale (`extractor_version = 'reprocess'`, versions cleared — nothing deleted; the
  old text and passages keep serving) and starts the archive workflow; it returns the panel's
  own revision (the tool row is not touched). **`/admin/research` did not exist**; it is new,
  gated on `tools.edit`, listed on `/admin`, and holds only the manual counts (searchable,
  text only, scanned, failed, processing, pages, passages).
- **Backfill.** `npm run manuals:index` gained a second pass: after the text, every ready
  document whose passages are missing or stale is chunked and embedded, with tokens and the
  Gateway-reported cost per document and in total. `--text-only` skips it; `--dry-run` chunks
  and counts, embeds nothing.
- **§10 tests.** Offline, on PGlite with pgvector and a fake embedding model
  (`test/ai/fake-embeddings.ts`: hashed bag of words, or pinned one-hot vectors): chunker
  sections/pages/overlap/headers, fusion order, part-number matches, tool scoping, access (a
  private SOP, a hidden resource and a draft tool never reach an anonymous or student search),
  archived tools and stale copies, the full-text fallback, merging, idempotency and version
  changes, ≤ 96 per call, failure classification, the index step and its retry, the backfill,
  the chat route (tool offered, outline in prompt, citations and `#page=N`, scoping, access,
  fallback attachment only for unprocessed manuals, the cap), the workflow tier through the
  Gateway's stubbed `/embedding-model`, the admin action and components. Chat evals: new
  `evals/cases/manual-search.yaml` on a fixture Form 4 manual (`evals/manual-fixture.ts`, no
  specs, no warranty) with two new assertion kinds, `cites_page` and `says_not_covered`.

**Retrieval eval (live, 2026-09-23).** `.livecheck/retrieval-eval.mts`: each manual extracted
by the app's extractor, stored on its own tool, chunked and embedded by the app's passages
step through the Gateway, then 30 hand-written questions per manual (paraphrased, spread over
the chapters, ~10 hinging on a number, part number or error code; expected pages verified
against the extracted text) searched with `searchManuals`, scoped to the tool, top 8. A hit is
any returned passage whose page range covers an expected page.

| Manual (pages → passages) | FTS | Vector | **Hybrid** | Voyage FTS | Voyage vector | **Voyage hybrid** |
|---|---|---|---|---|---|---|
| Form 4 manual (58 → 127) | 0.90 | 0.87 | **0.90** | 0.90 | 0.93 | **0.93** |
| Bambu Lab X2D user manual (149 → 192) | 0.83 | 0.97 | **1.00** | 0.83 | 0.97 | **1.00** |
| Makera Carvera Air quick start guide (26 → 28) | 1.00 | 1.00 | **1.00** | 1.00 | 0.97 | **1.00** |
| Trotec Speedy 400 operating manual (89 → 108) | 0.83 | 1.00 | **0.97** | 0.83 | 0.97 | **1.00** |
| **All 120 questions** | 0.89 | 0.96 | **0.97** | 0.89 | 0.96 | **0.98** |

- **Manuals.** Form 4: Formlabs' "Form 4 Installation and Usage Instructions" (a reseller's
  copy of the official PDF, `cdn.goengineer.com`). X2D: Bambu Lab's official user manual
  (`csm.bblcdn.com` — reachable this time). Carvera Air: Makera's official "Carvera Air
  Instruction Manual" download is a **26-page multilingual quick start guide** with 5 English
  pages, so its 30 questions concentrate there and it is an easy set; Makera's full Carvera
  manual and the Carvera Air examples guide are **image-only** (both extract as `no_text` —
  the classifier working as designed). The **Trotec Speedy 400 operating manual** (official,
  `troteclaser.com`) was added as a fourth, substantive manual.
- **Remaining misses** (OpenAI, hybrid): Form 4 "what wavelength cures the resin" (a spec-table
  row), "what does the mixer do", "can I lift the printer by its cover"; Trotec "how big and
  heavy is it". All are short facts inside long passages whose embedding is dominated by other
  content — a reranker (§9 phase 3) or smaller passages for tables would address them.
- **Embedding choice (§11).** Both models fit 512 dimensions through the Gateway at the same
  reported price ($0.02 / M tokens; embedding all four manuals cost $0.0025 with either).
  Voyage is marginally better on hybrid (118 vs 116 of 120 — two questions) and on Form 4's
  vector list, worse on Carvera's and Trotec's vector lists; the difference is within one
  manual's noise, not "clearly better". **Default stays `openai/text-embedding-3-small`**
  (same provider as the chat model, as §3.4 argued); `MODEL_EMBED=voyage/voyage-4-lite`
  works unchanged and the backfill re-embeds on the switch.
- **Cost.** Embedding the 58-page Form 4 manual: 30k tokens, $0.0006; all four manuals
  (455 passages): $0.0025. Query embeddings are ~10 tokens each.

**Live chat check** (`.livecheck/chat-check.live.ts`: the real `/api/chat` route handler,
Luna, real embeddings, the real Form 4 manual processed into the demo database, asked from the
Form 4's page). All three answers called `search_manual` and cited pages with `#page=N` links:
"…lift it out. Keep it level to avoid spills … [Form 4 Manual, p. 43](…#page=43); insertion
details are in the [Form 4 Manual, p. 25](…#page=25)", "Error 6.3 means 'Cartridge missing.'
… [Form 4 Manual, p. 46](…#page=46)", "Allow at least 30 minutes for IPA to evaporate …
[Form 4 Manual, pp. 32–33](…#page=32)". The chat eval suite (`npm run eval`, Luna) passed
**17/17**, including the three new manual-search cases. One measured chat turn with a manual
search: 6.4k input tokens, $0.0003.

**Not done / open.** §3.7's "fixed set of queries" for refresh research still uses phase 1's
`manualDigest` (refresh research does not exist yet); the tool page's Contents and research are
unchanged. `halfvec`, a reranker and OCR remain phase 3. Cross-tool search from the general
assistant is on (the model may omit `tool`), per §11's open question — revisit if answers wander
to the wrong machine.
