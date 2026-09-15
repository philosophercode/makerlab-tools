# AGENTS.md — MakerLab Tools v5

Guidance for AI agents (and humans) working in the **v5** app. This is the
active application. Everything below is scoped to the `v5/` directory.

> [!IMPORTANT]
> The **root `CLAUDE.md` describes v4** — an AirTable-backed app with
> `AIRTABLE_TABLE_*` env vars. **That does not apply to v5.** v5's data layer is
> **Postgres** (`DATABASE_URL`), not Notion and not AirTable. When working in
> `v5/`, follow this file, not the root v4 doc.

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

## Data layer — Postgres (not Notion, not AirTable)

**Postgres is the source of truth (constitution Article 7).** Neon Postgres,
provisioned through the Vercel Marketplace, reached through Drizzle ORM.
`DATABASE_URL` set → Neon. `DATABASE_URL` unset → an in-process PGlite
database, migrated and seeded with demo data on first use (two tools: "Form
4", "Trotec Speedy 400"), so a fresh clone, local dev, and the whole test
suite run with no credentials and no network. See `.env.example` for the full
variable list.

- `src/lib/db/client.ts` — the one entry point: `getDb()` (a Drizzle handle),
  `dataSubstrate()` (`"neon" | "pglite-demo"`), `pingDb()` (throws
  `DbUnavailableError`), `resetDbForTests()`.
- `src/lib/db/schema/index.ts` — tables and vocabulary constants (stored
  snake_case, e.g. `in_use`; display text is derived, never stored).
- `src/lib/catalog.ts` — orchestration: fetch + join + derive `MakerLabTool`s
  from Postgres, cached with `cacheTag("catalog")` / `cacheLife("minutes")`.
- `src/lib/data/*.ts` — the query modules underneath: `catalog.ts`,
  `projects.ts`, `maintenance.ts`, `resources.ts`, plus `uuid.ts` (the shape
  guard every untrusted id passes before it reaches a uuid column) and
  `notion-ids.ts`. Relative imports with `.ts` extensions, no `@/` alias, no
  `"server-only"` — `scripts/` loads them under plain Node.
- **Notion is read only by the one-time import** (`npm run import:notion`).
  No request path reads Notion. A one-way mirror (app → an admin's own Notion
  workspace) is a later phase, not built yet.
- **The three writes still on Notion address pages, not rows.** A correction,
  a maintenance ticket and a project submission create Notion pages whose
  `relation` properties need *Notion page ids*, while everything the app hands
  around is now a Postgres uuid. `src/lib/data/notion-ids.ts` translates
  through `notion_page_id`, and a row that has none is written without the
  relation rather than with an id Notion would reject — a ticket a human has
  to link by hand beats a ticket that never arrived (Article 4). It goes away
  with those writes in Phase 3.
- **Files** (tool images, manuals, project photos) live in **Vercel Blob**,
  not Notion attachments — see `next.config.ts`'s `images.remotePatterns`.
- **Failing toward stale, not wrong (Article 4).** `DATABASE_URL` unset serves
  the PGlite demo seed with `DemoDataBanner` shown. `DATABASE_URL` set but
  unreachable never falls back to demo or invented data — cached pages keep
  serving and an uncached read renders the error state.

## Key files

| Path | Purpose |
|---|---|
| `src/lib/site-config.ts` | White-label branding (env-driven, all have defaults) |
| `src/lib/db/client.ts` | `getDb()`, `dataSubstrate()`, `pingDb()` — the one entry point to Postgres/PGlite |
| `src/lib/notion.ts` | Notion API client — write paths still on Notion until Phase 3 (tickets, corrections, project submission); no request path reads it |
| `src/lib/catalog.ts` | Catalog orchestration + cache, reading Postgres |
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

Comprehensive, **fully-mocked** suite (no live Notion/Anthropic/Redis/Postgres —
Article 3). Run everything with one command:

```bash
npm run test:all     # lint + typecheck + vitest + playwright
```

Or individually: `npm test` (Vitest: unit + integration + component),
`npm run test:e2e` (Playwright — run `npx playwright install chromium` once
first), `npm run test:coverage`.

- **Vitest** (jsdom) + React Testing Library + MSW; **Playwright** for E2E.
- Catalogue reads run against an in-process PGlite database seeded with demo
  data (`getCatalogTools()` needs no Notion env at all); write paths still on
  Notion (§ above) are covered with `vi.stubEnv` + MSW as before.
- E2E boots its own server on **port 3100** with `DATABASE_URL` unset (PGlite demo catalog) and intercepts `/api/chat` — it never touches your `:3000` dev server or real services.
- Tests are colocated (`*.test.ts(x)` next to source); shared harness in `test/`.
- **Read these before writing tests:** `TESTING.md` (runbook), `test/README.md` (harness internals + the `streamText`-capture and env-stubbing patterns), and `docs/specs/2026-05-29-v5-test-suite-design.md` (design + coverage matrix). The harness deps/scripts are already wired — don't hand-edit `package.json` for them.

## Commands

```bash
npm run dev          # dev server (:3000)
npm run build        # runs db:migrate, then production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test:all     # full test suite
```

## Gotchas

- Because `cacheComponents` is enabled, API routes **cannot set `runtime`** — they use the default Node runtime.
- The in-memory rate limiter is a per-process singleton; it resets on cold start (fine for abuse prevention). Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set.
- Python scripts under `scripts/` use Node with `--experimental-strip-types`; they are migration/maintenance tools, not part of the app build.
