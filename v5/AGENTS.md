# AGENTS.md — MakerLab Tools v5

Guidance for AI agents (and humans) working in the **v5** app. This is the
active application. Everything below is scoped to the `v5/` directory.

> [!IMPORTANT]
> The **root `CLAUDE.md` describes v4** — an AirTable-backed app with
> `AIRTABLE_TABLE_*` env vars. **That does not apply to v5.** v5's data layer is
> **Notion** (`NOTION_DB_*`). When working in `v5/`, follow this file, not the
> root v4 doc.

## What this is

A digital inventory + discovery app for makerspace equipment: browse/search a
tool gallery, view tool detail pages, chat with an AI assistant (tool-aware,
can look up units and file maintenance tickets), and an MCP endpoint exposing
the catalog to external agents. White-labelled via env vars.

## Stack

- **Next.js 16** (App Router, React Server Components, `cacheComponents` enabled), **React 19**, **TypeScript**, **Tailwind CSS 4**.
- **i18n:** `next-intl`, **12 locales**, cookie-based (`NEXT_LOCALE`) — no URL-prefix routing. Config in `src/i18n/config.ts`; messages in `messages/*.json`.
- **AI:** Vercel **AI SDK v6** (`ai`, `@ai-sdk/react`) with `@ai-sdk/anthropic` → `claude-sonnet-4-6`. Markdown via `react-markdown` + `remark-gfm`.
- **MCP:** `@modelcontextprotocol/sdk` (HTTP JSON-RPC server at `/api/mcp`).
- **Validation:** `zod`. **Search:** `match-sorter` (fuzzy, ranked).

## Data layer — Notion (not AirTable)

Seven Notion databases, IDs supplied via env (`NOTION_DB_TOOLS`, `_CATEGORIES`,
`_LOCATIONS`, `_UNITS`, `_RESOURCES`, `_MAINTENANCE_LOGS`, `_FLAGS`) plus
`NOTION_API_KEY`. See `.env.example` for the full list and defaults.

- `src/lib/notion.ts` — server-only Notion REST client: page→record parsers, pagination, 429 retry, `createMaintenanceLog`. Tolerant of snake_case **and** Title-case property names.
- `src/lib/catalog.ts` — orchestration: fetch + join + derive `MakerLabTool`s, cached with `cacheTag("catalog")` / `cacheLife("minutes")`.
- **Mock-catalog fallback (important):** `getCatalogTools()` / `getCatalogTool(id)` return the built-in `src/components/mock-catalog.ts` data whenever `hasNotionCatalogEnv()` is false (**any** Notion env var missing) **or** a fetch throws. So the app — and the whole E2E/test suite — runs with no Notion creds.

## Key files

| Path | Purpose |
|---|---|
| `src/lib/site-config.ts` | White-label branding (env-driven, all have defaults) |
| `src/lib/notion.ts` | Notion API client (server-only) |
| `src/lib/catalog.ts` | Catalog orchestration + cache + mock fallback |
| `src/lib/rate-limit.ts` | In-memory (or Upstash) sliding-window limiter |
| `src/lib/types.ts` / `src/components/catalog-types.ts` | Notion record types / resolved view types |
| `src/app/api/chat/route.ts` | Claude chat: streaming, tools (`get_unit_details`, `report_issue`, `web_fetch`), PDF manual attach |
| `src/app/api/mcp/route.ts` | MCP JSON-RPC server (5 tools), bearer-token auth |
| `src/app/api/upload-notion/route.ts` | Image upload proxy → Notion file_uploads |
| `src/app/api/admin/revalidate/route.ts` | Cache invalidation (`x-admin-secret`) |
| `src/components/ChatFab.tsx` | Chat UI (`useChat`, citations stripped, photo upload) |
| `src/app/page.tsx`, `tools/[id]/page.tsx` | Gallery + tool detail |

## Conventions

- Use the `@/` import alias (→ `src/`).
- Server components by default; add `"use client"` only when needed.
- Server-only modules import `"server-only"` (e.g. `rate-limit.ts`).
- Theme/brand via **CSS variables** (`--primary`, `--background`, …) — `[data-theme="light|dark"]` on `<html>`, never hardcoded colors.
- All branding strings come from `siteConfig` (`@/lib/site-config`).
- Every API route is **rate-limited by IP** before expensive work.
- Maintenance tickets are always written in **English** even when the chat replies in another locale.

## Testing

Comprehensive, **fully-mocked** suite (no live Notion/Anthropic/Redis). Run
everything with one command:

```bash
npm run test:all     # lint + typecheck + vitest + playwright
```

Or individually: `npm test` (Vitest: unit + integration + component),
`npm run test:e2e` (Playwright — run `npx playwright install chromium` once
first), `npm run test:coverage`.

- **Vitest** (jsdom) + React Testing Library + MSW; **Playwright** for E2E.
- E2E boots its own server on **port 3100** with `NOTION_*` unset (mock catalog) and intercepts `/api/chat` — it never touches your `:3000` dev server or real services.
- Tests are colocated (`*.test.ts(x)` next to source); shared harness in `test/`.
- **Read these before writing tests:** `TESTING.md` (runbook), `test/README.md` (harness internals + the `streamText`-capture and env-stubbing patterns), and `docs/superpowers/specs/2026-05-29-v5-test-suite-design.md` (design + coverage matrix). The harness deps/scripts are already wired — don't hand-edit `package.json` for them.

## Commands

```bash
npm run dev          # dev server (:3000)
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test:all     # full test suite
```

## Gotchas

- Because `cacheComponents` is enabled, API routes **cannot set `runtime`** — they use the default Node runtime.
- The in-memory rate limiter is a per-process singleton; it resets on cold start (fine for abuse prevention). Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set.
- Python scripts under `scripts/` use Node with `--experimental-strip-types`; they are migration/maintenance tools, not part of the app build.
