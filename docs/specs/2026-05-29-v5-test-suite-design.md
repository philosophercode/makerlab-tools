# v5 Comprehensive Test Suite — Design & Dispatch Plan

**Date:** 2026-05-29
**Target:** `v5/` (Next.js 16, React 19, TypeScript)
**Goal:** Add a comprehensive, fully-mocked, CI-friendly test suite — unit, integration, component/UI, and end-to-end — plus a runbook. No live external calls.

---

## 1. Decisions (locked)

| Decision | Choice |
|---|---|
| External services in tests | **Fully mocked everywhere.** No real Notion / Anthropic / Redis calls. Deterministic, offline, no API keys, no cost. |
| Unit/integration/UI runner | **Vitest** (`@vitejs/plugin-react`, `jsdom`) |
| Component testing | **React Testing Library** + `@testing-library/user-event` + `@testing-library/jest-dom` |
| HTTP mocking | **MSW** (Mock Service Worker) for Notion, Anthropic, Upstash REST |
| E2E | **Playwright** — app runs with **no Notion env vars** so it serves the built-in mock catalog; `/api/chat` intercepted at the network layer |
| CI / coverage gate | **None.** Tooling + tests + runbook only. (Coverage *reporter* is configured, but no threshold gate and no CI workflow.) |

---

## 2. Architecture & key constraints (read before writing tests)

The scout + source read surfaced these gotchas. Every agent must respect them:

1. **`server-only` import.** `src/lib/rate-limit.ts` does `import "server-only"`, which throws outside a server runtime. Vitest must alias `server-only` to an empty module (foundation handles this in `vitest.config.ts`).

2. **`next/cache`.** `catalog.ts` imports `cacheTag`/`cacheLife`; `admin/revalidate/route.ts` imports `revalidateTag`. These only work inside the Next build. Tests mock them with `vi.mock("next/cache", ...)`. Foundation provides a reusable factory in `test/mocks/`. The `"use cache"` *directive string* is harmless under esbuild (treated like `"use client"`).

3. **Mock-catalog fallback.** `getCatalogTools()` / `getCatalogTool(id)` return the built-in `src/components/mock-catalog.ts` data when `hasNotionCatalogEnv()` is false (i.e. any `NOTION_*` var missing), **and** on any thrown error during fetch. This is the backbone of fully-mocked tests:
   - Tests that exercise the **mock path**: ensure `NOTION_*` env is unset.
   - Tests that exercise the **real Notion path** (`notion.ts`): `vi.stubEnv` all 7 `NOTION_DB_*` + `NOTION_API_KEY`, then intercept `https://api.notion.com/v1/*` with MSW.

4. **Env stubbing.** `site-config.ts` reads `process.env.NEXT_PUBLIC_*` / `AUDIENCE` at **module load**. Tests that vary these must `vi.stubEnv(...)` then re-import the module (`vi.resetModules()` + dynamic `import()`).

5. **Chat route is hard to unit-test directly** — all helpers (`buildSystemPrompt`, `findUnit`, `attachManualsToFirstUserMessage`, etc.) are module-private and the tool `execute` fns are defined inline inside `POST`. **Strategy: mock `ai`'s `streamText`** to capture the `{ system, messages, tools }` it receives, then call `POST(req)` and assert on the captured args. The captured `tools.get_unit_details.execute(...)` / `tools.report_issue.execute(...)` can be invoked directly to test tool behavior. Also mock `@ai-sdk/anthropic` (`anthropic` model factory + `anthropic.tools.webFetch_20250910`).

6. **MCP route uses a real `McpServer`.** Don't mock it. POST real JSON-RPC envelopes (`initialize`, `tools/list`, `tools/call`) to the `POST` handler and assert the JSON responses. Catalog comes from the mock fallback (no Notion env). `transport` returns JSON (not SSE) because `enableJsonResponse: true`.

7. **Rate limiter is per-process in-memory** (`Map`) when Upstash env is unset. It's a singleton module — call `vi.resetModules()` between tests that need a clean window, or use distinct keys. The `rateLimitAsync` Upstash path only activates when **both** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set; mock `${URL}/pipeline` with MSW for those tests.

8. **Parallel-safety rule for dispatch:** only the **foundation agent** edits `package.json` and creates shared config/infra. Every other agent **only creates new test files** in its own slice and **never** runs `npm install`. This keeps the fan-out conflict-free.

---

## 3. Tooling & files the foundation agent creates

**Dev deps** (`v5/package.json`):
`vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@testing-library/dom`, `msw`, `@playwright/test`.

