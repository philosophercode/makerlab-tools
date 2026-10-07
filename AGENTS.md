# AGENTS.md — MakerLab Tools

Guidance for AI agents and humans working in this repository. This is the
canonical entry point; `CLAUDE.md` points here.

## What this is

A digital inventory + discovery app for makerspace equipment: browse/search a
tool gallery, view tool detail pages, chat with an AI assistant (tool-aware,
can look up units and file maintenance tickets), and an MCP endpoint exposing
the catalog to external agents. White-labelled via env vars.

Deployed at the Cornell Tech MakerLAB over ~100 machines, and the subject of an
accepted ISAM 2026 demo paper.

Live at <https://makerlab-ai.vercel.app>. **This repository is the product** —
new features, fixes and operations all happen here, under the constitution and
a spec per feature. Owned by the Cornell Tech MakerLAB (Niti Parikh, Director;
Luis Rodrigo Navarro, Assistant Director; Isaac Steinberg, Tech Lead).

The app is the repository root. Its data layer is **Postgres**
(`DATABASE_URL`), not Notion and not AirTable. The older AirTable-backed v4 app
was removed from the tree; the tag `v4-final` keeps it. Dated specs written
before the move still show paths with the old `v5/` prefix.

## Documents

| Document | What it's for |
|---|---|
| `README.md` | Overview and quick start |
| `docs/specs/README.md` | Status of every spec: what is built, what is open |
| `docs/architecture-guide.md` | How the app works and why, for whoever inherits it |
| `docs/deploy.md` | Local setup in stages, then a Vercel deployment step by step |
| `docs/handover.md` | Operating it: accounts, routine tasks, backups, incidents |
| `docs/operations.md` | Monitoring, backups and restore |
| `docs/v5-plan.md` | The original v5 plan (historical — Notion era); §9 is the early long-term vision |
| `docs/specs/` | Per-feature design specs |
| `docs/architecture/` | The app in detail, area by area (index below) |
| `TESTING.md` | Test suite runbook |
| `docs/assistant.md` | What the assistant can do, by role |
| `docs/mcp.md` | User guide: connecting Claude, ChatGPT, Codex and other MCP clients (sign in with Google by default; tokens as the fallback) |
| `docs/MakerLab_design/DESIGN.md` | The "Architectural Brutalism + Blueprint Archive" design system |
| `docs/isam-2026-demo/` | ISAM 2026 demo abstract and figures. `abstract-v1.*` is the frozen submitted record; edit `abstract-v1.1.html`. Dates and open items in `DECISIONS.md` |

## Stack

