# Manuals

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Archived manuals (link rot)

A manufacturer moves a PDF and the tool loses its manual. So each manual link
is copied into Blob once, and the tool page and the chat prefer the copy.

- **No table of its own.** The copy is an `attachments` row owned by the
  resource — public, `application/pdf`, `source_key =
  manual:<resource id>:<source url>` (`src/lib/data/manual-archives.ts`). The
  resource keeps its own `url`, the manufacturer's link. A copy whose key does
  not match the resource's current `url` is stale: hidden everywhere, and
  released to the orphan sweep when the new link is archived.
- **`archiveManual(resourceId)`** (`src/lib/manuals/archive.ts`) archives a
  Manual, or any resource whose link answers a PDF. The body must *be* a PDF
  (`%PDF-`, or `application/pdf` that is not markup) — an HTML product page is
  refused. 30 s, 25 MB. Skips a resource that already holds a PDF (uploaded,
  imported, or this link's copy), and skips as `blob_not_configured` without a
  token. It returns `archived | skipped | failed` with a reason and never
  throws for an expected failure; it logs the link's host only, never the path
  or query. Step code: it writes Blob through `import/blob-uploader.ts`, not
  the `server-only` `lib/blob.ts`.
- **Runs in a workflow**, `archiveManuals(resourceIds)`
  (`src/workflows/archive-manuals.ts`), one step per resource, `maxRetries = 2`,
  retrying only a transient failure (network, 5xx/429, a Blob write, the
  database). Started by `requestManualArchive()` (`src/lib/manuals/trigger.ts`)
  after approving a tool, after MCP `create_tool`, and after the editor adds a
  resource or changes its link or type. It never throws and never fails the
  write that called it.
- **The daily cron's `manuals` stage** (`src/lib/cron/manual-archive.ts`) hands
  up to ten due resources to one run each night — the backfill for imported
  manuals and the backstop for a start that never happened. The window moves
  each night and wraps, so a manual that always fails cannot stall it. **Due
  is every PDF resource, not only Manuals** (amendment 2026-10-06): a resource
  typed Manual, SOP or Safety (`ARCHIVED_RESOURCE_TYPES`), or of any other
  type but Video whose link names a `.pdf`, never the lab's carried-through
  `lab_document` material. The X1-Carbon's guide and the Trotec's operating
  manual were typed SOP and so were never archived, indexed or searchable.
- **Readers.** `resourceLinks` gives an archived manual **one** link, to the
  copy, with the manufacturer's URL as `sourceHref` (the tool page shows only
  `href`). `listResourcesForTool` sets it apart as `archivedUrl` and leaves it
  out of `fileUrls`; the chat attaches `archivedUrl` first, so one manual is
  attached once, and "(attached)" matches the copy or the source.

## Manual text and search (`manual_documents`, `manual_pages`, `manual_chunks`; manual text spec phases 1–3)

Every stored manual PDF is also kept as **text, page by page, with its
outline** (`docs/specs/2026-09-23-manual-text-and-search-design.md`, migration
`0010`), and — phase 2, migration `0011` — as **search passages** the chat's
`search_manual` answers from with page citations. Whole-PDF attachment is only
the fallback for a manual that is `no_text`, `failed` or not processed yet.

- **Extraction** is `src/lib/manuals/extract.ts` (`extractManual`, **unpdf** —
  pdf.js without a worker, `isEvalSupported: false`): lines rebuilt, end-of-line
  hyphenation joined, running headers/footers and bare page numbers dropped,
  bookmarks resolved to pages (identifier-like bookmarks such as `_tyjcwt`
  ignored), headings inferred from font size without them, printed page labels
  kept. `ready` / `no_text` (under 100 chars a page) / `failed` (`encrypted`,
  `corrupt`, `too_large`: 25 MB, 1,000 pages, 60 s — the deadline is checked
  between pages because pdf.js never yields to a timer). Bump
  `EXTRACTOR_VERSION` when what is stored changes; older documents re-process.
- **One document per stored PDF** (`attachment_id` unique, cascade). A resource's
  *current* PDFs are its archive of the link it carries now, or any file staff
  uploaded (`data/manual-documents.ts`); a stale archive copy is never
  processed or shown.
- **Processing runs in the archive workflow**: `archiveManuals` calls
  `indexManualStep` after each archive that did not fail
  (`manuals/index-document.ts`), which reads the bytes back from Blob
  (`manuals/stored-bytes.ts` — `.blob-data/` locally, `@vercel/blob` `get`
  otherwise, private files too), extracts and writes document + pages in one
  transaction. Idempotent on attachment + version; only a transient Blob read
  or an unreachable database is retried; `no_text` and `failed` are stored
  answers. It never changes the archive's counts. Adding a resource **with an
  uploaded PDF** now starts the same run.
- **Backfill:** `npm run manuals:index -- [--dry-run] [--ids …] [--limit N]
  [--force]` (`scripts/index-manuals.ts`), same target order as the import;
  stop the dev server for a local database. No Gateway calls in phase 1.
