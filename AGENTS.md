# AGENTS.md — MakerLab Tools

Repository-level guidance for AI agents and humans. This is the canonical entry
point; `CLAUDE.md` points here.

## What this is

A digital inventory and discovery system for makerspace equipment: browse and
search a tool catalog, view tool detail pages, chat with a tool-aware AI
assistant that can look up units and file maintenance tickets, and an MCP
endpoint exposing the catalog to external agents. White-labelled via env vars.

Deployed at the Cornell Tech MakerLAB over ~100 machines, and the subject of an
accepted ISAM 2026 demo paper.

> [!IMPORTANT]
> **This repository is in maintenance mode.** v5 is the live Cornell Tech
> deployment and stays on Notion. Active development continues in a separate
> repository — see below. Changes here should be fixes and operational
> improvements, not new architecture.

## Repository layout — two apps

| Path | Version | Status | Data layer |
|---|---|---|---|
| `v5/` | v5 | **Live — work here** | Notion (`NOTION_DB_*`) |
| `src/` (root) | v4 | Legacy, frozen | AirTable (`AIRTABLE_TABLE_*`) |

**Default to `v5/` unless a task explicitly names v4.** The root app is retained
for reference and receives nothing. `v5/` has its own `package.json`, test
suite, and `v5/AGENTS.md` with app-level detail — read that file too when
working there.

## Successor project

Development of the next generation happens in **`philosophercode/blueprint`**
(private), which rebuilds this system on Postgres with a built-in admin surface,
sign-in, and a self-hosted deployment story. This repository is unaffected by
that work until a migration is offered.

Three branches here hold finished work relevant to the successor and worth
merging or porting before they rot:

| Branch | Contains |
|---|---|
| `philosophercode/chat-inventory-intake` | Capability registry + AI inventory intake. Up to date with `main`. |
| `philosophercode/projects-gallery` | Student projects gallery, read and submit. Behind `main`; needs a rebase. |
| `philosophercode/isam-2026-demo-abstract` | The ISAM submission. `abstract-v1.*` is the frozen submitted record. |

## Documents

| Document | What it's for |
|---|---|
| `docs/v5-plan.md` | v5 architecture; **§9 is the long-term vision** |
| `docs/specs/` | Per-feature design specs |
| `v5/AGENTS.md` | App-level detail for `v5/`: stack, key files, gotchas |
| `v5/TESTING.md` | Test suite runbook |
| `docs/MakerLab_design/DESIGN.md` | The "Architectural Brutalism + Blueprint Archive" design system |
| `docs/isam-2026-demo/` | Conference abstract and figures |

## Stack (v5)

Next.js 16 (App Router, RSC, `cacheComponents`), React 19, TypeScript, Tailwind
CSS 4. AI via Vercel AI SDK v6 → Claude. MCP via `@modelcontextprotocol/sdk`.
`next-intl` across 12 locales, cookie-based. Vitest + React Testing Library +
MSW + Playwright. Deployed on Vercel.

## Commands

Run from `v5/`:

```bash
npm run dev          # dev server (:3000)
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (unit + integration + component)
npm run test:e2e     # playwright (needs: npx playwright install chromium)
npm run test:all     # lint + typecheck + vitest + playwright
```

`npm run test:all` must pass before any merge. It needs no credentials — the
mock catalog and MSW cover every external service.

## Conventions

- `@/` import alias → `src/`
- Server components by default; `"use client"` only when needed
- Server-only modules import `"server-only"`
- Theming via CSS variables (`--primary`, `--background`), never hardcoded colors
- All branding strings from `siteConfig` (`@/lib/site-config`)
- User-facing text through `next-intl` — 12 locales, all message files updated together
- Every API route rate-limited by IP before expensive work
- Tests colocated as `*.test.ts(x)` next to their source

## Gotchas

- `cacheComponents` is enabled, so API routes **cannot set `runtime`** — they use
  the default Node runtime.
- The in-memory rate limiter is a per-process singleton and resets on cold start.
  Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set.
- The mock-catalog fallback triggers when **any** Notion env var is missing *or* a
  fetch throws. Great for tests; means a misconfigured deploy fails soft and
  silently serves mock data. Check the logs before concluding the catalog is empty.
- Scripts under `v5/scripts/` run via `node --experimental-strip-types`. They are
  migration and maintenance tools, not part of the app build.
