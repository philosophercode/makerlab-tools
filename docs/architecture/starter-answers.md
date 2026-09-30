# Starter answers

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Starter answers (`starter_answers`; migration `0026`, after #121's `0025`)

The assistant's starter chips — each tool's `starter_questions` and the general
operate / debug / create chips — are **asked ahead of time**, graded, and the
good answers kept, so a click answers at once with no model call.

- **Runner** (`lib/starters/answer.ts`): the real chat composition
  (`CAPABILITIES`, `composeChat`, `languageModelFor("chat")`,
  `chatProviderOptions()`, `chatPrepareStep`, 10 steps) as
  `systemAnonymousIdentity()` — so no signed-in-only data (the floor map) —
  with writes and `read_page` stubbed (`lib/chat/headless-stubs.ts`, shared
  with the eval harness), no Exa, no whole-PDF attachment. The answer is the
  `UIMessage` read off `toUIMessageStream()`, reasoning and provider metadata
  stripped.
- **Grader** (`lib/starters/grade.ts`, job **`starterGrade`**, Luna flex):
  checks first (a write/page-read stub, a manual link no `search_manual`
  passage backs — the tool's own listed resource URLs excepted — a `/map`
  link, a live-state read, an `honest_absence`/`not_in_catalog` gap), then a
  JSON judge: answered, grounded (record + every passage returned + catalogue
  lookups), specific, safe, stable, score ≥ 7. A citation/judge miss is
  retried once.
- **Refine** (`lib/starters/refine.ts`): failed questions are replaced by the
  `researchRead` writer from the tool's record and its searchable manuals'
  contents and snippets (`lib/starters/context.ts`); at most 2 rounds, ≤ 3
  chips, a harmless failed original kept (live) if nothing better passes, an
  errored run never replaced. General chips' replacements are **proposals**
  only (their text is translated in `messages/*.json`).
- **Cache and invalidation** (`lib/starters/hash.ts`, `cache.ts`): served only
  when `accepted` and `source_hash` equals the hash of the current inputs —
  tool revision, its resources, its manual documents' states and versions,
  `STARTER_ANSWER_VERSION`, `CHAT_PROMPT_CACHE_KEY_DEFAULT`, the chat model,
  locale, question (general chips: published tool names + every manual). No
  hook is needed: a stale row is simply not served. English only.
- **Chat** (`components/chat/use-starter-answers.ts`, `ChatPanel`): while the
  chips show, `GET /api/chat/starters?toolId&locale`; a chip with an answer
  goes into `setMessages` (user + cached assistant) — no `sendMessage` — and
  `POST /api/chat/starters` counts it (`lib/usage/starter-chip.ts`:
  `chat_turn` with `source: "cached"` plus the stored `tool_asked` /
  `manual_cited`). Follow-ups are live with the cached answer in the history.
  A tool page showing the generic chips, another locale, curation: live.
- **Script**: `npm run starters:refresh -- [--dry-run|--apply] [--limit N]
  [--ids a,b] [--general] [--force] [--concurrency N] [--rounds N] [--out f]`
  (`scripts/starters-refresh.ts` → Vitest task runner like `npm run eval`).
  Dry run by default; `--apply` writes questions through `updateTool`
  (revision-checked) and the answers, and caches nothing if the tool moved
  mid-run. Writes a JSON report and a `.md` summary. ~$0.005 a tool reported.
- **Admin**: `/admin/research` lists every chip's status (Cached / Stale /
  Graded down / Live) and grade (`StarterAnswerTable`). No re-run button.
- `data:push` skips `starter_answers` (`DEPLOYMENT_BOUND`): its answers carry
  the source database's addresses and hashes.