- **Next.js 16** (App Router, React Server Components, `cacheComponents` enabled), **React 19**, **TypeScript**, **Tailwind CSS 4**.
- **i18n:** `next-intl`, **12 locales**, cookie-based (`NEXT_LOCALE`) — no URL-prefix routing. Config in `src/i18n/config.ts`; messages in `messages/*.json`.
- **AI:** Vercel **AI SDK v6** (`ai`, `@ai-sdk/react`) through the **Vercel AI Gateway** (`@ai-sdk/gateway`) — the *only* model path (gateway spec 2026-09-23: `ANTHROPIC_API_KEY`, `@ai-sdk/anthropic` and the direct-provider `src/lib/model.ts` are retired and removed). Every model call names a **job**, not a model — `chat`, `researchSearch`, `researchRead`, `imageRank`, bulk intake's `importParse` and `nameSuggest` (`MODEL_IMPORT_PARSE`, `MODEL_NAME_SUGGEST`, both flex), the display-name backfill's `displayName` (`MODEL_DISPLAY_NAME`, flex), the description shortener's `descriptionShorten` (`MODEL_DESCRIPTION_SHORTEN`, flex), the manual eval questions' `evalQuestions` (`MODEL_EVAL_QUESTIONS`, flex; `MANUAL_EVAL_QUESTIONS` per manual, default 4, `0` off; manual text spec amendment 2026-10-07), the quick report form's `reportTriage` (`MODEL_REPORT_TRIAGE`, flex; no tools, the student's words fenced, and no answer files the report as written; quick report spec), the embedding job `embed` (`openai/text-embedding-3-small` at 512 dimensions, manual search — manual text spec phase 2), the scanned-manual OCR job `ocr` (`MODEL_OCR`, flex, run only by `manuals:index`) and the reranking job `rerank` (`cohere/rerank-v4-fast`, `MODEL_RERANK`, `off` disables it — phase 3) — resolved by `src/lib/ai/models.ts`'s `MODEL_JOBS`, each with a code default (`openai/gpt-6-luna` for every language job — chat passed the §10 eval gate once its prompt was tuned, gateway spec amendment "Chat prompt tuning for Luna") and one `MODEL_<JOB>` env override. Each job also names a Gateway **service tier** — `flex` for the background jobs (research search/read, image ranking, the starter-question backfill), none for chat — sent by `providerOptionsFor(job)` and overridden by `MODEL_<JOB>_TIER` (`default`/`flex`/`priority`; amendment "Manuals as text and flex tier for research"). Research's read step gives a manual PDF as **text**, not a file part (`RESEARCH_ATTACH_PDFS = false` in `intake/limits.ts`) — the lab's own extraction first (a stored manual, or the downloaded PDF extracted in memory: outline plus the pages richest in specs), the search's captured copy only as the fallback (manual text spec, phase 1); chat answers from a processed manual with `search_manual` and attaches only the manuals not yet processed (phase 2). There is **no image model**: the `imageClean` redraw was retired on 2026-09-23 because it altered product labels (spec amendment "No generative redraw"); background removal is a deterministic cutout in code. Web search is `gateway.tools.exaSearch` (Exa, provider-executed — one request leaves our process regardless of how many search legs the Gateway runs); reading a specific page is `read_page`, our own capability tool over `src/lib/web/*`'s SSRF-guarded fetch, not a provider tool. Auth is `AI_GATEWAY_API_KEY` when set, else the deployment's own Vercel OIDC token — production sets neither key nor a fallback, only the Gateway. Markdown via `react-markdown` + `remark-gfm` on pages (`system/Markdown`) and `streamdown` in the chat (raw HTML off, UI system phase 5b).
- **MCP:** `@modelcontextprotocol/sdk` (stateless HTTP JSON-RPC server at `/api/mcp`, and `/api/mcp/signed-in` for OAuth clients) — see `docs/architecture/mcp-access.md`.
- **Validation:** `zod`. **Search:** `match-sorter` (fuzzy, ranked).

## Architecture reference

Detail that used to live in this file is in `docs/architecture/`, moved verbatim.
Read the file for the area you are changing before you change it.

