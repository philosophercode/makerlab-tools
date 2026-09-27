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

Live at <https://makerlab-ai.vercel.app>. **This repository is the product
going forward** — new features, fixes and operations all happen here, under
the constitution and a spec per feature. Owned by the Cornell Tech MakerLAB
(Niti Parikh, Director; Luis Rodrigo Navarro, Assistant Director; Isaac
Steinberg, Tech Lead).

## Repository layout — two apps

| Path | Version | Status | Data layer |
|---|---|---|---|
| `v5/` | v5 | **Live — work here** | Postgres (`DATABASE_URL`); Notion read only by the one-time import |
| `src/` (root) | v4 | Legacy, frozen | AirTable (`AIRTABLE_TABLE_*`) |

**Default to `v5/` unless a task explicitly names v4.** The root app is retained
for reference and receives nothing; a pending change (PR #79) moves `v5/` to
the repository root and removes v4. `v5/` has its own `package.json`, test
suite, and `v5/AGENTS.md` with app-level detail — read that file too when
working there.

## Documents

| Document | What it's for |
|---|---|
| `docs/specs/README.md` | Status of every spec: what is built, what is open |
| `docs/architecture-guide.md` | How the app works and why, for whoever inherits it |
| `docs/deploy.md` | Local setup in stages, then a Vercel deployment step by step |
| `docs/handover.md` | Operating it: accounts, routine tasks, backups, incidents |
| `docs/v5-plan.md` | The original v5 plan (historical — Notion era); §9 is the early long-term vision |
| `docs/specs/` | Per-feature design specs |
| `v5/AGENTS.md` | App-level detail for `v5/`: stack, key files, gotchas |
| `v5/TESTING.md` | Test suite runbook |
| `docs/mcp.md` | User guide: connecting Claude, ChatGPT, Codex and other MCP clients (sign in with Google by default; tokens as the fallback) |
| `docs/MakerLab_design/DESIGN.md` | The "Architectural Brutalism + Blueprint Archive" design system |
| `docs/isam-2026-demo/` | ISAM 2026 demo abstract and figures. `abstract-v1.*` is the frozen submitted record; edit `abstract-v1.1.html`. Dates and open items in `DECISIONS.md` |

## Stack (v5)

Next.js 16 (App Router, RSC, `cacheComponents`), React 19, TypeScript, Tailwind
CSS 4. AI via Vercel AI SDK v6 through the **Vercel AI Gateway** (Gateway-only
as of the 2026-09-23 migration — no direct provider key; see `v5/AGENTS.md` and
`docs/specs/2026-09-23-gateway-models-and-product-images-design.md`). MCP via
`@modelcontextprotocol/sdk`. `next-intl` across 12 locales, cookie-based.
Vitest + React Testing Library + MSW + Playwright. Deployed on Vercel.

## Commands

Run from `v5/`:

```bash
npm run dev          # dev server (:3000)
npm run build        # runs db:migrate, then production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (unit + integration + component)
npm run test:e2e     # playwright (needs: npx playwright install chromium)
npm run test:all     # lint + typecheck + vitest + playwright
```

`npm run test:all` must pass before any merge. It needs no credentials — an
in-process PGlite database (seeded with demo data) covers Postgres and MSW
covers every other external service.

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
- `DATABASE_URL` unset serves an in-process PGlite database seeded with demo
  data — great for tests and a fresh clone, but check that it's actually set
  in a real deploy before concluding the catalog is empty. Unlike the old
  Notion fallback, a **configured but unreachable** Postgres never falls back
  to demo data — it fails toward stale cache or an explicit error state
  (constitution Article 4).
- Scripts under `v5/scripts/` run via `node --experimental-strip-types`. They are
  migration and maintenance tools, not part of the app build.
