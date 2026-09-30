# Performance

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Images, caching and page weight (performance, migration `0021`)

Tool photos were ~99% of every page's bytes (the home page was 27 MB on a
phone: 1–2.5 MB original PNGs for 180px cards). Every image is now served at
the size it is shown. The rules:

- **Thumbnails, never originals.** A tool photo has pre-rendered widths
  (160 / 320 / 640 px, never enlarged) in **AVIF and WebP**, named
  `${base}.${width}.${format}` (`src/lib/images/thumbnail-urls.ts`), rendered
  by `sharp` with **resize only** — no crop, pad or redraw, alpha and margins
  kept (`src/lib/images/thumbnails.ts`), so a product keeps the framing
  approval gave it. `ToolImage` draws them as a `<picture>` with the caller's
  `sizes`, `width`/`height` for the aspect ratio, lazy by default; the tool
  page's hero and the gallery's first row are eager (`priority="high"` for the
  first two cards and the hero — `fetchpriority="high"` — `cardImagePriority`).
  `MakerLabTool.thumbnails` carries them; `toolImage()` in
  `src/lib/data/catalog.ts` picks them. A tool with no photo is `imageSrc: ""`
  (the empty plate, no request) — never a guessed `/tool-images/<name>.png`.
- **Bundled photos** (`public/tool-images/*.png`, kept as sources): thumbnails
  are committed under `public/tool-images/thumbs/` with a **content hash** in
  the name, listed in the generated `src/lib/data/bundled-tool-thumbnails.ts`,
  and served `Cache-Control: public, max-age=31536000, immutable`
  (`next.config.ts` `headers()`). **Re-run `npm run thumbnails:bundled`
  whenever a PNG there is added, replaced or removed**, and commit both;
  `bundled-tool-thumbnails.test.ts` fails until you do (`-- --check` is the
  same check). It never deletes: files no photo names any more are listed as
  stale for somebody to remove.
- **Blob photos** (uploads, research and product images): `attachments.thumbnails`
  (jsonb, migration `0021`) holds `{ base, widths, width, height }`; the files
  sit beside the original at `thumbs/<original pathname>.<hash>.<w>.<fmt>`,
  public, cached a year (`src/lib/images/attachment-thumbnails.ts`). They are
  written **after the response** (`scheduleThumbnails`, `after()`) by
  `POST /api/uploads` (public images), intake approval and accepted refresh
  covers, which then drop the catalogue/project caches. Rows from before
  this, or whose run failed: **`npm run thumbnails:backfill`** (dry run by
  default; `-- --apply [--limit N]`; target = `DATABASE_URL`, else
  `PGLITE_DATA_DIR`; store = `blobMode()`), then `POST /api/admin/revalidate`.
  Until a row has thumbnails, `ToolImage` falls back to `next/image` on the
  original (optimized, AVIF/WebP, 31-day `minimumCacheTTL`; `/api/dev-blob/`
  URLs unoptimized). The daily sweep deletes an orphan's thumbnails with it;
  `data:push` nulls them in the hosted copy (backfill there).
- **Not in the first load:** the assistant (`ChatPanel` — AI SDK, sheet,
  composer) mounts the first time the chat opens (`ChatFab`, preloaded on
  hover/focus of the button); the ⌘K dialog (`CommandPaletteDialog`, cmdk)
  the first time the palette opens; the gallery's table view (`GalleryTable`,
  TanStack Table) when somebody switches to it. Each is kept mounted once
  loaded. The home page sends `toGalleryTool()` per tool, not the whole
  `MakerLabTool`.
- **Fonts** are two faces per family split by `unicode-range`
  (`src/app/fonts.ts`): the preloaded Latin face and an Extended face (Latin
  Extended, Cyrillic) fetched only when a page shows those characters. Draw a
  language's native name in the system font (the language picker does), or
  every page downloads the Extended faces.
- **Caching:** public pages are partial prerenders; the catalogue is
  `"use cache"` + `cacheTag("catalog")`, projects `"projects"`, and a tool
  page's maintenance history also `"maintenance"`, which filing or working a
  ticket drops (`invalidateMaintenance`, shared with the kiosk count) without re-reading the
  catalogue. The body still renders per request because the locale is a
  cookie (`LocalizedTree`); making public pages fully static needs locale
  routing that does not read the cookie in the page.
- **Measure** with `npx -y lighthouse@12` against `next build && next start`
  (mobile and `--preset=desktop`). The demo seed has two tools, so a
  representative run seeds the bundled photos' names as tools locally
  (not committed).

## Performance conventions (performance plan, 2026-09-28)

What keeps pages and the assistant quick. Each is guarded by a test; break one
and say why in the PR.

- **Client translations are sent per layout** (`src/i18n/client-messages.ts`).
  The root `NextIntlClientProvider` sends only `PUBLIC_CLIENT_MESSAGES` (the
  public namespaces plus the few `admin.*` subtrees the header, ⌘K palette,
  chat cards and Edit control show staff); `app/admin/layout.tsx` adds `admin`
  and `app/account`, `app/oauth` and `app/mcp` layouts add `account`, through
  `ScopedMessages` → the client `MessagesScope`, which merges onto the
  parent's messages. Server components read everything with
  `getTranslations`. **A client component that uses a new namespace needs it
  listed there**: `client-messages.test.ts` reads every client component's
  `useTranslations` calls and names the key its layout does not send.