**Config / infra:**
- `v5/vitest.config.ts` — `jsdom` env, `@/` → `src/` alias, alias `server-only` → empty stub, `setupFiles: ["./vitest.setup.ts"]`, coverage (`v8`, reporter only — no thresholds), `exclude` the `e2e/` dir.
- `v5/vitest.setup.ts` — `import "@testing-library/jest-dom"`; start/stop the MSW server (`beforeAll`/`afterEach reset`/`afterAll`); `afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); })`.
- `v5/playwright.config.ts` — `webServer` boots `npm run dev` with `NOTION_API_KEY`/`NOTION_DB_*` **unset** and `reuseExistingServer: true`, `baseURL: http://localhost:3000`, `testDir: ./e2e`.
- `v5/test/msw/handlers.ts` + `server.ts` — MSW handlers for `api.notion.com/v1/databases/:id/query`, `/pages`, `/pages/:id`, `/file_uploads`, the Upstash `/pipeline` endpoint, and the Anthropic web-fetch host (as needed). Handlers return fixture pages and are overridable per-test via `server.use(...)`.
- `v5/test/fixtures/notion.ts` — raw `NotionPage` fixtures (tool/category/location/unit/resource/maintenance-log shapes matching `pageToX` parsers in `notion.ts`) and a `notionQueryResponse(pages, { hasMore })` helper for pagination tests.
- `v5/test/fixtures/catalog.ts` — ready-made `MakerLabTool` / `MakerLabUnit` objects for component tests.
- `v5/test/mocks/next-cache.ts` — factory returning `{ cacheLife: vi.fn(), cacheTag: vi.fn(), revalidateTag: vi.fn() }` for `vi.mock("next/cache", ...)`.
- `v5/test/utils/render.tsx` — RTL render helper wrapping components in `NextIntlClientProvider` with the `messages/en.json` catalog (needed by i18n-aware components).
- `v5/test/README.md` — short "how the harness fits together" note for the other agents (env stubbing patterns, MSW override pattern, the streamText-capture pattern).