| File | Covers |
|---|---|
| [`docs/architecture/data-layer.md`](docs/architecture/data-layer.md) | **Data layer.** Postgres, Drizzle, migrations, demo and local databases, Blob, caching of catalogue reads |
| [`docs/architecture/accounts-and-roles.md`](docs/architecture/accounts-and-roles.md) | **Accounts, roles and permissions.** Better Auth, roles, `can()`, bans, rate limits by identity |
| [`docs/architecture/admin.md`](docs/architecture/admin.md) | **The admin surface.** `/admin`: surfaces, inventory (incl. CSV export), queues, people, drafts |
| [`docs/architecture/action-layer.md`](docs/architecture/action-layer.md) | **The action layer.** `src/lib/actions/`: every GUI write, assistant proposals, parity |
| [`docs/architecture/intake-and-research.md`](docs/architecture/intake-and-research.md) | **Intake, research and naming.** Adding equipment (incl. many items at once), refresh research, bulk intake, taxonomy v2, names, descriptions, English resources |
| [`docs/architecture/mcp-access.md`](docs/architecture/mcp-access.md) | **MCP access.** `/api/mcp`, tokens, OAuth (user guide: `docs/mcp.md`) |
| [`docs/architecture/notion-mirror.md`](docs/architecture/notion-mirror.md) | **The Notion mirror.** One-way copy of the inventory into Notion |
| [`docs/architecture/manuals.md`](docs/architecture/manuals.md) | **Manuals.** Archived manuals, manual text, passages, embeddings, OCR, `search_manual` |
| [`docs/architecture/performance.md`](docs/architecture/performance.md) | **Performance.** Images and thumbnails, caching, page weight, performance conventions |
| [`docs/architecture/kiosk.md`](docs/architecture/kiosk.md) | **The lab status screen.** `/kiosk` |
| [`docs/architecture/qr-labels.md`](docs/architecture/qr-labels.md) | **QR labels.** Print sheets at `/admin/inventory/qr`, `/api/qr/[slug]`, the tool page's QR dialog, `get_tool_qr_code` |
| [`docs/architecture/notifications.md`](docs/architecture/notifications.md) | **Email notifications.** Staff emailed when a ticket is filed, the 08:00 recurring-maintenance reminder, the outbox, Resend, one-click unsubscribe |
| [`docs/architecture/usage-insight.md`](docs/architecture/usage-insight.md) | **Usage insight.** `/admin/insights`: anonymous usage events, value report |
| [`docs/architecture/starter-answers.md`](docs/architecture/starter-answers.md) | **Starter answers.** `starter_answers`: pre-run, graded and cached answers to the starter questions |
| [`docs/architecture/key-files.md`](docs/architecture/key-files.md) | **Key files.** Where things live, file by file |
| [`docs/architecture/testing.md`](docs/architecture/testing.md) | **Testing.** The test suite's seams and rules (runbook: `TESTING.md`) |
| [`docs/architecture/ui-system.md`](docs/architecture/ui-system.md) | **UI system.** Tailwind 4 + shadcn primitives, `DataTable`, `ReviewCard`, admin navigation, public pages, chat UI |

## Commands

```bash
npm run dev          # dev server (:3000)
npm run build        # runs db:migrate, then production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (unit + integration + component)
npm run test:e2e     # playwright (needs: npx playwright install chromium)
npm run test:all     # lint + typecheck + vitest + playwright; must pass before any merge
npm run spec:coverage  # every route, tool, script and env var is documented
npm run manuals:eval-questions [-- --apply] [--tool slug]  # eval questions for indexed manuals (dry run by default)
npm run eval:manual-questions   # manual retrieval recall; EVAL_MQ_E2E=1 for the paid end-to-end check (evals/README.md)
npm run data:push -- --to .env.hosted [--dry-run] [--yes]   # copy local PGlite + .blob-data up to a hosted deploy
npm run thumbnails:bundled [-- --check]   # after changing public/tool-images/*.png
npm run thumbnails:backfill [-- --apply]  # thumbnails for Blob images that have none (dry run by default)
npm run taxonomy:migrate [-- --apply]     # taxonomy v2: the tree + every tool moved (dry run by default; stop npm run dev first)
npm run taxonomy:audit [-- --dry-run]     # consolidation audit: writes review proposals only
```

`data:push` (`scripts/push-local-to-hosted.ts`, logic in `src/lib/push-hosted/`) replaces the
hosted database's rows with the local ones (`PGLITE_DATA_DIR`) and uploads local files to
Vercel Blob, rewriting their URLs in the hosted copy only. Target credentials come only from
the `--to` file (`vercel env pull`), never `process.env`, and are never printed. It refuses
unless checkout, local and hosted are at the same migration; skips and blanks what the nightly
backup does (`backup-policy.ts`). Usage and caveats: `docs/deploy.md` Part 2 step 6.

## Conventions

- **Imports: `@/` in app code, relative `.ts` imports in anything plain Node
  loads.** The `@/` alias (→ `src/`) works under Next and Vitest only. Code that
  `scripts/` (`node --experimental-strip-types`) or a workflow step imports
  uses relative imports with `.ts` extensions and no `"server-only"`, which is
  why most imports in `src/lib` are relative. Move or rename a file with the
  editor's rename refactor (it rewrites every relative import), never with
  find-and-replace.
