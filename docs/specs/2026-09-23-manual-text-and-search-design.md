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