- **Readers.** The editor's resource row shows `ManualStateTag` (Text stored ·
  N pages / No text (scanned) / Failed: reason / Processing); the tool page
  shows a collapsed **Contents** under a public manual's link
  (`ManualContentsList`, `getManualContents`, cached with the catalogue), each
  entry opening `<pdf>#page=N`. Research's read step looks a manual URL up in
  the stored text first (`findStoredManualByUrl`), else extracts a downloaded
  PDF in memory (`readPage` with `maxPdfBytes` 25 MB), and gives the model
  `manualDigest` — the outline plus the spec-richest pages, labelled with page
  numbers, within `RESEARCH_MANUAL_TEXT_MAX_CHARS`; Exa's copy is the fallback.
  A manual PDF Exa returned but the search did not list is added to the reads
  (`research/manual-pdfs.ts`).
- **pgvector.** Migration `0011` creates the `vector` extension and
  `manual_chunks` (a generated English `tsvector` + GIN, `vector(512)` + HNSW
  cosine, `tool_id`); since `0019` the column is **`halfvec(512)`** with a
  `halfvec_cosine_ops` index, and queries cast to `halfvec(512)`. PGlite loads the extension from
  `@electric-sql/pglite-pgvector` (`PGLITE_EXTENSIONS` in `db/pglite.ts`, kept
  in `serverExternalPackages` like PGlite itself); Neon ships it.
- **Passages** (`manuals/chunk.ts`, `CHUNKER_VERSION`): cut along the outline,
  never across a section; a numbered heading the outline lacks ("2.2 Technical
  specifications") becomes a subsection; ~2,400 characters with ~320 of
  overlap, split at paragraphs, then sentences, then words; each records its
  pages and section path. The indexed `search_text` is the contextual header
  `"<tool> — <document> › <section path>"` plus the passage; `content` is the
  passage alone.
- **Embeddings** are job **`embed`** (`openai/text-embedding-3-small`,
  `MODEL_EMBED`), an *embedding* job — `embeddingModelFor`, not
  `languageModelFor` — asked for `EMBEDDING_DIMENSIONS` (512) through the
  Gateway's provider options (`embeddingProviderOptions`: OpenAI `dimensions`,
  Voyage `outputDimension`); a vector of another length is refused before it
  reaches the column. ≤ 96 inputs a call (`manuals/embed.ts`), cost from
  `providerMetadata.gateway`. The document records `embedding_model`
  (`openai/text-embedding-3-small@512`) and `chunker_version`; either one
  differing makes it stale.
- **The passages step** (`manuals/passages.ts`) runs inside `indexPdf` after
  the text is stored — and for text stored earlier, on the next run — embeds
  outside any transaction, then replaces the passages and records both
  versions in one. Failures are values: rate limits, 5xx, timeouts and no
  answer are `transient` and `indexManualStep` retries them; auth, an unknown
  model or a wrong dimension are not. The stored text survives any of them.
- **Search** (`manuals/search.ts`, `searchManuals`): the lexemes of
  `websearch_to_tsquery('english', q)`, each weighted by its idf among the
  passages searched (so the tool name every header carries weighs nothing),
  plus an exact match on part-number-like tokens, plus vector top 30; fused by
  RRF (k = 60), top 8, adjacent passages of a section merged. **Access is in
  the SQL**: `can(viewer, "tools.edit")` searches private files, hidden
  resources and draft tools too; everyone else only public files on published
  resources of published tools; archived tools and stale archive copies never.
  A query that cannot be embedded degrades to full text (`vectorFailed`).
  Since 2026-10-06 the same text stored twice (one PDF on two tools) is one
  passage (`dropDuplicates`, before the reranker sees it), and with
  `minRerankScore` a reranked passage under the floor is dropped
  (`droppedWeak`). Each passage's machine is its **resource's** tool, and it
  carries the resource's type (`resourceType`).