- Server components by default; add `"use client"` only when needed.
- Server-only modules import `"server-only"` (e.g. `rate-limit.ts`).
- Theme/brand via **CSS variables** (`--primary`, `--background`, …) — `[data-theme="light|dark"]` on `<html>`, never hardcoded colors.
- **The `--td-*` tokens and `.td-*` classes are gone** (public polish). Legacy
  CSS reads the global theme tokens directly. An unresolvable `var()` does not
  fall back — it computes to `unset` — so a rule copied from old history that
  names one fails *silently and wrongly*; use the theme tokens.
- **UI system**: tokens, primitives, `DataTable`, `ReviewCard`, admin
  navigation, public pages, chat. See `docs/architecture/ui-system.md`.
- All branding strings come from `siteConfig` (`@/lib/site-config`).
- **Page titles name the page only** (`title: "Inventory"`): the root
  layout's template makes it "Inventory · MakerLAB Tools". Link previews
  (`src/lib/share/`): `metadataBase` is `siteUrl()` (`NEXT_PUBLIC_SITE_URL`,
  else `VERCEL_PROJECT_PRODUCTION_URL`, else the live deployment); pages
  without an image inherit the generated site card (`app/opengraph-image.tsx`,
  `twitter-image.tsx`); tool and project pages show their photo through
  `recordShareMetadata` — public-store and bundled photos only, via
  `/_next/image` at 640 px — and a draft or unknown id gets `{}`. A page that
  sets `openGraph` replaces the root's, so it spreads `baseOpenGraph()` and
  names its image. The card's fonts are static TTFs cut by
  `scripts/share-card-fonts.py` (`next/og` cannot read WOFF2).
- Every API route is **rate-limited by identity** before expensive work — user id when signed in, hashed IP when not.
- Authorization is **always** `can(subject, permission)` from `src/lib/auth/permissions.ts`. Never compare role names, and never gate inside a capability tool's `run()`.
- Maintenance tickets are always written in **English** even when the chat replies in another locale.

## Testing

`npm run test:all` must pass before any merge; it needs no credentials and no
network. Runbook: `TESTING.md`. The two model-stubbing seams, the E2E servers
and the rules: `docs/architecture/testing.md`.

## Gotchas

- Because `cacheComponents` is enabled, API routes **cannot set `runtime`** — they use the default Node runtime.
- **A server action's re-render can sit uncommitted.** In the production build
  (Next 16.1, React 19.2, `cacheComponents`), the page a server action
  refreshed with `revalidatePath` finished rendering and was not shown until
  something else updated the page — and a later `router.refresh()` queued
  behind it. Islands that depend on the re-rendered page (the mirror page's
  four) call `useRefreshNudge()` (`src/components/admin/use-refresh-nudge.ts`)
  after a successful action; islands that keep their own confirmed state (the
  queues, `RoleSelect`) are unaffected. E2E scenario 8 is the canary.
- **A save-on-change control is disabled until hydrated** (`useHydrated`,
  `src/components/admin/use-hydrated.ts`). A select changed before its
  Suspense boundary hydrated is reset by hydration, and React replays the
  queued change event with the *reset* value — which once earned an `ok` and a
  "Saved" on `/admin/users` for a role that never changed. `RoleSelect` also
  sends nothing for a change to the value it holds, and treats an answer whose
  `role` differs from the choice as `failed`.
- The in-memory rate limiter is a per-process singleton; it resets on cold start (fine for abuse prevention). Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set, and when Upstash cannot answer the limiter falls back to the in-memory counter rather than allowing the request.
- Python scripts under `scripts/` use Node with `--experimental-strip-types`; they are migration/maintenance tools, not part of the app build.
- **Agent worktrees sit inside the app root.** `.claude/worktrees/` holds full checkouts of this repo. `tsconfig.json`, ESLint, the vitest unit project and the build trace ignore `.claude/`, but `@workflow/vitest` scans the whole root (dot folders included, no exclude option), so finished worktrees should be pruned.
