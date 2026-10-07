# Key files

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Key files

| Path | Purpose |
|---|---|
| `src/lib/site-config.ts` | White-label branding (env-driven, all have defaults), including `labHours` and the header `wordmark`. Names: **MakerLAB** is the lab, **MakerLAB Tools** the site, **MakerLAB Assistant** the AI (identity spec 2026-09-28) |
| `src/lib/ai/lab-context.ts` | The assistant's "Where you are" block — the lab, its people, Cornell Tech, and its operate / debug / create purpose — placed after the intro in the static prompt prefix. Sourced facts only; sources in its comments |
| `src/components/chat/assistant-intro-store.ts` / `AssistantIntro.tsx` | The first-visit "Meet the MakerLAB Assistant" callout beside the chat button, remembered in `localStorage` (try/catch), gone once dismissed or the chat opens |
| `src/lib/kiosk/*` / `src/components/kiosk/*` / `src/app/kiosk/` | The lab status screen: snapshot loader, pure timing and derivations, QR code; the client screen; the page (see "The lab status screen") |
| `src/lib/map/*` / `src/components/map/*` | The floor map, signed-in only (`canSeeMap`): the plan data, `placeTool`, `planWork` (tools grouped by zone); `/map`'s explorer (a picked place is a **pushed** `?highlight=`, so Back returns to the whole map; the search is a replaced `?q=`), the tool page's "Where it is" and the project page's "Where you'll work" (`SignedIn*` wrappers read identity in their own Suspense hole, so cached shells carry no placement) |
| `src/lib/qr/*` / `src/components/admin/qr/*` / `src/app/admin/inventory/qr/` / `src/app/api/qr/[slug]/` | QR labels: the URL format, layout, SVG and PDF; the admin label page; the public image route (see "QR labels") |
| `src/lib/db/client.ts` | `getDb()`, `dataSubstrate()`, `pingDb()` — the one entry point to Postgres/PGlite |
| `src/lib/notion.ts` | Notion API client — used by the one-time import and its scripts; no request path reads or writes Notion through it (the mirror has its own client) |
| `src/lib/data/attachments.ts` | `attachments` rows: create, claim onto an owner, reorder, release, list orphans, delete |
| `src/lib/data/revision.ts` | The editor's concurrency token — `extract(epoch from updated_at)::text`, **never a `Date`** (read the docstring before touching a conflict check) |
| `src/lib/data/tools.ts` / `units.ts` | Row-level inventory writes, every one revision-checked. Tools are archived, never deleted |
| `src/lib/data/inventory.ts` | The `/admin/inventory` read — every tool, its state and its needs-attention flags, plus the units that belong to no tool |
| `src/lib/data/tool-export.ts` / `src/lib/export/*` / `src/app/api/admin/tools/export/route.ts` | The tools CSV (`catalog.export`, super admins): the read (all or selected ids, public links only), the columns and the RFC 4180 writer, the route |
| `src/lib/data/taxonomy.ts` | `listCategories()` / `listLocations()` — the two option lists an editing surface needs (live categories in tree order, `group` = the heading) — plus `findOrCreateLocation` for intake. `findOrCreateCategory` is left for the Notion import only: nothing else creates a category |
| `src/lib/data/category-admin.ts` / `src/lib/taxonomy/*` | Taxonomy v2: proposals, decisions, merge, rename, retire, `matchExistingCategory`; the seed tree, the migration mapping and plan, the audit (see "Taxonomy v2") |
| `src/lib/data/pending-tools.ts` | `pending_tools`: the batch, every status transition as a conditional write, and the two approval transactions |
| `src/lib/data/duplicates.ts` / `tool-create.ts` | The intake duplicate check (same normalisation in TypeScript and SQL), and `createToolRecord` — one tool with its units and resources, slug retried in a savepoint |
| `src/lib/intake/*` | Client-safe intake types, limits and `canActOnPendingTool` / `isResearchable`; `approve.ts` composes approval with audit and invalidation |
| `src/lib/research/*` | The research engine: `prompt`, `model-output`, `errors`, `taxonomy-match`, `assemble`, `verify-links`, `result` (the `ResearchResult` schema, `ImageCandidate`/`ResearchImages`), `step-types` (the steps' shared result types) and `steps` / `image-steps` (the workflow's steps) |
| `src/lib/research/images/*` | The image stage's parts: `candidates`, `probe` (SSRF-guarded download, then `background`'s `transparent`/`plain`/`busy` classification), `rank` (the vision call, plus the `BUSY_PENALTY` nudge and composites last), `crop` (the product box: validation, padding, the crop), `clean-copy` (what rank 1's cleaned copy is: crop, cut, both or none), `clean` (the deterministic flood-fill cutout and its validation — never a generative redraw), `pixels` (RGBA decoding and border helpers), `downscale` (`loadSharp`, and the ranking model's JPEG view) |
| `src/lib/ai/models.ts` | The job registry (gateway spec §3.1) — `MODEL_JOBS` (language jobs only; the image job was retired), `modelIdFor`/`languageModelFor`, `serviceTierFor`/`providerOptionsFor` (per-job service tier), `gatewayProvider()`. No `"server-only"`: step code imports it |
| `src/lib/ai/gateway-usage.ts` | `gatewayCallReport` / `describeGatewayCall` — the cost and applied service tier from a call's `providerMetadata.gateway`, for research's log lines, the backfill summary and live checks |
| `src/lib/ai/gateway-errors.ts` | `classifyModelError` — a Gateway failure in the app's own words (`model_not_found`, `auth`, `rate_limited`, …), never a provider's |
| `src/lib/ai/exa.ts` | `chatExaSearch()` / `researchExaSearch()` — the Gateway's provider-executed web search; `countExaCalls` / `exaImageHints` read it back off `result.steps` |
| `src/lib/ai/tool-caps.ts` | `countToolCalls` / `activeToolsWithinCaps` — the chat's `prepareStep` cap that drops a tool from `activeTools` once its call budget is spent (between steps only: `read_page` also enforces its cap inside the tool; research's Exa budget is advisory, one Gateway request, logged on overshoot) |
| `src/lib/web/read-page.ts` | `readPage()` — the read step's and the chat's `read_page` tool's page fetch: HTML/PDF, capped, timed out, never throws for an expected failure |
| `src/lib/web/guarded-fetch.ts` / `address-guard.ts` | The SSRF guard everything above reads through — `readPage`, the image probe, approval's download of a chosen original, link verification (`research/verify-links.ts`, since the gateway migration: a model-proposed resource link to a private address is dropped unopened), the manual archiver's download (`manuals/archive.ts`) and the chat's download of a manual from its source link (`chat/fetch-manual-pdf.ts`; the app's own Blob copies are fetched plainly) — refuses loopback/private/link-local/metadata addresses, both when checking and when the socket connects (`pinnedDispatcher()`, an undici `Agent` whose lookup applies the same check — DNS rebinding closed, gateway spec amendment 2026-10-05), `READ_PAGE_TEST_ORIGIN` exempts one exact origin for tests only |
| `src/lib/web/html-text.ts` | `extractPage()` — a page's readable text plus its `og:image`/`twitter:image`/JSON-LD product image, no HTML parser dependency |
| `src/lib/images/inspect.ts` | `inspectImage()` — a JPEG/PNG/WebP's real dimensions and alpha channel from its header bytes, no deps |
| `src/lib/research/image-steps.ts` | `findImages` (probe, rank, clean the top candidate, write `images`) / `completeWithoutImages` — the workflow's third step per item |
| `src/lib/research/image-stage.ts` / `image-retry-steps.ts` | The image stage's shared probe → rank → clean (no steps, never exported through a step module); **Find a different image**'s step, run by `src/workflows/image-retry.ts` |
| `src/lib/research/source-pages.ts` | Product page vs manual/wiki/support vs video, from the URL — page order for reading, image source weighting, the video evidence rule |
| `src/app/api/pending-tools/[id]/cleaned-image/route.ts` | Streams the private cleaned PNG to a reviewer holding `tools.approve`; 404 otherwise |
| `src/workflows/research-batch.ts` | `researchBatch` — the `"use workflow"` function, started only by the research route |
| `src/app/api/pending-tools/research/route.ts`, `[id]/route.ts` | **Research selected** and the table card's edits |
| `src/app/admin/intake/` | Add equipment: the `(tabs)` route group (Queue — `IntakeList`, polls while research runs; Imports; Import a list) and each item's preliminary page (`PreliminaryToolPage`, `ConfidenceStrip`) with their server actions |
| `src/components/IntakeTableCard.tsx` | The chat's intake table (`data-intake-table`) |
| `src/lib/files/promote.ts` | Copies a claimed chat photo to a public pathname before it is shown as equipment |
| `src/lib/inventory/*` | Those writes composed with cache invalidation and the audit trail — the layer `/admin/inventory`'s server actions call |
| `src/lib/admin/audit-warning.ts` | `record` / `warn` — the shared "a lost audit event is a warning on a success" channel |
| `src/lib/admin/action-gate.ts` | `authorizeAdminAction(permission)` — identity, limiter, permission: the preamble every admin server action runs |
| `src/lib/data/tool-editor.ts` | The editor panel's read — one tool with its units, resources and photos, drafts and retired rows included |
| `src/app/admin/inventory/actions.ts` + `unit-`/`resource-`/`photo-actions.ts` | The editor's server actions, one module per section, each checking its own permission |
| `src/components/admin/ToolEditorPanel.tsx` | The editor itself: the revision token, the conflict, and the five sections beside it |
| `src/app/tools/[id]/EditToolControl.tsx` / `DraftToolView.tsx` | Edit mode on a tool page (phone-first), and drafts at their slug for `catalog.view_drafts` |
| `src/lib/images/*` | Thumbnails: `thumbnail-urls` (names, `srcset`, client-safe), `thumbnails` (the `sharp` render), `bundled-thumbnails` (`npm run thumbnails:bundled`), `attachment-thumbnails` (Blob rows; `npm run thumbnails:backfill`), `schedule-thumbnails` (after the response) |
| `src/components/ToolImage.tsx` | Every tool photo: the thumbnail `<picture>`, the `next/image` fallback, the empty plate |
| `src/lib/revalidate.ts` | `invalidateCatalog()` / `invalidateProjects()` / `invalidateMaintenance()` (the kiosk's ticket count, a tool page's maintenance history) — the one home for the cache tag strings, and `{ expire: 0 }`, because `revalidateTag` with a *named* profile is stale-while-revalidate and would serve the pre-publish page to one more reader |
| `src/lib/blob.ts` | The Blob seam — `put` (private backups, fixed pathname) and `putUpload` (random pathname, caller's access) |
| `src/lib/cron/backup.ts`, `src/lib/cron/cleanup.ts` | The nightly Postgres export and the orphaned-upload sweep |
| `src/lib/cron/backup-policy.ts` | What the nightly export holds back — `session` / `verification` / `oauth_access_token` skipped, token columns blanked (a backup is data, not credentials), and `manual_pages` / `manual_chunks` left out because `npm run manuals:index -- --force` rebuilds them after a restore |
| `src/lib/cron/backup-retention.ts` | Pure tiered retention: every day for 7 days, newest per ISO week to 1 month, per month to 1 year, per quarter to 3 years |
| `src/lib/cron/heartbeat.ts`, `src/lib/cron/backup-freshness.ts` | Failure visibility: the nightly run pings `CRON_HEARTBEAT_URL` (`/fail` on failure); `/admin` warns a super admin when the newest backup is over 36 hours old (`docs/operations.md`) |
| `src/lib/catalog.ts` | Catalog orchestration + cache, reading Postgres |
| `src/lib/unit-serials.ts` | Whole unit serials are staff-only (`catalog.view_serials`): the catalogue reads carry only each unit's masked last four (`serialMasked`), and `canSeeSerials` / `unitsForViewer` / `toolForViewer` swap in the whole serial for staff. Used by `src/components/tool/UnitsForViewer.tsx` (the tool page's units table, its own Suspense hole), the chat's focused tool, `get_unit_details` and `get_tool_details` |
| `src/lib/serial-mask.ts` | What students and visitors see of a serial: `•••• 9831`, the last four characters behind a mask (nothing for four characters or fewer). Pure, so the units table can use it; screen readers hear "Serial ending 9831" |
| `src/lib/rate-limit.ts` | In-memory (or Upstash) sliding-window limiter, tiered by role |
| `src/lib/auth/config.ts` | The Better Auth instance: Drizzle adapter, database sessions, admin plugin, domain enforcement |
| `src/lib/auth/identity.ts` | `resolveIdentity(req)` — the one way to learn who is calling. Never throws |
| `src/lib/auth/permissions.ts` | `statement` / `ac` / `roles` / `can()` — what each role may do |
| `src/lib/auth/super-admins.ts` | `AUTH_SUPER_ADMIN_EMAILS`, the lock-out floor |
| `src/lib/auth/floor-role.ts` | `reconcileSuperAdminFloor` — writes the floor's role and lifts its ban onto the row, because the admin plugin reads the row and not `can()` |
| `src/app/admin/layout.tsx` | The `/admin` front door — signed in? holds an admin permission? — then the section bar on every admin page, and `PaletteScope` telling the header's ⌘K who this is |
| `src/lib/admin/surfaces.ts` / `src/lib/data/admin-overview.ts` | Every admin surface once (tiles, bar, palette, each with its permission) / the home's count loaders |
| `src/components/palette/*` | The ⌘K palette on every page: `CommandPalette`, `HeaderSearch`, `PaletteScope`, `palette-match` |
| `src/app/admin/inventory/page.tsx` | The review table (`tools.edit`), uncached, filtered from the URL |
| `src/app/admin/users/actions.ts` | `setUserRole` / `setUserTitle` / `setUserName` / `addPerson` / `removeUser` / `unblockBlockedEmail` — the People page's server actions (Ban retired 2026-09-25), wrappers over `lib/actions/people*.ts` |
| `src/lib/data/user-removal.ts` / `blocked-emails.ts` / `account-removed.ts` | Removing a person in one transaction; the blocked-address list; "an id that names no account" in SQL |
| `src/lib/auth/blocked-sign-in.ts` | Refusing a blocked address in the create hook, and the redirect to `/auth/blocked` |
| `src/lib/data/users.ts` | The `/admin/users` roster, read straight from Postgres; `markFirstSignIn` |
| `src/lib/data/user-add.ts` | Add person: the pre-added `user` row and its `user.added` event, one transaction |
| `src/lib/actions/*` | The action layer: `performAction`, `defineAction`, `ACTIONS` / `ACTION_DEFINITIONS`, the People, queue, log-completed, catalogue, intake, import, spend and mirror definitions, `proposals.ts` (propose / confirm), `page-context.ts`, `typed-confirm.ts`, `inbox.ts` (the MCP inbox's cards), the parity guard (`parity.ts`, `exempt.ts`) and the spec drift check (`spec-drift.test.ts`) |
| `src/lib/chat/taint.ts` | Whether a chat turn read outside content (§8.4) |
| `src/lib/intake/research-start.ts` / `approval-draft.ts` | The one research start (route and card); the review page's default approval (page and card) |
| `src/lib/data/action-proposals.ts` / `action-subjects.ts` | `action_proposals` (claim once, creator only, TTLs); the id → name reads previews and page context use |
| `src/lib/capabilities/actions.ts` / `admin-reads.ts` | The generated proposing tools (chat, and MCP for `mcp: "propose"`) and their prompt; `find_people`, `list_corrections`, `list_project_queue` |
| `src/app/api/action-proposals/route.ts` | Confirm / cancel an assistant proposal (cookie only), and re-read the caller's proposals by id or chat |
| `src/app/admin/proposals/page.tsx` | **Assistant proposals**: the viewer's own MCP proposals as confirmation cards, and the last week's decided ones |
| `src/components/chat/ActionProposalCard.tsx` / `page-selection.tsx` | The confirmation card; the page selection the chat sends |
| `src/lib/admin/queue-write.ts` | `QueueActionResult`; `runQueueWrite` has no callers since the action layer (awaiting deletion approval) |
| `src/app/admin/maintenance/`, `corrections/`, `projects/` | The three queues: one page, one result module and one action apiece |
| `src/components/admin/use-row-action.ts` | What every queue control does around its action — optimistic, refusal restores, warning keeps |
| `src/components/admin/MaintenanceQueue.tsx` / `CorrectionsQueue.tsx` / `ProjectQueue.tsx` | The three card lists, each with its own small island |
| `src/lib/data/audit.ts` | `audit_events` — insert and select, never update or delete |
| `src/lib/db/schema/auth.ts` | Better Auth's four tables; property keys are its field names |
| `src/lib/types.ts` / `src/components/catalog-types.ts` | Notion record types / resolved view types |
| `src/app/api/chat/route.ts` | The chat: streaming, through the Gateway (job `chat`); capability tools (`get_unit_details`, `report_issue`, `identify_tools`, `read_page`, …) plus `exa_search` (added directly, like the retired `web_search` before it — not a capability), PDF manual attach |
| `src/app/api/mcp/route.ts`, `signed-in/route.ts`, `src/lib/mcp/handler.ts` | The MCP endpoint: caller → rate limit → a server holding only that caller's tools (6 public reads anonymously) |
| `src/lib/auth/mcp-caller.ts` | `resolveMcpCaller` — personal token, legacy `MCP_TOKEN`, OAuth token, or anonymous; a bad bearer is refused, never anonymous |
| `src/lib/capabilities/insights.ts` / `usage-summary.ts` | MCP only, super admins only (`insights.export`): `get_usage_summary` (the Insights Usage tab's counts, through `loadInsights`) and the MCP twin of `get_value_report` |
| `src/lib/capabilities/mcp-access.ts` | `mcpToolAllowed` / `mcpToolsFor` — which tools an MCP caller is offered |
| `src/lib/capabilities/mcp-catalog.ts`, `src/app/mcp/`, `src/lib/mcp/try-it.ts` | The public `/mcp` page: the registry described by audience, and Try it (anonymous, through the MCP handler) |
| `src/lib/data/api-tokens.ts`, `src/lib/auth/api-token-format.ts` | Personal access tokens (hash, prefix, revoke, last use) and the OAuth grant reads ("Connected apps") |
| `src/app/account/tokens/`, `src/app/oauth/`, `src/app/.well-known/` | The token page, the OAuth sign-in and consent pages, the discovery documents |
| `src/app/account/page.tsx`, `src/lib/account/name-actions.ts` | "Your account": your own name (`updateOwnName`), your address |
| `src/app/api/uploads/route.ts` | The one upload route → Vercel Blob + an `attachments` row |
| `src/app/api/cron/daily/route.ts` | The single nightly cron (`vercel.json`): backup, then pending-item expiry, then orphaned-upload cleanup, then the usage rollup and 30-day prune, then the mirror backstop, then the manual archive backfill; then the heartbeat ping |
| `src/lib/manuals/*` | The manual archive: `archive` (`archiveManual`), `steps` (`archiveManualStep`, `indexManualStep`), `start` (the one `workflow/api` import), `trigger` (`requestManualArchive`, never throws); manual text: `extract` (unpdf), `index-document`, `stored-bytes`, `digest`; manual search: `chunk` (`CHUNKER_VERSION`), `embed` (job `embed`), `passages` (the index step's second half), `search` (`searchManuals`, hybrid + RRF) |
| `src/lib/data/manual-documents.ts` | `manual_documents` / `manual_pages`: the one-transaction write, current-PDF lists for the step and backfill, editor states, tool-page contents, research's stored-text lookups |
| `src/lib/data/manual-chunks.ts` | `manual_chunks`: the one-transaction passage write, which documents need passages, the chat's view of a tool's manuals, Re-process, the `/admin/research` counts |
| `src/lib/capabilities/manuals.ts` / `src/lib/chat/tool-manuals.ts` | `search_manual` and its prompt (outline of the focused tool's searchable manuals); what the chat route loads to decide what is searched and what is attached |
| `src/app/admin/research/page.tsx` + `actions.ts` | **Manuals** (`tools.edit`): the state strip, the library table (`listManualLibrary`) and Re-process (`reprocessLibraryManual`) |
| `scripts/index-manuals.ts` | `npm run manuals:index` — the manual-text and passages backfill (tokens and cost printed) |
| `scripts/push-local-to-hosted.ts` / `src/lib/push-hosted/*` | `npm run data:push` — copy the local database and files up to a hosted deployment: `tables` (plan from the schema), `rows` (redact, rewrite URLs), `files` (local files, uploads, reuse), `copy` (one transaction), `migrations` (the schema check), `target-env` (the `--to` file), `run` |
| `src/workflows/archive-manuals.ts` | `archiveManuals(resourceIds)` — one step per resource |
| `src/lib/data/manual-archives.ts` / `src/lib/cron/manual-archive.ts` | The archive's key, stale-copy release and the nightly due list; the cron stage |
| `src/lib/import/*` | Bulk intake: the parsers and validation (pure), `service.ts` (starting an import), `extract.ts` / `suggest-names.ts` (the two model calls), `import-steps.ts` / `suggest-steps.ts` (steps), `research-queue.ts` (chunked Research selected) |
| `src/lib/data/bulk-imports.ts` / `research-allowances.ts` | `bulk_imports` and the rows it makes; setup allowances and `researchLimitFor` |
| `src/app/api/imports/route.ts`, `src/app/admin/intake/imports/` | **Import a list**, and the import review page with its server actions |
| `src/workflows/import-document.ts` / `suggest-names.ts` | Reading a document into rows; the Suggest names pass |
| `src/lib/db/schema/mirror.ts`, `src/lib/data/mirrors.ts` / `mirror-pages.ts` | `notion_mirrors` and `mirror_pages`; every claim (run, Sync now, coalesced push) is one conditional `UPDATE` |
| `src/lib/mirror/*` | The mirror: `notion-client` (raw fetch, throttle, 429), `token-crypto`, `credentials`, `notion-id`, `database-schemas`, `databases` (create / validate pasted ids), `source` (what changed), `properties` (pure row → Notion builders), `push`, `steps`, `start`, `trigger`, `connect` |
| `src/workflows/mirror-push.ts` | `mirrorPush(mirrorId)` and `mirrorPushAfterChange()` — the `"use workflow"` functions |
| `src/app/admin/mirror/` + `src/components/admin/Mirror*.tsx` | The settings page, its seven server actions, and the four islands (`MirrorConnect`, `MirrorMapping`, `MirrorStatus`, `MirrorControls`) |
| `test/fakes/notion-fake.ts` | The in-memory Notion every mirror test (and the E2E stub) talks to |
| `src/app/api/admin/revalidate/route.ts` | Cache invalidation (`tools.edit`, or `x-admin-secret` for session-less callers) |
| `src/components/ChatFab.tsx` / `src/components/chat/ChatPanel.tsx` | Chat UI. `ChatFab` is the launcher (the floating button on public pages only) and loads `ChatPanel` on demand: `useChat` and its transport, the docked `Sheet`; starter chips are the tool's own on its page (`ToolChatStarters` → `ChatLauncherContext`), else the generic three. Its parts live in `src/components/chat/` (`ChatMessage`, `ChatResponse` with manual citations, `ChatComposer`, `use-chat-attachments` for photo/list uploads, `use-dictation`, `AskAssistantButton`) on AI Elements in `src/components/ai-elements/` |
| `src/lib/starter-questions.ts` / `scripts/generate-starter-questions.ts` | A tool's assistant starter questions — the cleaning rules, and the backfill for tools that have none |
| `src/lib/tool-names.ts` / `scripts/backfill-display-names.ts` | A tool's display and official names — the display rules and guard, and the backfill that shortens imported names |
| `src/lib/tool-name-brand.ts` / `tool-name-choice.ts` / `display-name-rules.ts` / `data/tool-name-clash.ts` | Bare-brand refusal and category nouns; unique names with the distinguishing spec; the one rules text the prompts share; the `duplicate_name` read |
| `src/app/page.tsx`, `tools/[id]/page.tsx` | Gallery + tool detail |
| `src/app/product/` / `src/components/product/*` / `src/components/SiteFooter.tsx` | The product page and quick start (`/product`, `/product/quick-start`; identity spec amendment "Product page and quick start"): copy under `product` in the messages, screenshots and costs in `product-content.ts`, images and the walkthrough in `public/product/`; the site footer that links them |