- **Chat** (`capabilities/manuals.ts`): `search_manual({ query, tool?,
  compare_tools?, all_machines? })`, open to everyone, on MCP too (public
  manuals only, since MCP carries no identity). **One machine per search,
  decided in code** (amendment 2026-10-06 "An answer cites only its machine's
  documents"): on a tool page the search is pinned to that tool whatever the
  model passes (a `note` says so when it asked for another machine); off a
  tool page the model names the machine (`tool`), a name that fits several
  machines is refused with the candidates (`ambiguous_tool`) so the model asks
  the student, and a call naming no machine is refused (`needs_tool`).
  Only a comparison searches more than one machine: `compare_tools` (the named
  few) or `all_machines` (the lab). Every result records its scope
  (`machines`, `toolIds`, `comparing`); every passage its machine (`tool`,
  `toolId`, and in the fence note: "a document for the Form 4. It is evidence
  for the Form 4 only") and its resource type (`kind`; an SOP is the lab's
  operating reference). Each passage comes back fenced (`<untrusted-page>`)
  with its `citation` ("Form 4 Manual, p. 42") and a `url` ending `#page=N`.
  Reranked passages under `MANUAL_RERANK_MIN_SCORE` (default 0.05, `0` off)
  are dropped. On a tool page the route loads the searchable
  manuals (`chat/tool-manuals.ts`) — their outlines go into the prompt (levels
  1–2, ≤ 8,000 characters), and their resources are **never attached**;
  `MAX_PDFS_PER_CHAT` counts only the fallbacks. Vector search always has a
  nearest passage, so "the manual doesn't cover it" is the model's judgement
  from the passages (the prompt requires it; `says_not_covered` evals it) —
  `no_results` means no searchable passage in scope (or none above the floor).
- **When the documents are silent** (`src/lib/ai/manual-silence.ts`): the one
  rule, in the chat prompt's static prefix, that the `no_results` message,
  the manuals prompt, the intro and "Where you are" all point to: say this
  machine's documents do not cover it, never use another machine's document,
  general guidance only if safe and under its own "General guidance, not from
  the <machine>'s documents:" line with no figures, and safety to staff.
- **Tool-scoped citations** (`src/lib/manuals/citation-scope.ts`): an answer
  is about the focused tool, else the machines its searches were scoped to,
  else (a lab-wide comparison) any machine. The chat
  (`components/chat/manual-citations.ts`) **relabels** a cited passage of
  another machine with that machine's name ("Prusa i3 MK3S+ · p. 25") rather
  than dropping it, and names every citation's machine in a comparison; Usage
  Insight records it as `manual_cited` with `source = 'cross_tool'`
  (`crossToolCitations` on `/admin/insights`, `cross_tool_citations` in
  `get_usage_summary`); `checkCitations`' rule 6 (`other_machine`) and the
  eval's `cites_only_tool` fail it.
- **Backfill** adds a second pass: after the text, every ready document whose
  passages are missing or stale is chunked and embedded, with tokens and the
  Gateway-reported cost printed (`--text-only` skips it; `--dry-run` chunks and
  counts without embedding).
- **OCR (phase 3, migration `0019`)** — only `manuals:index` runs it, never the
  workflow. A PDF that extracts as `no_text` is drawn page by page without a
  canvas (`manuals/page-images.ts`: the images each page paints, from pdf.js's
  operator list, composited with `sharp`), each page read by job `ocr`
  (`manuals/transcribe.ts` — a transcription, headings marked `#`/`##` for the
  outline, the page fenced as data) and stored `ready` (`manuals/ocr.ts`):
  pages at their own PDF numbers with `manual_pages.source = 'ocr'`,
  `manual_documents.ocr_version = 'ocr-1:<model>'`. Caps: 150 pages
  (`--ocr-max-pages`), ~$1 a manual by reported cost (`ocr_partial` when cut
  short). A transient model failure stores `no_text` without `ocr_version`, so
  the next run retries; a refused page is stored empty. A scan read at this key
  is never read again (`--force` keeps OCR text; `--force-ocr` re-reads), and
  the workflow's Re-process keeps it (`ocr_kept`). The run ends with a Summary
  (PDFs, manuals OCR'd, pages, passages, cost); a second run finds nothing to do.
  An OCR'd passage carries `ocr: true` and `search_manual` adds a `transcribed`
  note; the editor tag adds "· OCR". JPEG 2000 scans draw blank (no OpenJPEG
  wasm configured).
- **Reranking (phase 3).** `searchManuals({ rerank: true })` — `search_manual`
  asks for it, refresh research does not — sends the top 24 fused passages to
  job `rerank` (`manuals/rerank.ts`, AI SDK `rerank()`), whose order and score
  replace the fused ones before the top 8 are kept and merged. 2.5 s timeout,
  no retries; any failure keeps the fused order (`rerankFailed`).
  `MODEL_RERANK=off` skips it. `search_manual` also passes the relevance
  floor (`rerankMinScore()`, `MANUAL_RERANK_MIN_SCORE`, default
  `DEFAULT_RERANK_MIN_SCORE` 0.05); it applies only to reranked scores. Tests: `models-stub.ts`'s `rerankingModelFor`
  keeps the given order unless a test calls `setRerankingModel(rerankingModel(…))`.
- **Admin.** The editor's tag says **Searchable · N pages** once passages
  exist; **Re-process** on a resource row with a PDF marks its documents stale
  (`markResourceManualsStale` — nothing deleted) and starts the archive
  workflow (`reprocessManual`, `tools.edit`, revision untouched).
  `/admin/research` (`tools.edit`) counts current PDFs by state
  (`countManualsByState`).
- **Tests** seed documents straight into PGlite (`test/manuals/seed.ts`) and
  embed with `test/ai/fake-embeddings.ts` (hashed bag of words, or pinned
  one-hot vectors); `test/fixtures/manuals/scanned-image.pdf` is a real scan
  (image XObjects) for the OCR tests; `models-stub.ts` has `setEmbeddingModel`, and the workflow
  tier stubs the Gateway's `/embedding-model` endpoint (`gatewayHandlers({
  embedding })`). The live retrieval eval is a `.livecheck` script (results in
  the spec's phase-2 amendment).