- **The chat's code loads on demand** (from #97; see "Images, caching and
  page weight" below): `ChatFab` is the launcher, `ChatPanel` is loaded with
  `React.lazy` on the first open, preloaded on pointer/focus of the button and
  once the page has been idle for a few seconds (not with Save-Data, not on
  `/kiosk`). `ChatMessage` lazy-loads its cards (intake table, proposals,
  actions, imports). Never import `ai` / `@ai-sdk/react` from a component
  outside `ChatPanel`. `useChat` runs with `experimental_throttle: 50` and
  `ChatMessage` is memoised (`ChatPanel.perf.test.tsx`).
- **The chat prompt is stable first, per-request last**
  (`capabilities/chat-adapter.ts`): the intro, `LAB_CONTEXT` (#101), every
  capability's `promptFragment` (the `#cite-<ref>` rules of #102 among them), the reading and citing rules, then `# This conversation`
  with the language, the focused tool and its resources, and every
  capability's optional `conversationFragment` (the signed-in reporter's
  name, the focused tool's manual outlines, a curation record); the route
  appends attached manuals, the page context and proposal outcomes after it.
  **A `promptFragment` must not vary by caller, page or locale** — only by
  role — or the provider's prefix cache misses; put per-request text in
  `conversationFragment`. The catalog listing and the linking rules are the
  catalog capability's and appear once. "What do you have" is answered from
  the listing, not `list_tools`.
- **Chat call options** come from `chatProviderOptions()` (`ai/models.ts`):
  `openai.reasoningEffort` `low` (`MODEL_CHAT_REASONING`: `default` sends
  none, or `none`/`minimal`/`low`/`medium`/`high`) and `openai.promptCacheKey`
  `makerlab-chat-v1` (`MODEL_CHAT_CACHE_KEY`, `off` sends none; bump the
  suffix when the stable prompt changes shape), plus the tier. The evals pass
  the same options — run `npm run eval` after changing either.
- **The chat route waits on as little as possible**: identity and the body
  together; rate limit, page context, outcomes, catalogue, focused tool and
  curation in one `Promise.all`; manual outlines and resources together; the
  manual PDFs fetched **inside the stream**, in parallel, and kept for ten
  minutes per URL (`chat/manual-pdf-cache.ts`; tests call
  `clearManualPdfCache()`). The real fix for PDF latency is processing the
  manuals: after deploying, run `npm run manuals:index` against production so
  `search_manual` answers and nothing is attached.
- **Polling is `usePoll(tick, ms, active)`** (`components/admin/use-poll.ts`):
  ticks are skipped while `document.hidden`, one fires when the tab is shown
  again after a missed one, and an async tick is never overlapped. Never write
  a bare `setInterval(router.refresh)`.
- **Who is asking, once.** `resolveIdentityFromHeaders` is wrapped in React
  `cache()`: layouts and pages may each call it and pay for one session read
  per request. In the browser, `loadSharedIdentity()` / `useSharedIdentity()`
  (`lib/auth/identity-store.ts`) share one `/api/identity` request per page
  load between the header, the palette, the Edit control and the project form
  — never call `fetchIdentity` from a component.
- **List reads are list-shaped.** The gallery gets `GalleryTool`
  (`toGalleryTool`, from #97); the intake list `listIntakeQueueSummaries` (no research blobs, imports filtered
  in SQL); the refresh list no research; the `/admin` inventory tile
  `countInventory` (one statement; a parity test ties it to
  `listInventoryRows`). The admin palette scope sends only the drafts
  (`getDraftPaletteTools`, cached under `catalog`), loaded in its own Suspense
  boundary, so `AdminGate` never waits on it. The refresh picker reads its
  tools when it opens (`loadRefreshPickerTools`).
- **Editor saves are one round trip.** `saveTool` and the photo actions answer
  with the tool as it now stands (`inventory/fresh-editor.ts`), and `saveTool`
  re-renders `/admin/inventory` only when a column the table shows changed.
  Mirror pushes run after the response (`mirror/after-response.ts`).
- **Every page has a loading state shaped like it.** Public routes with
  dynamic data have a `loading.tsx` (`system/PublicPageLoading`: `tool`,
  `cards`, `page`); every admin page folder has one with an
  `AdminPageLoading shape` (`tiles`, `table`, `detail`, `page`).
- **Function traces stay small** (`next.config.ts`
  `outputFileTracingExcludes`): `public/`, local data folders, TypeScript
  sources, docs, tests and the projects seed bundle (`data/`) never ship in a
  function, and PGlite — loaded with
  `import()` in `db/client.ts` — is left out when the build has
  `DATABASE_URL`. A function that needs a file at runtime must not live under
  an excluded glob.
- **Manual search uses its indexes** (`manuals/search.ts`): visibility is a
  per-document CTE, full text goes through GIN, the part-number regex runs
  only on GIN candidates, and an unscoped vector leg reads HNSW with
  `hnsw.ef_search` raised in its own transaction; a scoped one stays exact.
  Never reference a CTE holding passages from more than one place.