**New `package.json` scripts:**
```jsonc
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

Foundation must end by running `npm install` and `npx vitest run` against **one trivial smoke test** it writes (e.g. `test/smoke.test.ts` asserting `1+1===3`→fix to 2) to prove the harness boots, then delete the smoke test or leave a real one.

---

## 4. The four layers & coverage

### Layer A — Unit (`src/lib`, `src/i18n`)
- **`catalog.ts`**: `hasNotionCatalogEnv` true/false; `getCatalogTools` mock-fallback (no env) and Notion path (env + MSW) incl. error→fallback; `getCatalogTool(id)` found / not-found / fallback-by-slug; `getCatalogStats` count; status derivation (`In Use` / all-`Offline` / training); `deriveTrainingLevel` (advanced/authorized keyword, training_required, default); `toCondition`; `resourceLinks` (url + files, skips `published === false`); `groupUnitsByTool`/`groupResourcesByTool`.
- **`notion.ts`**: each `pageToX` parser against fixtures (title/rich_text/select/multi_select/relation/checkbox/url/date/files extraction, header-case fallbacks like `["name","Name"]`); `multiSelectValue` comma-string fallback; `fileAttachments` external vs file URL + stale-host filtering (`pickFreshImageUrl` drops `airtableusercontent.com`); pagination via `next_cursor`; `429` retry-after path; `getNotionEnv` missing-var error; `getNotionEnvContract`; `resolveTools` category/location joins + defaults; `createMaintenanceLog` payload shape (`formatTicketDescription`, select/relation/date/file_upload props); `fetchAllTools` published-filter fallback chain.
- **`rate-limit.ts`**: `rateLimit` allow under limit → deny over limit → window reset after `windowMs`; `remaining` math; throws when Upstash configured (sync path); `rateLimitAsync` in-memory delegation; Upstash path (MSW `/pipeline`) allow/deny + fail-open on non-ok; `getClientIp` `x-forwarded-for` (first of list) / `x-real-ip` / `"unknown"`.
- **`site-config.ts`**: defaults when env unset; overrides when set (re-import after `stubEnv`).
- **`i18n/config.ts`**: `isSupportedLocale`, `getLocaleOption` fallback to `en`, `getDirection` (rtl for `ar`/`he`), `languageNameForLocale`.

### Layer B — Integration (API routes, MSW + mocks)
- **`/api/chat`**: 429 when rate-limited (assert before any model call); `streamText` (mocked) receives a `system` prompt containing the catalog + the locale section when `locale!=="en"`; `tools` wired (`get_unit_details`, `report_issue`, `web_fetch`); invoking captured `get_unit_details.execute` returns found/not-found shape; `report_issue.execute` calls `createMaintenanceLog` (mocked) and returns `success`/`ticket_id`, and error shape on throw; PDF manual collection caps at 3 / skips >10MB / non-PDF (mock `fetchAllResources` + global `fetch` for PDF bytes); response is a streamed `Response`.
- **`/api/mcp`**: `GET` → 405; missing/invalid bearer when `MCP_TOKEN` set → 401, valid → 200; open when unset; 429 over limit; real JSON-RPC `initialize` handshake; `tools/list` lists the 5 tools; `tools/call` for `list_tools` (+ category/location filter), `search_tools` (hit + miss), `get_tool_details` (found + `isError` not-found), `get_unit_details`, `get_maintenance_history`.
- **`/api/upload-notion`**: 429; 500 when `NOTION_API_KEY` unset; 400 invalid form / missing file / non-image / >18MB / empty; happy path two-stage flow (MSW: create session → send bytes) returns `file_upload_id`; 502 on create/send failure.
- **`/api/admin/revalidate`**: 503 when secret unset; 403 on wrong `x-admin-secret`; 200 + `revalidateTag("catalog", ...)` called (mocked) on correct secret.

### Layer C — Component / UI (RTL)
- **ToolCard** — renders name/category/training/status badge; links to `/tools/[slug]`.
- **GalleryShell** — renders grid from fixtures; search filters by name/tag/material; materials/location facet filtering; empty-state.
- **UnitsList** — renders units; status/condition badges; maintenance-history interaction/popup.
- **DetailShell** — hero, metadata, PPE, resources/links, units, markdown description.
- **ChatFab** — open/close; renders messages; submit calls `useChat` send (mock `@ai-sdk/react`'s `useChat`); shows assistant reply; passes `toolId`/`locale`.
- **LanguageSelector** — lists 12 locales; selecting sets `NEXT_LOCALE` cookie / calls the locale action (mock `src/i18n/actions`).
- **ThemeToggle** — toggles theme; persists to `localStorage`; reflects current state.
- **GlobalChrome / PrimaryNav** — nav links present and correct; brand lockup uses `siteConfig`; catalog stats shown.

### Layer D — E2E (Playwright, mock-catalog backend) — single agent
- Gallery loads, shows mock tools.
- Open a tool → detail page shows units + resources; deep-link `/tools/form-4`.
- Search / filter narrows the grid.
- ChatFab: open, type, send → mocked streamed reply (intercept `POST /api/chat` via `page.route` returning a UI-message stream chunk).
- Theme toggle persists across reload.
- Language switch updates visible chrome + `<html lang>`/`dir`.
- All nav links reachable; unknown tool slug → not-found.

### Layer E — Runbook
- `v5/TESTING.md`: how to run each layer, the mocking model, how to add a fixture, how to add an MSW override, env conventions, Playwright notes. References this design doc.

---

## 5. Dispatch plan (max parallelism)

**Phase 1 — blocking:** `Agent 0 · Foundation` (§3). Must finish and prove the harness boots before any other agent starts.

**Phase 2 — parallel fan-out** (all create only new files in their slice; none touch `package.json` or run `npm install`):

| # | Agent | Files owned |
|---|---|---|
| A1 | lib: catalog | `src/lib/catalog.test.ts` |
| A2 | lib: notion | `src/lib/notion.test.ts` |
| A3 | lib: rate-limit | `src/lib/rate-limit.test.ts` |
| A4 | lib: config+i18n | `src/lib/site-config.test.ts`, `src/i18n/config.test.ts` |
| B1 | api: chat | `src/app/api/chat/route.test.ts` |
| B2 | api: mcp | `src/app/api/mcp/route.test.ts` |
| B3 | api: upload-notion | `src/app/api/upload-notion/route.test.ts` |
| B4 | api: revalidate | `src/app/api/admin/revalidate/route.test.ts` |
| C1 | ui: cards/gallery | `src/components/ToolCard.test.tsx`, `GalleryShell.test.tsx` |
| C2 | ui: units/detail | `src/components/UnitsList.test.tsx`, `DetailShell.test.tsx` |
| C3 | ui: chat fab | `src/components/ChatFab.test.tsx` |
| C4 | ui: locale/theme | `src/components/LanguageSelector.test.tsx`, `ThemeToggle.test.tsx` |
| C5 | ui: chrome/nav | `src/components/GlobalChrome.test.tsx`, `PrimaryNav.test.tsx` |
| D | e2e (all specs) | `e2e/*.spec.ts` (single agent — avoids dev-server port contention) |
| E | runbook | `v5/TESTING.md` |

Each Phase-2 agent verifies its own work with `npx vitest run <its files>` (or `npx playwright test` for D) and reports pass/fail with output. They must not claim success without green output.
