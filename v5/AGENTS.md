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
- **Every student-facing write is on Postgres** as of Phase 3. A correction
  goes to `feedback`, a maintenance ticket to `maintenance_logs`, a project
  submission to `projects` + `project_tools` — see `src/lib/data/*.ts`.
  `src/lib/data/notion-ids.ts` (the Phase-2 page-id bridge) has no importers
  left and is awaiting deletion approval, as are `/api/upload-notion` and
  `/api/admin/backup`.
- **The one write still on Notion is intake's `create_tool`** (`capabilities/
  intake.ts`), which stays there until Phase 6. Its photos no longer travel
  with it: an upload id is a Postgres uuid now, Notion would reject the page,
  so the tool is created without pictures and says so in its `warnings[]`.
- **Files** (tool images, manuals, project photos, maintenance photos) live in
  **Vercel Blob**, recorded row-by-row in `attachments` — see
  `next.config.ts`'s `images.remotePatterns`. `POST /api/uploads` is the one
  upload route; it writes the blob, inserts an **unowned** `attachments` row and
  returns `{ attachmentId, previewUrl }`. The write that follows *claims* those
  ids (`claimAttachments`), and `/api/cron/daily` deletes anything still
  unclaimed after 24 hours. With no `BLOB_READ_WRITE_TOKEN` the route answers
  503 `{ code: "blob_not_configured" }` and both clients show a translated
  "photo uploads are unavailable" — never a fabricated id (Article 4).
- **Failing toward stale, not wrong (Article 4).** `DATABASE_URL` unset serves
  the PGlite demo seed with `DemoDataBanner` shown. `DATABASE_URL` set but
  unreachable never falls back to demo or invented data — cached pages keep
  serving and an uncached read renders the error state.

## Accounts, roles and permissions (Phase 4)

**Better Auth runs the way it is meant to be run**, on the Drizzle adapter over
the same `getDb()` handle everything else uses. It owns four tables — `user`,
`session`, `account`, `verification` (`src/lib/db/schema/auth.ts`, migration
`0003`). The stateless `makerlab.identity` cookie is **retired**:
`src/lib/auth/session-cookie.ts` has no importers and is awaiting deletion
approval. Do not mint one.

- **Sessions are rows.** The cookie carries only a token; `resolveIdentity`
  looks the session and its user up on every request. That is why a role change
  lands on the person's next request and a ban bites immediately. Better Auth's
  cookie cache is deliberately off.
- **Roles** are `anonymous` (never a row) plus the stored `user | admin |
  super_admin` (`src/lib/db/schema/vocabulary.ts`, which also backs the
  `user_role_check` constraint). `student` and `staff` are gone; today's `admin`
  is the old `staff`, and today's `super_admin` is the old `admin`.
- **What each role may do is declared in code**, not in a table:
  `src/lib/auth/permissions.ts` (`statement` / `ac` / `roles` / `can()`), the
  same declaration the admin plugin is configured with. **One check,
  everywhere:** routes, server actions and capability composition call
  `can(identity, "tools.add")`; client components call it with the role
  `/api/identity` reports, to hide a control. Hiding is presentation; the
  server check is the control.
- **Capabilities declare `requiredPermission`**, enforced once by
  `capabilitiesForIdentity` in `src/lib/capabilities/access.ts` — never inside a
  tool's `run()`.
- **`AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` are retired.** Nothing reads them.
  The one env list left is **`AUTH_SUPER_ADMIN_EMAILS`, a floor, not a roster**
  (`src/lib/auth/super-admins.ts`): a listed address is created as
  `super_admin` and resolves as `super_admin` whatever its row says. It is the
  bootstrap (no user row exists until somebody signs in) and the lock-out
  guarantee.
- **Everything stays optional.** `AUTH_SECRET` alone gives database sessions;
  the two `GOOGLE_*` variables are what make *starting* one possible, and
  without them `/api/auth/sign-in/social` answers 503 and the header says
  sign-in is not set up. With neither, nobody is signed in and the catalogue and
  chat are unchanged. **Sign-in unlocks; it never gates the front door.**
- **Testing a role needs no Google.** `test/utils/session.ts` seeds a `user` and
  a `session` row and mints the cookie Better Auth would have set; the demo seed
  ships one account per role for E2E. See `test/README.md`.
- **`created_by` / `updated_by` now reference `user.id`** (`on delete set null`),
  the foreign keys Phase 1 deferred. A write whose author is not a row is
  refused — correct, because in production that id comes from a session.

## The admin surface (`/admin`)

`/admin/users` is the first admin page and the first server action in the app;
Phase 5 extends both. The shape it sets:

- **Two gates, coarse then exact.** `src/app/admin/layout.tsx` resolves the
  identity from headers and answers "may this person see an admin surface at
  all" (`canReachAdmin`, any admin-surface permission). Each page then checks
  the permission it actually needs — `/admin/users` on `users.manage`, which
  only `super_admin` holds. A SuperMaker gets past the layout and is refused on
  the page, **and is told so**: `AdminNotice` renders "not signed in" or "not
  permitted", never a 404 and never an error boundary (Article 4).
- **Server actions check themselves.** A server action is a POST endpoint with
  a generated name, reachable without the page that offers it, so
  `src/app/admin/users/actions.ts` resolves the identity, rate-limits
  (`ADMIN_ACTION_TIER`, 120/min per person), and re-checks `users.manage` — it
  trusts nothing from the page that rendered the control (spec §8). Refusals are
  **values** (`{ ok: false, error }`), not exceptions, so the island can render
  the reason; every code has an `admin.errors.<code>` string.
- **Two things cannot be undone, so they cannot be done.** An address in
  `AUTH_SUPER_ADMIN_EMAILS` cannot be demoted or banned, and the last
  unbanned `super_admin` cannot be demoted. The table disables those rows with
  the reason showing; the action derives both again before it writes.
- **Reads go straight to Postgres, writes go through the plugin.**
  `src/lib/data/users.ts` selects the roster; `auth.api.setRole` / `banUser` /
  `unbanUser` perform the change, because a ban there also deletes the person's
  sessions.
- **Every security-relevant change is recorded.** `src/lib/data/audit.ts` is
  insert-and-select only — there is deliberately no update or delete export,
  and a test asserts the module's shape. `AUDIT_ACTIONS` has no
  `user.unbanned`, so lifting a ban is `user.banned` with `detail.banned:
  false`.
- **Server actions pass down as props.** `RoleSelect` and `BanToggle` take the
  action rather than importing it, which keeps `next/headers`, the limiter and
  `server-only` out of a client component's graph and makes both testable with
  a `vi.fn`.
- **Submitting a project needs an account** (spec §5.5) — the one place in the
  app where sign-in is required. `POST /api/projects` answers 401
  `sign_in_required` to an anonymous caller, the byline comes from the session
  and the typed-name field is gone. Browsing, chatting and reporting a problem
  are all still anonymous.

## Key files

| Path | Purpose |
|---|---|
| `src/lib/site-config.ts` | White-label branding (env-driven, all have defaults) |
| `src/lib/db/client.ts` | `getDb()`, `dataSubstrate()`, `pingDb()` — the one entry point to Postgres/PGlite |
| `src/lib/notion.ts` | Notion API client — read by the one-time import and by intake's `create_tool` (Phase 6); no other write and no request path reads it |
| `src/lib/data/attachments.ts` | `attachments` rows: create, claim onto an owner, list orphans, delete |
| `src/lib/blob.ts` | The Blob seam — `put` (private backups, fixed pathname) and `putUpload` (random pathname, caller's access) |
| `src/lib/cron/backup.ts`, `src/lib/cron/cleanup.ts` | The nightly Postgres export and the orphaned-upload sweep |
| `src/lib/cron/backup-policy.ts` | What the nightly export holds back — `session` / `verification` skipped, `account` tokens blanked. A backup is data, not credentials |
| `src/lib/catalog.ts` | Catalog orchestration + cache, reading Postgres |
| `src/lib/rate-limit.ts` | In-memory (or Upstash) sliding-window limiter, tiered by role |
| `src/lib/auth/config.ts` | The Better Auth instance: Drizzle adapter, database sessions, admin plugin, domain enforcement |
| `src/lib/auth/identity.ts` | `resolveIdentity(req)` — the one way to learn who is calling. Never throws |
| `src/lib/auth/permissions.ts` | `statement` / `ac` / `roles` / `can()` — what each role may do |
| `src/lib/auth/super-admins.ts` | `AUTH_SUPER_ADMIN_EMAILS`, the lock-out floor |
| `src/app/admin/layout.tsx` | The `/admin` front door — signed in? holds an admin permission? |
| `src/app/admin/users/actions.ts` | `setUserRole` / `setUserBanned` — the app's first server actions |
| `src/lib/data/users.ts` | The `/admin/users` roster, read straight from Postgres |
| `src/lib/data/audit.ts` | `audit_events` — insert and select, never update or delete |
| `src/lib/db/schema/auth.ts` | Better Auth's four tables; property keys are its field names |
| `src/lib/types.ts` / `src/components/catalog-types.ts` | Notion record types / resolved view types |
| `src/app/api/chat/route.ts` | Claude chat: streaming, tools (`get_unit_details`, `report_issue`, `web_fetch`), PDF manual attach |
| `src/app/api/mcp/route.ts` | MCP JSON-RPC server (5 tools), bearer-token auth |
| `src/app/api/uploads/route.ts` | The one upload route → Vercel Blob + an `attachments` row |
| `src/app/api/cron/daily/route.ts` | The single nightly cron (`vercel.json`): backup, then orphaned-upload cleanup |
| `src/app/api/admin/revalidate/route.ts` | Cache invalidation (`tools.edit`, or `x-admin-secret` for session-less callers) |
| `src/components/ChatFab.tsx` | Chat UI (`useChat`, citations stripped, photo upload) |
| `src/app/page.tsx`, `tools/[id]/page.tsx` | Gallery + tool detail |

## Conventions

- Use the `@/` import alias (→ `src/`).
- Server components by default; add `"use client"` only when needed.
- Server-only modules import `"server-only"` (e.g. `rate-limit.ts`).
- Theme/brand via **CSS variables** (`--primary`, `--background`, …) — `[data-theme="light|dark"]` on `<html>`, never hardcoded colors.
- All branding strings come from `siteConfig` (`@/lib/site-config`).
- Every API route is **rate-limited by identity** before expensive work — user id when signed in, hashed IP when not.
- Authorization is **always** `can(subject, permission)` from `src/lib/auth/permissions.ts`. Never compare role names, and never gate inside a capability tool's `run()`.
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
- **The whole suite runs with every environment variable unset.** Reads *and*
  writes go to an in-process PGlite database seeded with demo data; Vercel Blob
  is stubbed at the `src/lib/blob.ts` seam (`vi.mock`), never called for real.
  The only MSW-stubbed Notion left is intake's `create_tool`.
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
