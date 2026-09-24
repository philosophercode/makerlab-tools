# v5 Data Platform — Postgres, Blob, Accounts, Admin Inventory, Two-Step Intake, a Notion Mirror — Design Spec

**Date:** 2026-09-14
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/data-platform-spec`
**Spec PR:** #32 · **Implementation PRs:** one per phase (§9)

> Per constitution Article 1, this merges before implementation begins. It amends Articles 3, 5, 6 and 7 of the constitution; the amended text ships in this PR.

## 1. Summary

v5 keeps every record in Notion, and the constitution makes that a principle: Notion is the source of truth and the editing surface (Article 7), and publishing a draft happens there (Article 5). That was right for a catalogue edited a few times a week by one person. It stops being right once the app needs people in it: accounts with roles, project posts tied to a signed-in author, and editing that SuperMakers do on the website rather than in a workspace most of them cannot open. Notion has no users table, no transactions, no constraints, and file URLs that expire about an hour after they are read.

This spec moves v5's data to **Postgres** (Neon, provisioned through the Vercel Marketplace) and its files to **Vercel Blob**. The app becomes the source of truth. Notion becomes an optional, **one-way mirror** that an admin bolts on from a settings page, so the lab can still see the inventory in Notion. The app never reads Notion again after the one-time import.

On that foundation it adds what the lab asked for on 2026-09-14:

- **Accounts.** A users table and three roles with standard names: `user` (a student), `admin` (a SuperMaker), `super_admin` (a director). Permissions are fixed per role in one file.
- **Inventory editing on the website**: an admin inventory table for reviewing everything, and an edit mode on each tool page for quick fixes.
- **A two-step add-tool flow.** The assistant only identifies what each tool is and puts it in an intake table with checkboxes. An admin selects rows and sends them for research. Research runs as a durable background job and produces a preliminary page per tool. An admin approves each page into the inventory.
- **Projects need sign-in.** Anyone signed in can post one. Anonymous visitors still browse, use the assistant, and report problems.

**This is an architecture change, and that is the consequential part.** The source of truth moves from Notion to Postgres, the approval surface moves from Notion into the app, and the test suite's offline data moves from a mock catalogue to an in-process Postgres (PGlite). The data layer is a fresh schema written for v5 — one lab, no multi-tenant scoping — as decided on 2026-09-14.

**Where the app is.** v5 is alpha with no users. There is no cutover date and no rollback window: the read path switches to Postgres when its phase merges, and problems are fixed forward. When the phases in §9 are done the app is beta: Isaac and Luis load the real inventory and prove intake works, SuperMakers get a one-off session on using and updating the app, and then real students test it.

**Prerequisite.** Google sign-in is not configured in production today: `POST /api/auth/sign-in/social` returns 503. Every role-based feature here depends on it.

## 2. Goals / Non-goals

### Goals

1. **No request path reads Notion.** Catalogue pages, tool pages, projects, unit status, maintenance history, chat and MCP read Postgres. `api.notion.com` is called only by the mirror push and the one-time import.
2. **Old links keep working.** Every URL and printed QR code of the form `/tools/<notion-page-id>` redirects permanently to `/tools/<slug>`.
3. **Roles change without a deploy.** A super admin changes a person's role on `/admin/users`, and it applies on that person's next request.
4. **Inventory is editable on the website.** An admin edits a tool, its units and its resources from `/admin/inventory` or from edit mode on `/tools/<slug>`, and the public page shows the change on its next load.
5. **Adding equipment never blocks the chat.** An admin gets an intake table in one chat turn, with no manual or spec research in that turn. Selected rows are researched in the background. Nothing reaches the public catalogue until an admin approves it.
6. **Duplicates are caught before research.** The check covers published tools, drafts and pending items, and offers **Add as another unit** (with a serial number) alongside **It's a different tool** and **Remove**.
7. **Anonymous visitors keep what they have** — browsing, the assistant, reporting problems and corrections — and lose only project submission.
8. **The Notion mirror is a bolt-on.** An admin sets it up from `/admin/mirror` with their own Notion token, sees when it last synced, can pause it, and can press **Sync now**. A failed push never affects the app.
9. **Article 3 still holds.** `npm run test:all` passes with every environment variable unset and no network.
10. **Built for translation.** Every static string goes through `next-intl`. English ships with each phase; the other locales fall back to English until the translation pass (§9, Phase 9).

### Non-goals (this iteration)

- **Reading from Notion after the import, or editing in the mirror.** The mirror is write-only from the app's side. An edit made in a mirror database is overwritten by the next push, and each mirror database's description says so.
- **Touching the old Notion databases.** They are imported once and then left alone, on Niti's Notion, exactly as they are. No renaming, no archiving, no export.
- **A permissions toggle page.** Permissions are a table in code (§3.5). Changing one is a one-line edit and a deploy. A `/admin/roles` matrix was considered and set aside on 2026-09-14.
- **Student settings or saved sessions.** The `user` role exists so students can post projects. Anything else a signed-in student might get comes later.
- **A rollback window, a cutover date, or running two backends side by side.** Nobody uses the app yet; §9 sequences the switch so `main` is always deployable, and that is enough.
- **Leaving the Vercel Hobby plan.** Hobby's limits are stated where they matter (§3.7, §3.9, §8). The lab moves to Pro only when it hits one.
- **Photo cleanup** — background removal, cropping, enhancement. An admin uploads a photo, and that is the whole flow for now.
- **Other sign-in providers, passwords, or accounts outside the institution's email domain.**
- **Field-level history or undo.** Edits record who and when. Security-relevant actions are logged (§4.11). There is no per-field revision history.
- **Hard-deleting tools.** Tools are archived, because maintenance history refers to them. Only pending items, units with no history, and orphaned uploads are ever deleted.
- **Changing MCP's trust model.** `MCP_TOKEN` stays the gate for MCP writes, and MCP callers have no role.
- **Live co-editing.** Concurrent edits are detected with an `updated_at` check and refused, not merged.
- **eve.** Research runs on the Workflow SDK directly (§3.7). eve is built on the same SDK and is the path if research ever grows into a full agent with skills, schedules and sandboxes; today it would add a second project and an HTTP hop for no gain.

## 3. Architecture

```
                   ┌──────────────────── Vercel (Next.js 16, v5) ────────────────────┐
 Browser ─────────▶│  pages · /admin/* · server actions · /api/*                     │
                   │      │                       │                    │             │
                   │  capabilities (chat, MCP) ─▶ src/lib/data/*   src/lib/files/*   │
                   │                             (query modules)    (uploads)        │
                   │  workflows/research-batch ─▶ src/lib/research/*                 │
                   │  workflows/mirror-push ────▶ src/lib/mirror/*                   │
                   │  /api/cron/daily ──────────▶ backup · cleanup · mirror backstop │
                   └────────────────────────────────┬────────────────────┬───────────┘
                                                    ▼                    ▼
                                             Neon Postgres          Vercel Blob
                                                    │
                        src/lib/mirror ─ push ────▶ Notion: an admin's mirror databases
                        scripts/import-notion ◀─── read once ── Notion: today's databases
```

### 3.1 The source of truth moves

Postgres is authoritative for every record. Today's Notion databases are read once by the import and never again. A mirror, when an admin sets one up, receives a one-way copy. This requires amending Articles 3, 5, 6 and 7; the amended text is in §7.1 and ships in this PR.

### 3.2 Database

- **Host.** Neon Postgres, installed on the `makerlab-tools-v5` Vercel project through the Marketplace (`vercel integration add neon`). The integration injects `DATABASE_URL` for production and creates a branch database per preview deployment, so a preview can run the import and be clicked through before the read path merges.
- **ORM and migrations.** Drizzle ORM. `drizzle-kit generate` produces SQL migrations, committed under `v5/src/lib/db/migrations/`. Migrations run in a deploy step (`npm run db:migrate`, called from the Vercel build command), never at request time. The `pg_trgm` extension is enabled in the first migration, for duplicate matching (§5.4).
- **Drivers.**
  - Production and preview: `@neondatabase/serverless` through `drizzle-orm/neon-serverless`. This is the pooled client, which transactions need.
  - Tests, local development and demo mode: `@electric-sql/pglite` through `drizzle-orm/pglite`. It is Postgres compiled to WebAssembly, running in-process with no network, and it is what keeps Article 3 true. It runs the same migrations on first use.
- **One entry point.** `src/lib/db/client.ts` exports `getDb()`, created lazily on first call so `next build` never needs `DATABASE_URL`. There is no `Proxy` wrapper.

```ts
// src/lib/db/client.ts (sketch)
export type DataSubstrate = "neon" | "pglite-demo";
export function dataSubstrate(): DataSubstrate;   // DATABASE_URL set → "neon"
export async function getDb(): Promise<Db>;       // memoized; PGlite migrates and seeds on first use
export class DbUnavailableError extends Error {}  // Neon configured but unreachable
```

**Failing toward stale, not wrong (Article 4).** Today a Notion failure silently serves the mock catalogue. After this change:

- **`DATABASE_URL` unset** (tests, E2E, a fresh clone): PGlite with a demo seed, and the existing `DemoDataBanner` says the catalogue is sample data.
- **`DATABASE_URL` set but unreachable:** cached catalogue pages keep serving, and an uncached read renders the error state. Invented data is never served in production.

### 3.3 Files

Vercel Blob (`@vercel/blob`, already a dependency for backups).

| Kind | Access | Why |
|---|---|---|
| Tool images, resource files (manuals), project photos, photos on pending tools | `public` | Shown on public pages once published; stored at random pathnames, so unpublished ones are unguessable |
| Maintenance photos | `private` | May show people; admin-only |
| Nightly backups | `private` | |

- **One upload route.** `POST /api/uploads` replaces `/api/upload-notion`.
  - It accepts `image/*` up to 18 MB, and `application/pdf` up to 20 MB for resources only.
  - It writes to a random pathname and records an `attachments` row with no owner.
  - It returns `{ attachmentId, previewUrl }`.
  - Anonymous uploads stay allowed for maintenance reports and chat vision, rate-limited as today.
  - The daily cron deletes unowned attachments older than 24 hours.
- **Chat vision** depends on PR #31's downscaled-image fix (§7.3). This spec does not change the image the model receives.
- **Images stop expiring.** Notion file URLs are signed and expire, which is the source of the broken catalogue images behind the 24-hour cache. Blob URLs do not expire. `next.config.ts` gains the Blob hostname in `images.remotePatterns`, and the import copies file bytes, never URLs (§5.7).

### 3.4 Accounts and roles

**Better Auth runs the way it is meant to be run.** The auth spec of 2026-07-29 used Better Auth for the Google handshake only, with an in-memory adapter and a hand-written HMAC cookie (`makerlab.identity`), because there was no database to keep sessions in. There is one now, so that workaround goes and the library's standard setup takes its place:

- **Storage:** the Drizzle adapter on the same Neon database (PGlite in tests). Better Auth owns four tables — `user`, `session`, `account`, `verification` — whose Drizzle schema is generated by `npx @better-auth/cli generate` and committed like any other migration.
- **Sessions in the database**, not in a self-describing cookie. The cookie carries only a session token; each request looks the session and its user up. That is what makes Goal 3 true: a role change is visible on the person's next request, with nothing to expire. (Better Auth's optional cookie cache stays off.)
- **Roles from the admin plugin** (`better-auth/plugins/admin`), which adds `role`, `banned`, `banReason` and `banExpires` to `user`, plus the `set-role`, `ban-user`, `unban-user` and `list-users` endpoints that `/admin/users` calls. `defaultRole` is `user`; `adminRoles` is `["super_admin"]`, so only super admins can reach those endpoints.
- **Domain enforcement** moves from the after-hook into `databaseHooks.user.create.before`, which refuses to create a user outside `AUTH_ALLOWED_EMAIL_DOMAIN`. Google's `hd` hint stays as a courtesy for the account picker.
- **`resolveIdentity`** becomes a thin wrapper over `auth.api.getSession()`, memoized per request with React `cache()`. The `Identity` type it returns keeps its shape, so every caller is unchanged. A banned user resolves to anonymous.

**Roles**, least to most privileged. The names are the standard ones; the lab can rename the labels shown in the UI without touching the stored values.

| Role | Who at the lab | How it is assigned |
|---|---|---|
| `anonymous` | Not signed in | — |
| `user` | A student, or anyone signed in with an allowed address | Automatically, on first sign-in |
| `admin` | A SuperMaker | By a super admin, on `/admin/users` |
| `super_admin` | A director | By a super admin, or by `AUTH_SUPER_ADMIN_EMAILS` |

`AUTH_SUPER_ADMIN_EMAILS` is a **floor**, not a roster: an address listed there is created as `super_admin` (in the same `user.create.before` hook) and resolves as `super_admin` whatever its row says. It guarantees the lab cannot lock itself out, and it is how the first super admin comes to exist. It is `ies22@cornell.edu` (Isaac, whose Cornell address is permanent).

### 3.5 Permissions

This is the ordinary pattern: **the role is a column on the user row, and what each role may do is declared in code.** A permissions table in the database is what you build when admins need to edit permissions at runtime, and the lab decided on 2026-09-14 that it does not.

The declaration uses Better Auth's access-control module, which is how the admin plugin expects roles to be described:

```ts
// src/lib/auth/permissions.ts
import { createAccessControl } from "better-auth/plugins/access";

export const statement = {
  projects:    ["submit", "moderate"],
  catalog:     ["view_drafts"],
  tools:       ["add", "approve", "edit", "publish"],
  maintenance: ["manage"],
  feedback:    ["manage"],
  mirror:      ["manage"],
  users:       ["manage"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  user:        ac.newRole({ projects: ["submit"] }),
  admin:       ac.newRole({
    projects: ["submit", "moderate"], catalog: ["view_drafts"],
    tools: ["add", "approve", "edit", "publish"],
    maintenance: ["manage"], feedback: ["manage"], mirror: ["manage"],
  }),
  super_admin: ac.newRole({ ...everything }),
};

export type Permission = "projects.submit" | "tools.approve" | /* … */ "users.manage";
export function can(identity: Identity | null, permission: Permission): boolean;
// can() splits "tools.approve" into { tools: ["approve"] } and calls roles[role].authorize().
```

Three roles make most rows identical, and that is fine: the declaration exists so the *next* change — "SuperMakers may add tools but not publish them" — is one line, reviewed in a PR, rather than a search through route handlers.

**One check, everywhere.**

- **Server-side:** server actions, route handlers, and capability composition call `can()`.
- **Client-side:** `GET /api/identity` returns `role`, and components hide controls with the same declaration. Hiding is presentation; the server check is the control.

**Capabilities declare permissions, not roles.** A capability gains `requiredPermission?: Permission`, enforced once when the chat composes its tools. This replaces both the env-list roles of the auth spec and the `minimumRole` gate that PR #31 introduced.

### 3.6 Capabilities (Article 2)

| Capability | Tools | Change |
|---|---|---|
| `catalog` | `list_tools`, `search_tools`, `get_tool_details` | Reads Postgres. Names and schemas unchanged. |
| `units` | `get_unit_details`, `get_maintenance_history` | Reads Postgres. |
| `maintenance` | `report_issue` | Writes `maintenance_logs`. The Notion retry-without-`reporter_email` workaround is deleted. |
| `flags` | `report_correction` | Writes `feedback`. Its raw Notion `fetch` is deleted. |
| `intake` | `identify_tools` (new, chat-only, `requiredPermission: "tools.add"`); `create_tool` stays, **MCP-only** | `research_tool` and `propose_listing` leave the chat. Research moves into the workflow (§3.7). |

`identify_tools` is the only intake tool the model can call, and it creates pending rows owned by the caller and nothing else. Starting research is a button press handled by a route, not a tool call, so the model never spends research budget on its own initiative.

### 3.7 Background research: the Workflow SDK

Research runs as a durable workflow, `v5/src/workflows/research-batch.ts`, using the Workflow SDK: the `workflow` package, `withWorkflow` from `workflow/next` in `next.config.ts`, and `start()` from `workflow/api`. On Vercel this is Vercel Workflows.

**Why a workflow**, rather than the chat turn, a plain background function, or a queue library:

- The chat route has `maxDuration = 60`, a 10-step budget, and 5 searches and 5 fetches per turn — not enough to research a batch.
- A plain background function has no retries and loses its state when it times out.
- pg-boss and similar need a worker process that is always running, which Vercel does not provide.
- Workflow steps retry, persist their results, survive deploys, and appear in Vercel Observability, so a stuck research run can be diagnosed.

```ts
// v5/src/workflows/research-batch.ts (sketch)
export async function researchBatch(batchId: string, itemIds: string[]) {
  "use workflow";
  for (const group of chunk(itemIds, RESEARCH_CONCURRENCY)) {   // 3 at a time (Article 4)
    await Promise.allSettled(group.map((id) => researchItem(id)));
  }
  await finishBatch(batchId);                                    // step: revalidate the intake views
}

async function researchItem(id: string) {
  "use step";
  // status → researching
  // generateText with web_search (maxUses 8) and web_fetch (maxUses 8); output parsed by zod
  // verifyResourceLinks; scoreConfidence; resolve category and location against the taxonomy
  // status → researched | failed
}
```

- **Reused code.** The research prompt, link verification (`verifyResourceLinks`) and confidence scoring (`confidence.ts`) move from `capabilities/intake.ts` into `src/lib/research/`. The confidence rule is unchanged: the grade is computed from reported evidence in code and never taken from the model.
- **Errors.** A 429 or 5xx from the model or a fetch throws `RetryableError`, with at most 3 attempts. Anything else throws `FatalError`, which marks that item `failed` with its error and leaves the other items running.
- **Hobby allowance.** 50,000 workflow events and 1 GB written per month; a step is about three events. Researching 100 tools is a few hundred events. Run history is kept for one day on Hobby, so the item's own `research_error` column, not the run log, is the record of what went wrong.
- **No extra resource.** On Vercel the SDK stores runs in the platform's own backend (`@workflow/world-vercel`); there is nothing to provision and no second database. Locally it uses a folder on disk. If the app ever leaves Vercel, `@workflow/world-postgres` runs the same workflows against the same Neon database.

### 3.8 The Notion mirror (built last)

The mirror is a settings page, `/admin/mirror`, that belongs to the signed-in admin. It is the simplest thing that pushes the inventory into a Notion workspace and says when it last did so.

**What an admin sees.**

- **Connect:** a field for a Notion internal-integration token and a field for the URL of a page the integration has been shared with. **Test connection** reads the page and shows its title.
- **Mapping:** a fixed list of the app's tables — categories, locations, tools, units, resources, maintenance, projects — each with the id of its Notion database. **Create databases** makes all seven under the connected page with fixed property schemas and fills the mapping in. An admin who already has databases can paste ids instead; the page validates each one's properties against the expected schema before saving.
- **Status:** last synced time, last result (ok, partial, failed) and the last error text.
- **Controls:** **Sync now**, **Pause** / **Resume**, **Disconnect** (which forgets the token).

**Push** (`src/lib/mirror/`, run by the `mirrorPush(mirrorId)` workflow):

1. Skip if the mirror is paused or another push for it started less than 15 minutes ago (`running_since`, a conditional update).
2. For each mapped entity, in dependency order — categories, locations, tools, units, resources, maintenance, projects — select rows with `updated_at > last_synced_at`.
3. Upsert each page through its `mirror_pages` row: update the page if the row exists; otherwise create it and record its id.
4. Archive the pages of archived tools.
5. Record `last_synced_at`, status and error. On partial failure, `last_synced_at` does not advance, so the next push retries the rows that failed.

Requests are throttled to 3 per second and retried on 429 using `Retry-After`. One push is bounded at 45 seconds; what is left waits for the next one.

**What is mirrored.**

- Every tool, published or not, with a Published checkbox.
- Units, resources, categories and locations.
- Maintenance logs **without reporter emails**.
- Published projects only.
- Images: public Blob URLs go into files properties as external URLs; private photos are never mirrored.

**Triggers**, in order of how much they matter:

1. **A change in the app.** Approving a tool, publishing, and saving an edit call `requestMirrorPush()`, which starts a short workflow that sleeps two minutes, so a burst of edits coalesces, then pushes every active mirror.
2. **Sync now** on the page.
3. **The daily cron** as a backstop, for anything the triggers missed.

**Owners.** A mirror is one admin's. The first is Isaac's, on Isaac's Notion. When Niti wants one on hers, she opens the same page and connects her own token; nothing about the first mirror changes.

### 3.9 Caching, invalidation and the daily cron (Article 4)

- **Reads.** Catalogue reads keep `'use cache'` with `cacheTag("catalog")`. Detail reads add `cacheTag("tool:<id>")`, and project reads add `cacheTag("projects")`.
- **Writes invalidate their tags.** Server actions call `updateTag`, so the person editing sees their own change on the next render. Route handlers and workflow steps call `revalidateTag(tag, "max")`.
- **Cache lifetime.** The 24-hour revalidation window was sized for slow, rate-limited Notion reads. With invalidation on every write it can stay long: staleness now comes only from writes the app did not make, and there are none.
- **One cron.** Hobby allows a cron job to run at most once a day, so `vercel.json` keeps one entry, `/api/cron/daily`, which does the nightly backup (a JSON export of every table to a private blob, kept 30 days), deletes orphaned uploads and stale pending items, and pushes any mirror whose data is newer than its last sync.

### 3.10 What moves where

| Today | After | Behaviour-preserving? |
|---|---|---|
| `src/lib/notion.ts` reads | `src/lib/data/*` query modules | Yes — `catalog.ts` keeps its exports |
| `src/lib/notion.ts` writes | `src/lib/data/*` | Yes |
| `capabilities/flags.ts` raw Notion `fetch` | `src/lib/data/feedback.ts` | Yes |
| `POST /api/upload-notion` | `POST /api/uploads` (Blob) | Yes for callers; the response shape changes |
| `GET /api/health` Notion probe | Postgres probe | Yes |
| `GET /api/admin/backup` (Notion to Blob) | Part of `/api/cron/daily`, JSON export of Postgres | Yes |
| `src/components/mock-catalog.ts` | PGlite demo seed, `src/lib/db/demo-seed.ts` | Yes, for tests and E2E |
| `AUTH_STAFF_EMAILS`, `AUTH_ADMIN_EMAILS` | `users.role`; `AUTH_SUPER_ADMIN_EMAILS` as floor | No — roles move into the app |
| Chat intake with research in the turn | `identify_tools` in chat; research in a workflow; preliminary pages on `/admin/intake` | No — the new flow |
| Anonymous project submission | Requires sign-in | No — deliberate |
| Publishing in Notion | Approve and publish in the app | No — deliberate |
| `scripts/migrate-tools-to-resources.ts`, `drop-deprecated-notion-columns.ts`, `clear-resource-migration-notes.ts`, `validate-notion-migration.ts` | Retired in Phase 2; deletion proposed separately | — |
| `scripts/generate-qr-labels.ts` | Reads Postgres and prints `/tools/<slug>` | Old labels still resolve (Goal 2) |
| "Notion-backed" in `AGENTS.md`, `v5/AGENTS.md`, `CLAUDE.md` | "Postgres-backed, with an optional Notion mirror" | Docs, updated in Phase 2 |

### 3.11 Environment contract

| Variable | Status | Purpose |
|---|---|---|
| `DATABASE_URL` | New (Neon) | Postgres connection; unset means PGlite demo |
| `AUTH_SUPER_ADMIN_EMAILS` | New | Super-admin floor: `ies22@cornell.edu` |
| `LAB_TIMEZONE` | New, default `America/New_York` | Dates on tickets (Article 6: configuration, not a constant) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Existing, **unset in production today** | The OAuth client; Phase 0 |
| `AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_ALLOWED_EMAIL_DOMAIN` | Existing | Better Auth; `AUTH_SECRET` also derives the key that encrypts mirror tokens (§8) |
| `BLOB_READ_WRITE_TOKEN` | Existing | Uploads and backups |
| `CRON_SECRET` | Existing | The daily cron route |
| `NOTION_API_KEY`, `NOTION_DB_*` (8) | Import only, then removed | Source databases. Mirrors carry their own tokens. |
| `AUTH_STAFF_EMAILS`, `AUTH_ADMIN_EMAILS` | Removed in Phase 4 | Read once, to seed the first admin rows |

Locally these live in `v5/.env.local`; in production they are the Vercel project's environment variables, which `vercel env pull` copies down.

## 4. Data model

- **One lab.** No `org_id`.
- **Keys.** UUID primary keys (`gen_random_uuid()`).
- **Timestamps.** Every mutable table has `created_at` and `updated_at`. `updated_at` is maintained by a `BEFORE UPDATE` trigger rather than by the ORM, because the import, the seed, and any manual SQL fix write outside Drizzle, and the mirror selects on that column.

**Vocabularies are `text` columns with named CHECK constraints, not `pgEnum`.** Adding a value is then an ordinary transactional migration; `ALTER TYPE … ADD VALUE` cannot run inside the transaction a migration uses. Stored values are machine identifiers, and display text comes from `next-intl` (Article 6).

**Vocabularies come from Notion's defined option sets, not from the values in use.** A 2026-08-14 audit of this workspace (recorded in the Blueprint repository) found that every live maintenance log was `Open`. A constraint built from observed values would have allowed only `open`, and resolving a ticket would have failed in production. The same audit found options that v5's TypeScript types do not list: unit condition `New` and maintenance status `Closed`. The import's pre-flight re-reads the defined options and stops on anything unmapped (§5.7).

### 4.1 Vocabularies

```ts
// src/lib/db/vocabulary.ts
export const ROLES = ["user", "admin", "super_admin"] as const;   // stored; "anonymous" is never a row
export const UNIT_STATUS = ["available", "in_use", "under_maintenance", "out_of_service", "retired"] as const;
export const UNIT_CONDITION = ["excellent", "good", "fair", "needs_repair", "new"] as const;
export const MAINTENANCE_TYPE = ["issue_report", "preventive_maintenance", "repair", "inspection", "calibration"] as const;
export const MAINTENANCE_PRIORITY = ["low", "medium", "high", "critical"] as const;
export const MAINTENANCE_STATUS = ["open", "in_progress", "resolved", "closed"] as const;
export const FEEDBACK_STATUS = ["new", "reviewed", "fixed", "dismissed"] as const;
export const FLAG_FIELDS = ["description", "image", "name", "category", "location", "materials", "safety_info"] as const;
export const PENDING_STATUS = ["identified", "queued", "researching", "researched", "failed", "approved", "discarded"] as const;
export const ATTACHMENT_OWNER = ["tool", "resource", "maintenance_log", "project", "pending_tool"] as const;
export const MIRROR_ENTITY = ["categories", "locations", "tools", "units", "resources", "maintenance", "projects"] as const;
```

### 4.2 `user`, `session`, `account`, `verification`

Better Auth's tables, generated by its CLI and not hand-edited. What the rest of the schema depends on:

| Column | Type | Notes |
|---|---|---|
| `user.id` | text pk | Better Auth's id; every `created_by`-style column below is `text` referencing it |
| `user.email` | text unique | Lower-cased by Better Auth |
| `user.name` | text | |
| `user.role` | text | Admin plugin; CHECK in `ROLES` added by our migration; default `user` |
| `user.banned`, `user.banReason`, `user.banExpires` | | Admin plugin; a banned user resolves to anonymous |
| `session.*`, `account.*` | | Sessions and the Google account link; `account.accountId` is Google's `sub` |

### 4.3 `categories`, `locations`

- **`categories`:** `name` not null; `group` null. Unique on `(lower(name), lower(coalesce("group", '')))`. Name alone cannot be unique: the live workspace has three case-insensitive name collisions across different groups.
- **`locations`:** `room` and `zone` not null; `map_tag` null, unique when present. Unique on `(lower(room), lower(zone))`.
- **Both** carry `notion_page_id` (text, unique, null) — the source page id from the import.

### 4.4 `tools`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique not null | From the name at creation; stable across renames |
| `name` | text not null | |
| `description` | text null | |
| `category_id`, `location_id` | uuid fk, `on delete set null` | |
| `materials`, `ppe_required`, `tags` | text[] not null default `{}` | |
| `training_required` | boolean not null default false | |
| `use_restrictions`, `emergency_stop`, `notes` | text null | |
| `published` | boolean not null default false | Article 5 |
| `archived_at` | timestamptz null | Retiring a tool; never a hard delete |
| `last_reviewed_at`, `last_reviewed_by` | timestamptz null / text fk `user` null | The **Looks good** mark from an inventory review |
| `notion_page_id` | text unique null | The legacy URL key for Goal 2 |
| `created_by`, `updated_by` | text fk `user` null | Null on imported rows |

### 4.5 `units`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tool_id` | uuid fk `tools`, `on delete cascade`, **null** | The live workspace has one unlinked unit. `/admin/inventory` surfaces unlinked units rather than inventing a tool for them. |
| `unit_label` | text not null | |
| `serial_number`, `asset_tag` | text null | Unique on `(tool_id, lower(serial_number))` when present — the "is this a second unit?" check |
| `status` | text; CHECK `UNIT_STATUS`; default `available` | |
| `condition` | text; CHECK `UNIT_CONDITION`; **null** | Unknown is an honest state; inventing `good` is not |
| `date_acquired` | date null | |
| `notes`, `notion_page_id`, `created_by`, `updated_by` | | |

### 4.6 `resources`

- **Columns:** `tool_id` (fk, cascade, null); `title` not null; `type`; `url` (text null); `published` (boolean not null, default true); `notion_page_id`.
- **`type` is free text with no CHECK.** The workspace defines about a dozen options and intake narrows them to three, so a constraint built from either list would reject values already stored.
- **Files.** A resource's file, if it has one, is an attachment.

### 4.7 `attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_type` | text; CHECK `ATTACHMENT_OWNER`; null | Null together with `owner_id` means uploaded but not yet attached |
| `owner_id` | uuid null | Polymorphic. Integrity is checked by a test walk, not a foreign key. |
| `position` | integer not null default 0 | The lowest is the cover |
| `blob_pathname` | text not null | |
| `access` | text; CHECK in (`public`, `private`) | |
| `public_url` | text null | Public blobs only |
| `content_type`, `size_bytes`, `width`, `height`, `original_filename` | | |
| `uploaded_by` | text fk `user` null | |

When a pending tool is approved its attachments are re-owned to the new tool by updating `owner_type` and `owner_id`; the bytes do not move.

### 4.8 `maintenance_logs`

| Column(s) | Notes |
|---|---|
| `title` | |
| `type`, `priority`, `status` | CHECK constraints |
| `description`, `resolution` | |
| `unit_id` | fk, set null |
| `tool_id` | fk, set null; copied from the unit at write time |
| `tool_name`, `unit_label` | Snapshots, so history survives a retired unit |
| `reported_by_name` | |
| `reported_by_email` | Set **only from the resolved session**, as today |
| `reported_by_user_id`, `assigned_to_user_id` | |
| `assigned_to_name` | Free text from the import |
| `date_reported`, `date_resolved` | date, computed in `LAB_TIMEZONE`, never from the server clock |
| `notion_page_id` | |

There is no CHECK requiring a unit or a tool: the audit found that most live logs have neither, and a ticket with no target is still a ticket. `report_issue` still refuses to file without a title.

### 4.9 `feedback` (today's Flags)

| Column | Notes |
|---|---|
| `tool_id` | fk, set null |
| `field_flagged` | CHECK `FLAG_FIELDS`, null |
| `issue_description` | not null |
| `suggested_fix`, `reporter_name` | |
| `reporter_email` | From the session only |
| `reporter_user_id` | |
| `status` | CHECK `FEEDBACK_STATUS`, default `new` |
| `notion_page_id` | |

### 4.10 `projects`, `project_tools`, `pending_tools`

**`projects`:**

| Column | Notes |
|---|---|
| `slug` | unique |
| `title`, `link` | |
| `body` | Markdown |
| `materials` | text[] |
| `author_user_id` | fk, set null. **Required on new rows**; null only on imported anonymous posts. |
| `author_name` | |
| `published` | default false |
| `published_at`, `published_by` | |
| `notion_page_id` | |

**`project_tools(project_id, tool_id)`** — both foreign keys cascade.

**`pending_tools`:**

```ts
// src/lib/data/pending-tools.ts (types)
export type PendingStatus = (typeof PENDING_STATUS)[number];
export type DuplicateResolution = "new_tool" | "add_unit" | "discard";

export interface PendingTool {
  id: string;
  batchId: string;               // items identified together, in one chat turn
  status: PendingStatus;
  name: string;                  // full name, e.g. "Bambu Lab X1-Carbon Combo"
  brand: string | null;
  categoryHint: string | null;   // resolved to a category at approval
  locationHint: string | null;
  serialNumber: string | null;   // meaningful for add_unit
  duplicateOfToolId: string | null;
  duplicateResolution: DuplicateResolution | null;
  research: ResearchResult | null;
  researchError: string | null;
  workflowRunId: string | null;
  createdBy: string;             // user id; never null
  approvedBy: string | null;
  createdToolId: string | null;
  createdUnitId: string | null;
}

export interface ResearchResult {
  canonicalName: string;
  description: string;
  specs: { label: string; value: string }[];
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  trainingRequired: boolean | null;
  useRestrictions: string | null;
  category: { name: string; group: string | null; existingId: string | null };
  resources: { title: string; url: string; type: "Manual" | "Video" | "Other" }[]; // verified links only
  droppedLinks: string[];        // links that failed verification, with reasons
  sourceUrls: string[];
  evidence: IntakeEvidence;      // from the confidence spec
  confidence: IntakeConfidence;  // computed in code
}
```

- **Storage.** `research` is `jsonb`, validated by the same zod schema on write and on read.
- **Selection is not stored.** Which rows to research is chosen on the card and sent as a list of ids; the batch only groups rows that were identified together.
- **Cleanup.** An item left `identified` for 14 days is discarded, and its attachments deleted, by the daily cron.

### 4.11 `audit_events`

Append-only: the data layer exposes insert and select, never update or delete.

- **Columns:** `at`, `actor_user_id`, `action`, `subject_type`, `subject_id`, `detail` (jsonb).
- **`action` values:** `role.changed`, `user.banned`, `tool.published`, `tool.unpublished`, `tool.archived`, `project.published`, `project.unpublished`, `pending.approved`, `mirror.connected`, `mirror.disconnected`.
- **Scope:** security-relevant actions only. Ordinary edits are not logged here (Non-goals).

### 4.12 Mirror tables

**`notion_mirrors`** — one row per admin who has set one up.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_user_id` | text fk `user`, unique | One mirror per admin |
| `token_ciphertext` | bytea not null | AES-256-GCM; key derived from `AUTH_SECRET` (§8) |
| `parent_page_id` | text not null | The shared Notion page |
| `mapping` | jsonb not null | `{ [entity in MIRROR_ENTITY]?: string }` — database ids |
| `paused_at` | timestamptz null | |
| `running_since` | timestamptz null | The overlap guard |
| `last_synced_at`, `last_status`, `last_error` | timestamptz null / text null / text null | |

**`mirror_pages`** — `mirror_id` (fk, cascade), `entity` (CHECK `MIRROR_ENTITY`), `entity_id` (uuid), `notion_page_id` (text), `pushed_at`; primary key `(mirror_id, entity, entity_id)`.

### 4.13 View models keep their shape

`MakerLabTool`, `MakerLabUnit` and `MakerLabProject` in `src/components/catalog-types.ts` keep their fields, so pages, components and capability outputs are untouched.

- **Two values change meaning.** `id` becomes the Postgres UUID. `slug` becomes a readable slug instead of the Notion page id.
- **Derived fields** (`status`, `trainingLevel`, `trainingLabel`, and unit `condition`) are computed exactly as `catalog.ts` computes them today, from the new stored values.

### 4.14 What a person must do in Notion

Notion has no migrations. These steps are manual and happen in the phase named. Nothing is done to today's databases; they stay as they are on Niti's Notion.

| When | Action | Who |
|---|---|---|
| Phase 1 | Confirm the existing integration behind `NOTION_API_KEY` can still read all eight databases, so the import can run | Isaac |
| Phase 8 | Create an internal integration in one's own Notion workspace, create a page "MakerLab Tools — mirror", share the page with the integration, and paste the token and page URL into `/admin/mirror`. **Create databases** does the rest. | Isaac first; Niti later, on her own workspace |

## 5. Behaviour / flow

### 5.1 Browsing and chat

Unchanged for visitors. Reads come from Postgres, and images come from Blob. The assistant keeps answering in the visitor's selected language; this is the translation feature that matters most and it already works.

### 5.2 Signing in, and changing a role

1. A person signs in with Google. Better Auth's `user.create.before` hook refuses an address outside the allowed domain; otherwise it creates the user (`role = user`, or `super_admin` for an address in `AUTH_SUPER_ADMIN_EMAILS`), creates a session row, and sets the cookie.
2. On every request, `resolveIdentity` looks up the session and its user.
3. A super admin opens `/admin/users`, finds the person, and picks a new role — `user`, `admin` or `super_admin`. The server action:
   - checks `users.manage`;
   - refuses to demote or ban an address in `AUTH_SUPER_ADMIN_EMAILS`, and the UI explains why;
   - calls the admin plugin's `set-role` (or `ban-user`);
   - records `role.changed` (or `user.banned`).
4. The person's next request resolves the new role. Nothing is cached across requests.

**Unhappy paths.**

- **The database is down during sign-in.** Sign-in fails with the error page, like any other uncached request. With sessions in the database there is no half-signed-in state.
- **A banned account** resolves to anonymous, and the header offers sign-in as if they were signed out. Signing in again is refused with the ban reason.

### 5.3 Editing inventory

**(a) `/admin/inventory` — the review table.** Requires `tools.edit`.

1. A server-rendered table of every tool, drafts and archived tools included. Columns: photo, name, category, location, units (count and worst status), state (published, draft, archived), last reviewed, last updated.
2. Filters: state, category, location, free-text search, and **Needs attention** — no photo, no manual, unlinked units, open tickets, or never reviewed.
3. Selecting a row opens the **tool editor** in a side panel:
   - **Tool fields.**
   - **Units:** add one; edit label, serial, asset tag, status, condition, date acquired.
   - **Resources:** add a URL or upload a PDF.
   - **Photos:** upload, reorder, remove.
   - **Looks good**, which sets `last_reviewed_at`. A full inventory review — what Isaac and Luis do after the phases land — is this table filtered to *never reviewed*, one row at a time: good, edit, or archive.
4. **Save** calls `updateTool(id, patch, expectedUpdatedAt)`. If `updated_at` has moved since the panel opened, nothing is written; the panel says someone else changed this tool and offers to reload. There is never a silent overwrite.
5. **Publish**, **Unpublish** and **Archive** write an audit event each.

**(b) Edit mode on `/tools/<slug>`.** Requires `tools.edit`.

- An **Edit** control opens the same tool editor over the detail page. It is designed phone-first, because a SuperMaker marking a printer out of service is standing next to the machine.
- Drafts are reachable at their slug only with `catalog.view_drafts`. Everyone else gets the 404 page.

**Deleting.**

- **Tools** are archived, never deleted, and an archived tool can be restored.
- **Units** can be retired (`status = retired`), or deleted if they have no maintenance history.

### 5.4 Adding equipment

**Step 1 — identify, in the chat** (`tools.add`).

1. The admin opens the chat and sends photos, text, or both. The header's **Add** button seeds "I'd like to add new equipment to the inventory."
2. The model looks at the photos and the words and works out what each item is. For example, "a Bambu X-something" plus a photo of the front becomes *Bambu Lab X1-Carbon Combo*.
   - The intake prompt allows at most two web searches, and only to settle a model name. The route's per-turn cap of 5 remains the hard limit.
   - It does not look up manuals, specs or links; that is Step 2.
3. The model calls `identify_tools`:

   ```ts
   identify_tools({
     items: Array<{
       name: string;              // the full model name it settled on
       brand?: string;
       categoryHint?: string;     // e.g. "3D Printing"
       locationHint?: string;
       serialNumber?: string;     // read from a plate, or said by the person
       attachmentIds: string[];   // which uploaded photos show this item
     }>;
   }) → {
     batchId: string;
     items: { id: string; name: string; duplicateOf: { id: string; name: string; slug: string } | null }[];
   }
   ```

4. The server:
   - creates `pending_tools` rows (status `identified`, one `batchId`, `created_by` from the session);
   - attaches the photos;
   - runs the **duplicate check** against published tools, drafts and other pending items (a normalized name-plus-brand match first, then `pg_trgm` similarity above a threshold);
   - emits a `data-intake-table` card.
5. **The intake table card** is an editable table with a checkbox on every row.
   - **Columns:** checkbox, photo, name, brand, category, and a duplicate badge.
   - **Selection:** a header checkbox selects all or none; row checkboxes select some. Every row starts selected.
   - **Row actions:** edit inline, or remove.
   - **Duplicate rows** must choose one of **Add as another unit** (which asks for a serial number), **It's a different tool**, or **Remove**. An unresolved duplicate cannot be selected.
   - **Edits** go through `PATCH /api/pending-tools/[id]`, never through the model, so fixing a typo costs no tokens.
   - **Research selected (N)** is disabled while any selected row is being edited, and when nothing is selected. Unselected rows stay `identified` and appear on `/admin/intake` for later.

**Step 2 — research, in the background.**

6. **Research selected (N)** calls `POST /api/pending-tools/research` with the item ids. The route:
   - checks `tools.add`, and that every item belongs to a batch the caller created or that the caller holds `tools.approve`;
   - enforces the limits: 25 items per request, and 100 researched items per person per day;
   - sets the items to `queued`;
   - calls `start(researchBatch, [batchId, itemIds])` and stores the run id on each item;
   - returns immediately.
7. The card changes to "Researching 5 tools — you can close this. Results will be on the Intake page," with a link to `/admin/intake`.
8. **Add as another unit** rows skip research: they become `researched` straight away with their target tool, because there is nothing to look up.
9. The workflow researches the rest, three at a time (§3.7). Each item finishes as `researched` or `failed` independently.

**Step 3 — review and approve** (`/admin/intake`, `tools.approve`).

10. The intake page lists every pending item, newest batch first, with its status. A `researched` item opens its **preliminary page**, `/admin/intake/[id]`, which shows:
    - the proposed record, editable in the same fields as the tool editor;
    - the confidence strip, reused from the identification card;
    - sources, verified links and dropped links;
    - the photos.

The list polls every 5 seconds while any item in view is `queued` or `researching`.
11. **Actions on a preliminary page.**
    - **Approve** — creates the tool, its units, resources and attachments in one transaction, **published**, and records `pending.approved` and `tool.published`. This is the human approval Article 5 requires.
    - **Approve as draft** — the same, unpublished, for an admin who wants to finish it in the editor first.
    - **Add unit** — for an `add_unit` item, creates the unit on the existing tool.
    - **Research again**, or **Discard**.
12. **Low confidence** disables both Approve actions until the admin either changes the name or brand and researches again, or ticks "I've checked this" and adds a note. This is the confidence spec's behaviour gate, moved from the chat card to the preliminary page.

**Unhappy paths.**

- **The workflow fails to start:** the items stay `queued`, the error shows, and a **Retry** button appears on the intake page.
- **The model cannot identify an item:** it asks one short question instead of calling `identify_tools` for that item.
- **The browser cannot encode a photo:** identification proceeds from the text, and the photo still attaches.
- **Two admins add the same tool at the same time:** the second duplicate check sees the first admin's pending row.
- **Research finds nothing:** the item becomes `researched` with low confidence and empty resources, never invented ones.

### 5.5 Projects

- `/projects/new` requires `projects.submit`, which every signed-in person has. Anonymous visitors see "Sign in to share your project" in place of the form.
- The author is the signed-in user; the typed-name field is removed.
- Submissions stay unpublished until an admin publishes them on `/admin/projects`.

### 5.6 Maintenance and corrections

Anyone can still report a problem or a correction. Admins can no longer work tickets in Notion, so this spec includes the smallest queues that keep that work possible:

- **`/admin/maintenance`** (`maintenance.manage`): list tickets; change status, priority and assignee; write a resolution.
- **`/admin/corrections`** (`feedback.manage`): list corrections; mark them reviewed, fixed or dismissed; link to the tool editor.

Notifications, service targets and assignment rules are out of scope.

### 5.7 Import

The import replaces cutover planning: it is a one-time script Isaac runs by hand into the production database before the read-path phase merges, and then the app simply reads Postgres.

**`scripts/import-notion.ts`**, read-only against Notion:

1. **Pre-flight.** Read each database's schema and compare every select and multi-select option with §4.1. **Stop** on an unmapped value, naming the database, property and option. Silently mapping to a default is how data gets lost.
2. **Read** every source database, paginated, at 3 requests per second.
3. **Write** in dependency order, one transaction per entity, recording `notion_page_id` on every row.
4. **Copy files.** Download each Notion-hosted file during the run and upload its bytes to Blob. Notion file URLs expire about an hour after they are read, so a URL is never stored.
5. **Split maintenance descriptions.** v5 composes "What happened / Reported by / Date reported / Priority" into one description. The import parses these back into columns, and keeps the original text in `description` whenever parsing is not exact.
6. **Idempotent.** A re-run updates rows by `notion_page_id` and reports a diff, so it can be run on a preview branch first and again into production.

**`scripts/verify-import.ts`** checks:

- row counts per entity;
- relation integrity — every unit's tool, every resource's tool;
- files — every attachment has bytes in Blob;
- five named tools — their rendered `MakerLabTool` objects compared field by field between the Notion path (on the branch before the switch) and the Postgres path.

**The switch**, in Phase 2: import into a Neon preview branch and click through the preview; import into production; merge the read-path PR; check the gallery count, three tool pages with images, an old `/tools/<notion-id>` URL, an anonymous chat answer, and a filed report. If something is wrong, fix it forward; there is nothing to roll back to that anyone is using.

### 5.8 The mirror at work

Setup, push and triggers are in §3.8.

- **A failed push** is shown on `/admin/mirror` as the last status and error, and retried on the next trigger.
- **Notion's API is down:** the app is unaffected.
- **A mirror database was deleted by hand:** that entity's push fails with "database not found", the page shows it, and **Create databases** recreates only the missing ones.
- **The token was revoked in Notion:** the push fails with 401, the page says the connection needs a new token, and the mirror pauses itself.

## 6. UI

Admin pages follow the "Architectural Brutalism + Blueprint Archive" system (`docs/MakerLab_design/DESIGN.md`). They are server components, with client islands for the tool editor, the intake table card, and the mirror page's controls.

| Surface | Components | Notes |
|---|---|---|
| Header | `AdminLink` (any admin permission); existing **Add** (`tools.add`) | Driven by `role` from `/api/identity` |
| `/admin` | `AdminHome`: counts, intake queue, open tickets, own mirror status | |
| `/admin/inventory` | `InventoryTable`, `InventoryFilters`, `ToolEditorPanel` | |
| `/tools/<slug>` | `EditToolControl` and the same `ToolEditorPanel` | |
| `/admin/intake` | `IntakeList` | Polls while research runs |
| `/admin/intake/[id]` | `PreliminaryToolPage`, reused `ConfidenceStrip` | The page an admin approves from |
| Chat | `IntakeTableCard` (new `data-intake-table` part) | Replaces `IdentificationCard` for intake |
| `/admin/users` | `UsersTable`, `RoleSelect` | Super admin only |
| `/admin/mirror` | `MirrorConnect`, `MirrorMapping`, `MirrorStatus` | Own mirror only |
| `/admin/maintenance`, `/admin/corrections`, `/admin/projects` | A list with status controls | Minimal (§5.6) |
| `/projects/new` | Sign-in prompt for anonymous visitors | |

**States.**

- **Loading:** skeleton rows.
- **Empty:** a sentence naming what is missing and the action that would change it — "No drafts." "Nothing is waiting for review."
- **Database unavailable:** the error state, never sample data.
- **Conflict:** an inline message in the panel. Never a modal that could lose unsaved edits.
- **Saved:** an inline status in the panel.

**Mobile.**

- The inventory table becomes a card list, and the editor panel becomes a full-screen sheet.
- Edit mode on a tool page is phone-first.
- The intake table card stacks each row's fields vertically, with the checkbox first.

**Strings (Article 6, as amended).** Every new user-facing string goes through `next-intl`, with the English key added in the same PR. The other locale files are not edited per phase; a missing key falls back to English at runtime (`src/i18n/request.ts` merges `en.json` under the requested locale's messages). Phase 9 fills the other locales in one pass. The admin surfaces add roughly 250 keys.

## 7. Relationship to existing work

### 7.1 Constitution amendments (in this PR)

- **Article 3, one sentence.** "The mock catalogue serves the data layer" becomes "An in-process Postgres (PGlite) with a demo seed serves the data layer."
- **Article 4, one word.** "Notion, Anthropic, and any service added later" becomes "Postgres, Anthropic, Notion, and any service added later."
- **Article 5, replaced:**
  > **Writes are drafts by default.** Anything the agent or a student creates — catalogue entries from intake, project submissions — is written unpublished. Publishing takes a person with the permission, in the app, and is recorded in `audit_events`. Do not add a write path that publishes without one.
- **Article 6, one clause changed.** "all 12 locale files updated together" becomes "English in the same PR; the other locales fall back to English until a translation pass fills them."
- **Article 7, replaced:**
  > **Postgres is the source of truth; Notion is a mirror.** The app reads and writes its Postgres database. A Notion mirror, when an admin connects one, receives a one-way copy and is never read. Staff edit records in the app.

### 7.2 Specs this partly supersedes

| Spec | Superseded | Kept |
|---|---|---|
| Auth and rate limiting (2026-07-29) | §3.3 env-list roles; the in-memory adapter and the hand-written `makerlab.identity` cookie; §8 "no capability is role-gated" | Google sign-in through Better Auth, domain enforcement, rate-limit tiers |
| Chat inventory intake (2026-06-01) | §4 research in the turn; §5 Notion write layer; §6.3 identification card for intake | §6.1 vision, §6.2 dictation, the capability registry |
| Intake confidence (2026-07-29) | §3.3 fan-out inside the chat turn | Evidence reporting, graded confidence, the behaviour gate (moved to the preliminary page) |
| Student projects gallery (2026-07-29) | Anonymous submission; moderation in Notion | Gallery, detail pages, "built with this" |
| Operational hardening (2026-07-29) | Backing up Notion | Nightly backup to private Blob, 30-day retention |
| Report a correction (2026-07-29) | The Flags database | The form, `report_correction`, the fields |
| QR codes (2026-07-29) | Page id in the URL | Arrival behaviour; old labels redirect |

When the phase that supersedes each one merges, that spec gets a dated amendment pointing here (`DRIFT.md`).

### 7.3 PR #31 (held)

PR #31 fixes chat vision and makes intake staff-only through `minimumRole`. It is held because production sign-in is not configured.

- **The vision fix** is a prerequisite for Step 1 of §5.4. Merge it on its own, or carry it into Phase 6.
- **`minimumRole`** becomes `requiredPermission` in Phase 4. If #31 has merged by then, Phase 4 migrates `capabilitiesForRole` to the permission-based version; if not, Phase 4 introduces the permission version directly.

### 7.4 Other

- **Branches:** no feature branches are in flight; everything earlier has merged.
- **`docs/v5-plan.md` §9.6** (admin-leverage features) is partly delivered by §5.3 and §5.6.
- **Blueprint** is not a dependency. Its 2026-08-14 audit of this Notion workspace is cited for data facts only.

## 8. Security and safety

**Authorization.**

- `can(identity, permission)` runs server-side in every server action, route handler, and capability composition. Hiding a control is presentation only.
- `users.manage` belongs to `super_admin` alone.
- An address in `AUTH_SUPER_ADMIN_EMAILS` cannot be demoted or banned from the UI, so the lab can always recover.
- The admin plugin's `impersonate-user` and `create-user` endpoints are disabled; nothing in the app needs them.
- A mirror can be read, run, paused and disconnected only by its owner.
- Server actions are reachable by a direct POST, so each one checks its own permission and trusts nothing from the page that rendered it.

**Rate limiting (Article 4).**

| Route | Limit |
|---|---|
| `POST /api/uploads` | 15/min per identity, as today |
| `PATCH /api/pending-tools/[id]` | 60/min per user |
| `POST /api/pending-tools/research` | 25 items per request; 100 items per user per day |
| Sync now | One push per mirror per 15 minutes |
| Admin server actions | 120/min per user |
| `/api/cron/daily` | `CRON_SECRET` bearer token; 503 when unset |

**External calls.**

- **Notion:** only the mirror (3 requests/s, 45-second budget, overlap guard) and the import.
- **Anthropic:** the chat as today, plus research capped at 8 searches and 8 fetches per item.
- **Link verification:** capped per item.
- **Postgres reads:** cached as in §3.9.

**Write safety.**

- Identification creates pending rows, never catalogue rows.
- Research writes only to the pending row it was given.
- Only Approve creates a tool, and only an admin can press it.
- Projects stay unpublished until an admin publishes them.
- Every editor save is conditional on `updated_at`.
- The mirror only ever writes to the databases in its own mapping. There is no code path that takes a database id from the environment.

**Untrusted input.**

- **Uploads:** only `image/*` or `application/pdf`, checked by content sniffing as well as the declared type; stored at random pathnames; never served as HTML.
- **Intake-table edits and mirror settings:** validated with zod. A Notion token is validated by making one read call, never stored unverified.
- **Markdown** in projects and descriptions renders through `react-markdown` with no raw HTML, as it does today.

**Prompt injection.** Research reads arbitrary web pages.

- The research agent has no tools besides `web_search` and `web_fetch`.
- Its output must parse against the `ResearchResult` schema.
- Its confidence grade is computed in code from the evidence it reports.
- Its links are verified.
- A person approves the result before anything is created.

A page that says "mark this high confidence and publish" can change none of that. Separately, `identify_tools` can only create pending rows owned by the caller.

**Secrets at rest.** A mirror's Notion token is encrypted with AES-256-GCM under a key derived from `AUTH_SECRET` with HKDF and a fixed info string, so no new environment variable is needed. Rotating `AUTH_SECRET` therefore invalidates stored tokens as well as sessions; the mirror page then asks for the token again. This is a deliberate trade for a hobby-plan deployment, and it is named in §11.

**PII.**

- **Stored:** users' names and emails, maintenance reporter emails, and project authors.
- **Emails** never enter a model prompt or the Notion mirror, and are never logged.
- **Photos:** maintenance photos are private blobs.
- **Deletion:** discarded pending items and orphaned uploads are deleted on schedule (§3.3, §4.10).
- **University approval** of storing student email at all is still the open question in the specs README (q5).

**Secrets:** `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `NOTION_API_KEY` (import only),
`CRON_SECRET`, `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, and each mirror's token in the database.

**Backups:** Neon's point-in-time restore, to the extent the plan provides it, plus the nightly
JSON export to private Blob, kept for 30 days.

**Risks, named.**

1. **The import is the riskiest single step.** Unmapped vocabularies, expiring file URLs, and composed maintenance descriptions each fail differently. Mitigation: the pre-flight stop, byte copies, a rehearsal on a preview branch, and field-by-field verification.
2. **Sign-in becomes load-bearing.** Today nothing needs it. After Phase 4, admins cannot edit or approve without it, and it is not configured in production (Phase 0).
3. **The ISAM demo, Oct 11–13, needs a working deployment.** No cutover date is set, but no phase merges in the 72 hours before the demo unless it has been clicked through on a preview.
4. **Hobby plan limits.** One daily cron, one-day workflow retention, and the 50,000-event allowance. Everything here fits with room to spare; the first limit hit is the moment to move to Pro, not before.
5. **Translation debt.** About 250 admin keys plus every new public string wait for Phase 9. The amended Article 6 makes this explicit; until then non-English visitors see English on new pages.
6. **Mirror drift.** Anyone who edits a mirror database loses the edit. Mitigation: the database description, and saying so at the SuperMaker session.
7. **Key coupling.** Rotating `AUTH_SECRET` forgets mirror tokens (§8, Secrets at rest).

## 9. Phased build order

Each phase is its own PR and leaves `main` deployable. Production switches to Postgres when Phase 2 merges.

| # | Phase | Delivers | Depends on | Parallel with |
|---|---|---|---|---|
| **0** | Prerequisites (people) | Google OAuth client and `AUTH_*` in production; Neon installed for production and preview; Blob store linked; `AUTH_SUPER_ADMIN_EMAILS=ies22@cornell.edu`; this spec and the constitution amendments merged | — | — |
| **1** | Schema and import | `src/lib/db/*` (schema, migrations, client, triggers, demo seed); `scripts/import-notion.ts` with pre-flight; `scripts/verify-import.ts`. No runtime change. | 0 | — |
| **2** | Read path and switch | `catalog.ts`, `projects.ts`, capability reads, chat manuals, `/api/health`, the legacy-id redirect, Blob images; E2E on PGlite; the import run into production before merge; Notion read code, the mock catalogue and the Notion scripts retired (each deletion proposed separately); repo docs say Postgres | 1 | — |
| **3** | Write paths | `report_issue`, `report_correction`, project submission, `POST /api/uploads`, `/api/cron/daily` (backup, cleanup) | 2 | 4 |
| **4** | Accounts | Better Auth on the Drizzle adapter with database sessions and the admin plugin; the `makerlab.identity` cookie retired; the access-control declaration and `can()`; `role` in `/api/identity`; `requiredPermission`; `/admin/users`; `audit_events`; projects require sign-in; the env lists retired | 2 | 3 |
| **5** | Inventory editing | `/admin/inventory`, `ToolEditorPanel`, edit mode on tool pages, publish and archive, Looks good, `/admin/maintenance`, `/admin/corrections`, `/admin/projects`, cache-tag invalidation | 3, 4 | — |
| **6** | Two-step add-tool | `pending_tools`, `identify_tools`, `IntakeTableCard` with selection, `src/lib/research/*`, the `researchBatch` workflow, `/admin/intake` and preliminary pages; `research_tool` and `propose_listing` leave the chat | 5 | — |
| **7** | Load and validate | Not code: Isaac and Luis review the imported inventory through `/admin/inventory`, add missing tools through intake, and file what breaks as issues | 6 | 8 |
| **8** | Notion mirror | `notion_mirrors`, `mirror_pages`, `/admin/mirror`, the `mirrorPush` workflow, `requestMirrorPush()`, the cron backstop; the first mirror connected to Isaac's Notion | 5 | 7 |
| **9** | Translation pass | Fill every locale file from `en.json` with a translation service, reviewed; decide whether to drop to 10 locales (§11); admin pages last | 8 | — |

After Phase 9: the SuperMaker session, then the student beta.

## 10. Testing

Every layer runs with no environment variables and no network: PGlite for the database, MSW for Notion and Blob, and `streamText` / `generateText` stubbed for models.

**Unit.**

- **Vocabulary mapping:** every Notion option maps to a stored value, and an unmapped option raises.
- **Slugs:** generation, collision suffixes, stability across renames.
- **Permissions:** `can()` for every role and permission; the implicit `super_admin` grant; the env floor; anonymous holds nothing.
- **Legacy ids:** detection and redirect target.
- **Mirror property builders** for each entity, asserting emails are never present.
- **Token encryption:** round-trips; a different key fails to decrypt.
- **The `ResearchResult` schema:** accepts well-formed results; rejects extra and wrongly typed fields.
- **The duplicate matcher:** normalization, brand-aware matching, the threshold.
- **Import mappers**, including the maintenance description parser, over fixtures shaped like the real data.
- **Message fallback:** a key missing from a locale resolves to English; a key present in a locale but absent from `en.json` fails the locale test.

**Integration** (PGlite + MSW).

- **Query modules:**
  - `created_by` and `updated_by` stamping;
  - the `updated_at` trigger;
  - a save with a stale `expectedUpdatedAt` writes nothing and says so;
  - archive instead of delete;
  - approval is transactional and re-owns attachments.
- **Import against a recorded fixture dump:**
  - counts and relations;
  - file bytes copied to a mocked Blob;
  - a pre-flight stop on an injected unknown option;
  - idempotent re-runs.
- **Mirror against mocked Notion:**
  - create on the first run, update on the second;
  - an archived tool archives its page;
  - dependency order;
  - 429 with `Retry-After`;
  - the overlap guard prevents a second push;
  - on partial failure, `last_synced_at` does not advance;
  - a paused mirror is skipped;
  - a 401 pauses the mirror and records the error.
- **Routes:**
  - `/api/uploads`: type, size, anonymous rate limit;
  - pending-tools `PATCH`: permission and ownership;
  - research start: limits, only the given ids are queued, and `start()` called with them;
  - the cron route: the secret is required.
- **Workflow steps**, called directly with the model stubbed: `researchItem` for success, verified and dropped links, a retryable error, and a fatal error.
- **One in-process `@workflow/vitest` test** of `researchBatch`, asserting that one failing item does not stop the others.

**Component.**

- `InventoryTable` filters, including Needs attention.
- `ToolEditorPanel`:
  - dirty state;
  - the conflict message keeps unsaved edits.
- `IntakeTableCard`: select all, some and none; inline edit; remove; duplicate choice; an unresolved duplicate cannot be selected; Research disabled with nothing selected.
- `PreliminaryToolPage`: Approve disabled at low confidence until the override is ticked.
- `MirrorStatus`: shows last synced, paused, and the last error.
- The projects form shows the sign-in prompt to anonymous visitors.

**E2E** (Playwright, PGlite demo database).

The E2E server gets a test-only `AUTH_SECRET`, and the demo seed inserts a `user` and `session` row per role, so a test signs in by setting the session cookie. This amends the auth spec's E2E note and still makes no network call.

1. An anonymous visitor browses, opens a tool, reports a problem, and cannot submit a project.
2. A user submits a project; it is not in the gallery until an admin publishes it.
3. An admin edits a tool's description in `/admin/inventory`, and the public page shows it.
4. An admin marks a unit out of service from the tool page at a phone viewport.
5. An admin adds three tools through chat (a stubbed stream emits the intake table), deselects one, edits one, presses Research (the workflow is stubbed to finish), opens the preliminary page and approves. The tool appears in the gallery; the deselected one waits on the intake page.
6. A super admin changes a user to admin, and that person's Add button appears on their next page load.
7. `/tools/<notion-page-id>` redirects to `/tools/<slug>`.
8. An admin connects a mirror (Notion mocked), presses Sync now, and sees a last-synced time.

**Cases that would embarrass us in production.**

- The import silently drops, or defaults, rows with an unknown select value.
- Images break an hour after the switch because URLs were copied instead of bytes.
- A demoted admin keeps editing.
- Printed QR codes 404.
- Research creates a tool nobody approved.
- The last super admin demotes themselves.
- Two people edit one tool and one person's change vanishes.
- Production serves demo data because `DATABASE_URL` went missing.
- A mirror token shows up in a log line or an error message.
- The assistant stops answering in the visitor's language because a prompt string was moved.

## 11. Open questions

Decisions the lab made on 2026-09-14 are in the body. What is left:

| # | Question | Recommendation | Who | By |
|---|---|---|---|---|
| 1 | **Locale count.** 12 today; "maybe keep like 10". Dropping two is deleting two files and two entries in `LOCALES`, and it halves nothing. | Keep 12 unless the translation pass is the constraint | Isaac | Phase 9 |
| 2 | **Who owns the Google OAuth client** — Cornell's Google Workspace or a personal Google Cloud project — and so who can rotate it after handover. Isaac configures it either way; the values go into the production environment variables (§3.11). | Cornell-owned | Isaac, Niti | Phase 0 |
| 3 | **Initial admins.** Who is `admin` at launch, seeded from today's `AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS`, and who is added at the SuperMaker session | Everyone on either list becomes `admin`; the rest are promoted at the session | Niti, Isaac | Phase 4 |
| 4 | **Reporter names in the mirror.** Emails are excluded; should names be too? | Names in, emails out | Niti | Phase 8 |
| 5 | **Mirror token key.** Derived from `AUTH_SECRET` (§8) or a separate `MIRROR_KEY` env var that survives session-secret rotation | Derived, for now; a separate key if rotation ever becomes routine | Isaac | Phase 8 |

Settled since the first draft: projects are for anyone *signed in*, never anonymous visitors; permissions are declared in code, the ordinary way; `ies22@cornell.edu` is permanent, so the super-admin floor needs no succession plan; the import is a one-time script run by hand.

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a design changed usually outlives the change.

### 2026-09-14 — Phase 1 built, with as-built details

**What changed.** Phase 1 (§9) is implemented: `src/lib/db/` (schema, three migrations, the PGlite and Neon constructors, `getDb()`, the demo seed, slugs), `src/lib/import/` (vocabulary mapping, pre-flight, the ticket-description parser, row mappers, the file copier, the Notion snapshot reader and the runner), and three scripts. Details the spec did not name:

- **npm scripts.** `db:generate` runs `drizzle-kit generate` after a schema edit. `db:migrate` applies committed migrations to `DATABASE_URL` and exits 0 with a note when it is unset. `import:notion` is the one-time import, with `--dry-run` (reads Notion into an in-memory PGlite, copies no files, prints the report — the rehearsal §5.7 describes, needing no Neon) and `--skip-files`. `verify:import` is §5.7's verification script.
- **`DB_MIGRATIONS_DIR`** overrides where the migrations folder is resolved from (`src/lib/db/migrations` under the working directory by default). Every entry point runs from `v5/`, so it is unset in practice; it exists for anything that does not.
- **`attachments.source_key`** (text, unique, nullable) is the import's idempotency key — Notion page id, property and index — so a re-run recognises a file it already copied. Null on files uploaded through the app.
- **`created_by`-style columns have no foreign key yet.** They are `text` and reference Better Auth's `user.id` once Phase 4 creates that table; Phase 4's migration adds the constraints.
- **Scripts load the database and import modules under plain Node** (type stripping). Those modules therefore use relative imports with `.ts` extensions, no `@/` alias, no `server-only`, and no TypeScript-only class syntax. Nothing under `src/lib/db/` or `src/lib/import/` is imported by a client component.
- **`rawRows(db, sql)`** is the one place raw SQL results are typed, because the driver-agnostic `Db` handle cannot know a driver's result shape.
- **The five-tool field-by-field comparison** in §5.7's verification waits for Phase 2, which is what renders the Postgres side. `verify:import` checks counts, relations and Blob bytes now.
- **`db:migrate` is not yet part of the Vercel build.** Phase 2 adds it to the build command when Neon exists; until then a build needs no database.

**Status.** Accepted. Each is a detail the spec left to implementation.

### 2026-09-15 — Phase 2 built, with as-built details

**What changed.** Phase 2 (§9) is implemented: every read path is on Postgres through `src/lib/data/` (catalogue, projects, resources, maintenance history), `src/lib/catalog.ts` and `src/lib/projects.ts` keep their exports and their `"use cache"` tags over the new modules, the health route probes Postgres, `/tools/<notion-page-id>` redirects to the slug, the QR-label script reads Postgres, and the repo docs say Postgres. `npm run build` now runs `db:migrate` first. Details the spec did not name:

- **A bridge from Postgres ids to Notion page ids, for the writes that are still on Notion.** Every id the app hands around is now a Postgres uuid, but a correction, a maintenance ticket and a project submission still create Notion pages whose relations address Notion *page* ids, and Notion refuses a relation it cannot find. `src/lib/data/notion-ids.ts` reads the page id the import recorded on `tools` and `units`; a row that has none (created after the import, or the demo seed) is written *without* the relation and logged, never with an id Notion would reject. The module leaves with those writes in Phase 3.
- **Tool and project pages are no longer prerendered at build.** `generateStaticParams` needed a reachable database during `next build`, which §3.2 says a build must not need, and Cache Components rejects an empty list. The pages render on first request and are then served from the `catalog` / `projects` cache tags. Two visible consequences: an unknown slug and a legacy-id redirect are resolved inside the dynamic part of a partially prerendered page, so the HTTP status is 200 and the browser performs the not-found render or the redirect; printed QR labels still land on the right page. A real 404 status and a real 308 are a follow-up, not a Phase 2 goal.
- **E2E runs against a production build, with one retry.** Under `next dev`, Playwright's fourteen parallel workers triggered first compiles of several routes at once and Turbopack rewrote the root layout's client chunk mid-response (`ERR_CONTENT_LENGTH_MISMATCH`), so pages intermittently never hydrated and four tests failed on every run. The Playwright web server is now `npm run build && next start` with `DATABASE_URL` and the Notion env blanked, which also exercises the bundled server with PGlite — the same configuration a Vercel preview without a database runs. That leaves about one test execution in a hundred failing, always the same shape: a `Link` click or the locale switch whose request is sent and answered within milliseconds (the trace shows the RSC fetch completing) but whose result the App Router never commits — the URL or the rendered locale stays put for the full assertion timeout. The server is not the bottleneck (56 concurrent requests answer in ~150 ms), no console error is logged, and a hydration-marker wait made no difference, so it is filed as a client-router race under load rather than an app defect. `retries: 1` keeps the gate green and Playwright reports such a test as *flaky*, so the count stays visible instead of hidden. Worth revisiting on the next Next.js upgrade.
- **`/api/health` reports `database: "ok" | "unreachable" | "demo"`** and `catalog: "live" | "demo"` in place of the Notion fields; a demo substrate is `status: "ok"`, an unreachable database `degraded`, and no error text ever reaches the body.
- **Cache tags.** Every catalogue read is tagged `catalog` only; §3.9's `tool:<id>` tag on detail reads waits for the write paths that would invalidate it, which is also where the choice of key (slug or uuid) belongs.
- **`src/lib/data/uuid.ts`** guards every id lookup so free text from a tool call never reaches Postgres as a bad uuid cast. `listResources()` has no production caller yet; the chat route uses `listResourcesForTool()`.
- **Retired but not deleted:** `src/components/mock-catalog.ts` (only the offline eval fixtures still pin its data), the Notion read helpers in `src/lib/notion.ts`, `test/fixtures/catalog.ts`, and the four Notion maintenance scripts §3.10 lists. Each deletion is proposed separately (constitution working agreements).
- **English fallback for messages is in** (§6, Article 6 as amended): `src/i18n/request.ts` lays each locale file over `en.json`, so a string added only to English renders in English elsewhere. The first such strings are the sign-in notices in the header, which now say why a click on *Sign in* went nowhere instead of doing nothing (this deployment has no sign-in configured, or the request failed).
- **Project URLs use the slug.** `MakerLabProject` gains `slug`, the gallery and a tool's "built with this" link to `/projects/<slug>`, and the project page accepts either the slug or the uuid.
- **The demo seed has one published sample project** (a laser-cut lamp built with both demo tools, with two bundled photos under `public/sample-projects/`, materials and an outside link) and gives the Trotec a photo attachment, since its bundled image file is not named after the tool. The gallery, the project page and "built with this" are therefore exercised end to end without a database.

**Status.** Accepted. The bridge and the prerender change are the two a reader should know about before Phase 3.

### 2026-09-21 — Phase 3 built, with as-built details

**What changed.** Phase 3 (§9) is implemented: the last three student-facing writes are on Postgres (`report_issue` → `maintenance_logs`, `report_correction` → `feedback`, `POST /api/projects` → `projects` + `project_tools`), `POST /api/uploads` replaces `POST /api/upload-notion` (Vercel Blob plus an `attachments` row), and `GET /api/cron/daily` replaces `GET /api/admin/backup` (a JSON export of every Postgres table, a 30-day prune, and an orphaned-upload sweep). The whole phase runs with every environment variable unset. Details the spec did not name:

- **The upload id is a cross-phase contract.** `UploadedImage.file_upload_id` became `attachmentId`, and the chat hint became `[Attached photos: attachment_id=<uuid> name=<name>; …]`. `report_issue`'s input is `photo_attachment_ids: string[]`. The ripple the spec does not mention is intake: §9 leaves `create_tool` on Notion until Phase 6, and a Postgres uuid is not a Notion `file_upload_id` — Notion rejects the *whole page* when it does not recognise one. So `create_tool` now sends **no** images and pushes a warning saying the photos stayed in the app, and the intake prompt tells the model to relay that rather than claim the photo is on the listing. Losing the picture beats losing the listing (Article 4).
- **`previewUrl` is `string | null`, not the unconditional string §3.3 implies.** A private blob has no URL an unauthenticated viewer can follow, so a maintenance photo comes back with `previewUrl: null`; both clients already hold a local `URL.createObjectURL` preview, so nothing is lost.
- **Chat uploads are private, which §3.3's table does not cover.** The table lists maintenance photos as private and tool/resource/project photos as public, but a photo attached in chat is not yet either — it may become a ticket photo (which may show a person) or a pending-tool photo. It is stored `private`, the conservative half, since nothing renders a chat photo on a public page. Phase 6 decides what happens when such a photo is approved onto a tool.
- **`src/lib/blob.ts` gained a second write verb rather than a parameter.** Its doc comment said `access: "private"` and `addRandomSuffix: false` were "not a caller's decision"; both are wrong for uploads. `put` still writes backups privately at the exact pathname it is given, because that pathname *is* the retention key. `putUpload` writes at a random pathname (so an unpublished tool image is unguessable, and two `IMG_0001.jpg`s do not collide) with the caller's access. The filename is sanitised before it becomes part of a pathname.
- **`/api/cron/daily` kept both of `/api/admin/backup`'s accepted callers.** §3.10 folds the backup into the cron without saying whether the documented hand-trigger survives. It does: the cron bearer *and* `ADMIN_REVALIDATE_SECRET`, because `docs/deploy.md` tells an operator to run the job by hand after the first deploy. "Unconfigured" therefore means neither secret is set, which is the credential-free default.
- **The backup discovers its tables rather than listing them.** `backupTables()` filters the schema module for Drizzle tables, the same reasoning the old route used when it derived its targets from the env contract: Phase 4's four Better Auth tables and Phase 6's `pending_tools` are backed up because they exist, not because somebody remembered. The file is `version: 2, source: "postgres"`; version 1 held raw Notion pages, and a restore has to be able to tell them apart. Its date is UTC, not `LAB_TIMEZONE` — the retention window reads that date back, and it names a file rather than a ticket.
- **Cleanup deletes the blob before the row.** A row without a blob is a broken image on a page; a blob without a row is invisible and gets swept next run. Of the two half-failures the second is preferable, so the order is deliberate and tested. Pending-tool expiry (§4.10) is deliberately out of scope: that table has no writer until Phase 6.
- **Uploads clean up after themselves.** A blob write that succeeds and whose `attachments` insert then fails deletes the blob before answering 502 — the cron only sweeps files that *have* a row, so those bytes would otherwise be unreachable forever.
- **Phase 3 adds no `revalidateTag`.** §3.9 says writes invalidate their tags, but none of these writes touches a cached read: tickets and corrections are not cached, and a submitted project is unpublished so it cannot appear in `getPublishedProjects()`. The Phase 2 amendment deferred the `tool:<id>` tag to "the write paths that would invalidate it" — that turns out to be Phase 5's publish.
- **No migration was needed.** Phase 1 created every column and CHECK these writes use, including `attachments.owner_type`'s list.
- **Retired but not deleted** (constitution working agreements — each deletion is proposed separately): `src/lib/data/notion-ids.ts` and its test, now importer-less; `src/app/api/upload-notion/` and `src/app/api/admin/backup/`, both superseded and no longer scheduled or linked. Each file carries a header saying so. `src/lib/notion.ts` itself cannot be retired — intake still uses `createTool`/`createUnit`/`createResource`/`findOrCreateCategory`/`findOrCreateLocation`, and `src/lib/import/source.ts` still uses `hasProjectsEnv`/`fetchAllProjects` — but `createMaintenanceLog`, `createProject` and `ProjectWriteFields` are now dead exports.
- **E2E got more real.** `corrections.spec.ts` and `projects.spec.ts` each gained one uncaptured, end-to-end submission against the E2E server's own PGlite, which was impossible while the write needed a Notion credential. The project one asserts that the submitted project does **not** appear in the gallery — Article 5's draft-by-default, made visible. `playwright.config.ts` now blanks `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET` too, so a developer with a real store linked gets the same run as CI and no test can put bytes in it.

**Status.** Accepted. The upload-id rename and intake's photo warning are the two a reader should know about before Phase 4.

### 2026-09-21 — Phase 4 part 1 built (accounts and permissions), with as-built details

**What changed.** The first half of Phase 4 (§9) is implemented: Better Auth on the Drizzle adapter with **database sessions** and the admin plugin (§3.4), the access-control declaration and `can()` (§3.5), `requiredPermission` on capabilities, `role` in `/api/identity` from the database, and `AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` retired in favour of `user.role` with `AUTH_SUPER_ADMIN_EMAILS` kept as the floor. Migration `0003_better_auth.sql` adds `user` / `session` / `account` / `verification`, the `user_role_check` CHECK, and the `created_by` / `updated_by` / `audit_events.actor_user_id` foreign keys Phase 1 deferred. The whole suite — 1208 unit/integration tests and 39 E2E — runs with every environment variable unset. Still to come in part 2: `/admin/users` and its server actions, `src/lib/data/audit.ts` and `users.ts`, and the sign-in requirement on project submission.

Details the spec did not name, or named differently:

- **`hasAuthEnv()` had to split.** It required `AUTH_SECRET` *and* both `GOOGLE_*`, which after Phase 4 would mean no database sessions without a Google client — and §10's E2E needs exactly that. It is now `hasSessionEnv()` (the secret alone) and `hasGoogleEnv()`. The Google gate moved to the route: `POST /api/auth/sign-in/social` answers 503 when the client is unconfigured, which is the `"unconfigured"` notice `sign-in-client.ts` already renders.
- **`getAuth()` is async.** `drizzleAdapter` needs the handle synchronously and `getDb()` is a promise (PGlite migrates and seeds on first use), so `getAuth(): Promise<AuthInstance | null>` and its memo key is the env fingerprint **plus `dataSubstrate()`** — a memo keyed only on env hands back an instance pointed at the previous database.
- **`resolveIdentity` is memoized with a `WeakMap<Request, Promise<Identity>>`, not React `cache()`.** `cache()` only memoizes inside a React render scope; in a Route Handler and under Vitest it silently does nothing, turning one session lookup per request into one per caller. A `resolveIdentityFromHeaders()` variant over `next/headers` exists for the server components part 2 needs; it is deliberately not memoized, because `next/headers` returns a fresh object per call.
- **`resolveIdentity` gained a `DbUnavailableError` branch.** Neon configured but unreachable logs and resolves anonymous rather than 500-ing a public page (Article 4).
- **The four tables are hand-written from the library, not from `npx @better-auth/cli generate`.** That CLI is not a dependency and wants the network. The authoritative offline source is `@better-auth/core/dist/db/get-tables.mjs` plus `better-auth/dist/plugins/admin/schema.d.mts`, and the constraint that actually matters is that each Drizzle table's *property keys* are Better Auth's camelCase field names (`@better-auth/drizzle-adapter` resolves a field by property name); the SQL column names stay snake_case like the rest of the schema. No `updated_at` trigger is attached — the library writes `updatedAt` itself, and a table it owns should not have a second writer.
- **`statement` includes the admin plugin's own `user` and `session` resources.** §3.5's sketch lists only the app's resources, but the plugin authorizes `set-role` against `{ user: ["set-role"] }`, so a declaration that omitted them would make every admin endpoint refuse everybody, super admins included. `super_admin` holds `user: [list, get, set-role, ban, update]` and `session: [list, revoke]`; impersonation, create, delete, set-password and set-email are granted to **nobody**, because v5 never signs in as somebody else and accounts come from Google and nowhere else.
- **The schema has a new leaf module, `src/lib/db/schema/checks.ts`.** `helpers.ts` now imports `auth.ts` (for the `user.id` reference on `actorColumns()`), and `auth.ts` needs a CHECK for `user.role`. Moving `inList` / `inListCheck` into a leaf keeps the pair acyclic rather than relying on ESM's tolerance for a cycle; `helpers.ts` re-exports both names, so every existing import still resolves.
- **`created_by` / `updated_by` are `on delete set null`, not `cascade`.** Deleting a person must never delete the catalogue they built. The same applies to `audit_events.actor_user_id` — deleting somebody must not delete the record that their role was changed.
- **`roles.ts` kept the domain rule and lost everything else.** `roleRank`, `isAtLeast`, `staffEmails`, `adminEmails` and `roleForEmail` are gone; `IDENTITY_ROLES` is `["anonymous", ...ROLES]` built from `db/schema/vocabulary.ts`, so the type and the CHECK cannot drift. Because `admin` means different things in the two vocabularies, every fixture was rewritten rather than renamed: `student` → `user`, `staff` → `admin`, old `admin` → `super_admin`.
- **`isSuperAdminFloor` applies the domain rule too.** An address outside `AUTH_ALLOWED_EMAIL_DOMAIN` can never be a row, so honouring a floor entry for one would grant the highest role to an account that cannot otherwise exist. A typo in the env list fails closed.
- **A Better Auth session cookie can be minted by hand, and that is what makes roles testable without Google.** `better-call/dist/crypto.mjs` signs a cookie as `encodeURIComponent(value + "." + btoa(HMAC-SHA256(secret, value)))` under `better-auth.session_token` (unprefixed on http). `test/utils/session.ts` does that against seeded rows, and `test/utils/session.test.ts` proves the format against a real `auth.api.getSession()` — the one assertion that licenses every other test to trust the helper. No backdoor route exists in the app.
- **The demo seed ships one account per role** (`DEMO_ACCOUNTS`) with constant session tokens, and `playwright.config.ts` boots with a test-only `AUTH_SECRET` and blank `GOOGLE_*`. `e2e/auth.spec.ts` no longer stubs `/api/identity`: it sets a genuinely signed cookie and the real route reads the real row. The E2E therefore proves the property the phase exists for — same cookie kind, different row, different controls. Those rows exist only in the PGlite substrate; a deployment with `DATABASE_URL` set never sees them, and the tokens are worthless without the secret that signs them.
- **`AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` cannot "seed the first admin rows" as §3.11 says**, because no `user` row exists until somebody signs in. In practice the floor is the only bootstrap: the first super admin signs in, then promotes people on `/admin/users`. Open question 3 has no automatic implementation — it is a manual step at the SuperMaker session.
- **Retired but not deleted** (constitution working agreements — each deletion is proposed separately): `src/lib/auth/session-cookie.ts` and its test. Nothing in the application imports them; the file carries a header saying so.
- **Unchanged on purpose:** `/api/mcp` still has no role gate — `MCP_TOKEN` is MCP's whole trust model and an MCP caller has no role — and `/api/admin/backup` (already superseded by `/api/cron/daily`) remains secret-gated rather than role-gated.

**Status.** Accepted. The `getAuth()` async signature, the `WeakMap` memoization, and the fact that `created_by` now has a foreign key are the three a reader should know before touching part 2.

### 2026-09-21 — Phase 4 part 2 built (the admin surface and the audit trail), with as-built details

**What changed.** Phase 4 is complete. `/admin/users` (§5.2, §6) lists everyone who has signed in and changes their role or bans them, through two server actions — the first in the app. `src/lib/data/audit.ts` writes `role.changed` and `user.banned` into `audit_events` (§4.11). `POST /api/projects` now requires sign-in (§5.5) and takes the byline from the session; `/projects/new` shows "Sign in to share your project" to an anonymous visitor. `AdminLink` in the header opens `/admin` for anyone holding an admin-surface permission. The whole suite — 1290 unit/integration tests and 49 E2E — still runs with every environment variable unset.

Details the spec did not name, or named differently:

- **`/admin` has an index page the spec put in Phase 5.** §6 gives the header's `AdminLink` to anyone with *any* admin permission and points it at `/admin`, but `/admin` was to be `AdminHome` with counts and queues that do not exist yet. Linking a SuperMaker to a 404 is worse than a short page, so `/admin/page.tsx` lists the surfaces the viewer can actually open — one, so far — and says the rest arrive later. Phase 5 replaces its body, not its route.
- **The gate is in two places on purpose.** The layout answers the coarse question (signed in? any admin-surface permission?) so every page under it can check only what it needs. A SuperMaker therefore gets *through* the layout and is refused on `/admin/users`, which is the honest answer — `users.manage` is a director's, and saying so beats a 404. `canReachAdmin` / `ADMIN_SURFACE_PERMISSIONS` were added to `auth/permissions.ts` so the header and the layout cannot disagree about what "an admin surface" means.
- **Refusals are return values, not exceptions.** A thrown error in a server action reaches the browser as a digest and an error boundary, which is the wrong shape for "you cannot demote the floor address, and here is why". Each action answers `{ ok: false, error: <code> }` and the island renders the matching `admin.errors.<code>` string. The codes and `ADMIN_USERS_PATH` live in `action-result.ts`, because a `"use server"` module may export **only async functions** — every export becomes a callable endpoint.
- **Server actions travel to the islands as props.** `RoleSelect` and `BanToggle` take the action rather than importing it. A client component importing `actions.ts` would pull `next/headers`, the rate limiter and `server-only` into its graph and make it untestable without a Next runtime; the page that renders them is a server component that already holds the action. `UsersTable` is a server component with no `async` for the same reason — everything it needs is a prop, so RTL can mount it.
- **There are two lock-out guards, not one.** §8 names the floor; §10 separately names "the last super admin demotes themselves", and a deployment with `AUTH_SUPER_ADMIN_EMAILS` unset — a preview, a fork, the E2E server — can genuinely do it. So a demotion is refused when the target is on the floor (`protected_floor`) *or* when no unbanned `super_admin` would remain (`last_super_admin`). Banned super admins are not counted: they resolve to anonymous and can undo nothing.
- **Banning has no "last super admin" guard, deliberately.** Reaching that code means the *caller* holds `users.manage`, so banning somebody else cannot leave the lab without a director; the only self-directed case is refused earlier as `self_ban`. Better Auth refuses a self-ban too, but with an error code the page would have to translate.
- **The islands do not use `useTransition`, and that was a bug fix rather than a style choice.** A transition's pending state covers the action *and* the `revalidatePath` re-render it triggers, so the select sat on "Saving…" until a whole page had been rendered again — seconds under load, and the E2E caught it as a save that looked stuck for twenty seconds. The confirmation now comes from the awaited result; the revalidation still happens, it just no longer holds the confirmation hostage. Anything Phase 5 builds on this pattern should do the same.
- **`AUDIT_ACTIONS` has no `user.unbanned`**, so lifting a ban is recorded as `user.banned` with `detail.banned: false`. Adding a vocabulary term the spec does not list would be the worse drift.
- **`audit.ts` exports no mutator, and a test asserts it.** Append-only is only as good as the guarantee that nobody rewrote a row; with the app and the migrations sharing one connection string, a Postgres privilege is not available, so the enforcement is that the update does not exist in the codebase — checked by asserting the module's export shape.
- **A new `test/mocks/next-headers.ts`**, matching `next-cache.ts`: `nextHeadersMock()` plus a `setMockHeaders()` whose state lives in the mock module, because `vi.mock`'s factory is hoisted above the test's imports and may not close over anything. `next-cache.ts` gained `revalidatePath`.
- **The demo seed gained a fourth account, `DEMO_ACCOUNTS.promotable`.** E2E files run in parallel against one server, so the test that *changes* a role must change a row nobody else asserts on — promoting `DEMO_ACCOUNTS.user` would race `auth.spec.ts`'s "an ordinary signed-in user gets no admin controls". `e2e/utils/session.ts` now holds the `signIn` helper all three specs share.
- **`POST /api/projects` stopped reading `payload.author` entirely.** With the field gone from the form, leaving the fallback in would mean a request that simply omitted its cookie could choose its own byline. A signed-in account with no display name writes a null byline, which the gallery already renders as "Anonymous" — an account we know but cannot name.
- **A database outage now answers 401 on that route, not 502.** `resolveIdentity` treats an unreachable database as "nobody is signed in" so public pages keep serving (Article 4), and the sign-in check runs before the write — so a signed-in student sees "sign in to share a project" during an outage. It leaks nothing and writes nothing, but it is a worse sentence than it could be. Both branches are asserted in `route.test.ts`; a Phase 5 improvement would be to distinguish them with a `pingDb()`.
- **The roster shows email addresses.** The one surface in the app that does, because telling two accounts apart is its whole job. It goes no further — not into a prompt, not into the mirror, not into a log line (§8).
- **Dates in the roster are ISO, not localized.** `createdAt.toISOString().slice(0, 10)` in the mono treatment the design system gives every timestamp: locale-neutral, and it cannot render differently on the server and the client.
- **English-only strings, as Article 6 (amended) allows.** About 40 keys under `admin.*` plus the project sign-in prompt went into `messages/en.json`; the other 11 locales fall back to English until Phase 9.
- **Still pre-existing and unrelated:** `e2e/theme-i18n.spec.ts`'s two language-switch tests are flaky under a loaded machine (the server action plus `router.refresh()` occasionally exceeds the 5s expect timeout). They pass on retry and pass outright when run alone.

**Status.** Accepted. What a reader should know before Phase 5: the two-gate pattern in `/admin/layout.tsx`, that server actions arrive at client islands as props, and that `"use server"` modules may export only async functions.

### 2026-09-21 — Phases 3 and 4 integrated, with one seam closed

**What changed.** The four implementation passes were run together as one branch and the
whole gate observed green with every environment variable unset: `npm run lint` (0 errors,
3 pre-existing warnings), `npm run typecheck` (clean), `npx vitest run` (**95 files, 1303
tests**), `npx playwright test` (**49 passed**, no retries), `npm run spec:coverage`
(73 surface items · 0 undocumented) and `npm run build` (succeeds with no database). One
defect was found between the phases and fixed.

- **The nightly export was about to archive live credentials, and now does not.** Phase 3
  built `backupTables()` to discover tables from the schema module rather than list them,
  so that a table added later is backed up because it exists — and wrote a note asking
  whoever landed Better Auth to decide about its tables. Phase 4 landed them. Nothing
  connected the two, so `select *` over `session` would have written bearer tokens, and
  over `account` Google's refresh tokens, into a private file kept for **thirty days**.
  Anyone holding one backup could have signed in as anybody.

  The fix is `src/lib/cron/backup-policy.ts`, and it keeps discovery's virtue intact: the
  default is still "back it up", and the exceptions are named and argued. `session` and
  `verification` are skipped whole — a session row *is* a bearer token and a verification
  row is a half-finished handshake; neither is worth restoring, and restoring them would
  revive sign-ins that should have ended with the outage. `account` is kept with its four
  secret columns blanked, because the row that matters is the link (this person is this
  Google `sub`), which is what a restore needs, while the tokens are reissued on the next
  sign-in. `user` is kept whole and deliberately so: `role` and `banned` are the state a
  restore would most need to get right, and the row carries no secret. Everything is named
  through the table objects, so renaming a column fails the typecheck rather than quietly
  un-redacting it. `backup.test.ts` asserts the strong form — the demo seed's session token
  does not appear in the written bytes at all.

- **Nothing else needed fixing.** The seams that were looked for and were not there: no two
  modules invalidate the same cache tag (`createProjectSubmission` deliberately invalidates
  nothing and says why; the only `revalidateTag` is still `/api/admin/revalidate`), no
  capability is registered twice, `claimAttachments` and the four functions added around it
  live in one `attachments.ts` with no duplicate, the upload-id contract reads
  `attachmentId` / `attachment_id` everywhere the four files that must move together, and
  the E2E signing secret has one definition (`e2e/utils/session.ts`) that
  `playwright.config.ts` documents itself as having to match.

- **Two live routes still write `backups/YYYY-MM-DD.json`.** `/api/admin/backup` is
  superseded and unscheduled but still reachable with a secret, and it writes a version-1
  Notion dump to the *same pathname* the nightly Postgres export uses — so a hand-trigger
  of the retired route would overwrite that day's real backup. Deleting the route removes
  the hazard and is already on the deletion-approval list; it was left in place under the
  working agreement rather than half-fixed.

**Status.** Accepted. Phases 3 and 4 are integrated and green; what remains before
production is credentials, which no test can stand in for.

### 2026-09-22 — Nine review findings, and one sentence in §3.4 that needs choosing

**What changed.** The Phase 3/4 branch was reviewed three times over and nine findings
came back. Four described code that was already on the branch — the review had read an
earlier working state, and the fixes had been amended into `1c967c4` itself, whose message
still says they are "outstanding and fixed in the next commit". They are not outstanding;
that line is stale. For the record, the three the message meant are the admin plugin's HTTP
endpoints (`/api/auth/admin/*` refused with 403 `admin_api_not_exposed` before the auth
instance is constructed), the super-admin floor the plugin could not see
(`src/lib/auth/floor-role.ts`), and `POST /api/uploads` granting a public Blob URL on the
caller's say-so (`KIND_POLICY` plus `uploadRefusal`, which pairs each `kind` with both its
access and the permission the consuming surface enforces). **Anyone reading a review of
this branch should check the current file before trusting a cited line number** — every one
of them is off by the size of those fixes.

Four findings held up and were fixed. Details the spec did not name:

- **A banned floor address is no longer anonymous, and this contradicts §3.4.** The section
  says both "resolves as `super_admin` whatever its row says" and "A banned user resolves
  to anonymous" (also §4.11's table and §6's signed-out note), which cannot both be true of
  the same row. `identityFromSession` now reads the floor *first*: a listed address survives
  a ban on a session it already holds. The domain rule still runs before both, and
  `isSuperAdminFloor` applies it itself, so an out-of-domain floor entry still fails closed.
  Half a recovery was the alternative, and the floor exists precisely so that "a mistaken
  demotion **or ban** cannot lock the lab out".

  It does not rescue a sign-in, and the reason is worth not rediscovering: the admin plugin
  registers `databaseHooks.session.create.before` and throws `BANNED_USER` there, and
  `runPluginInit` (`better-auth/dist/context/helpers.mjs`) pushes plugin hooks *ahead* of
  the app's own, so no hook this app can register runs in front of it. The row itself has to
  change. `reconcileSuperAdminFloor` therefore reconciles `banned` as well as `role`
  (clearing `banReason` and `banExpires` with it, so the plugin's auto-unban branch cannot
  fire later against a row nobody banned), which means the first admin write a recovered
  director performs restores ordinary sign-in. It still only ever promotes and unbans, only
  for an address the environment already names, and the lift is recorded as `user.banned`
  with `detail.banned: false` because `AUDIT_ACTIONS` has no `user.unbanned` (§4.11) — the
  same shape `setUserBanned` writes.

  **This is the one item in this entry that is a decision and not a detail.** The code, both
  module docstrings and §8's "so the lab can always recover" agree; §3.4's sentence does
  not. It is written up here rather than edited into §3.4 because the original text is never
  edited, and flagged rather than settled because it is the lab's call: if the ban should
  win instead, it is a two-line revert in `identity.ts` plus the `lift` branch in
  `floor-role.ts`, and the docstrings are what need correcting.

- **An audit write that fails after the change committed is a warning on a success.**
  `recordAuditEvent` was awaited unguarded after `auth.api.setRole` had already returned, so
  a transient failure threw out of the server action and the island restored the *old* role
  over a database holding the new one — asserting a state that does not exist, which is the
  quiet lie Article 4 forbids, with the sign flipped. `AdminActionResult`'s ok variant gains
  `warning?: AdminActionWarning`, a `record()` helper reports rather than throws, and both
  islands keep the new value and render `admin.warnings.audit_unavailable` in
  `.admin-row-status.is-warning`. The rule this sets, which Phase 5's admin writes inherit:
  **a change that landed minus a guarantee is `{ ok: true, …, warning }`, never
  `{ ok: false }`**, because a refusal is what the islands answer by rolling back.

  One deliberate asymmetry: `reconcileSuperAdminFloor`'s own audit writes are *not* on this
  channel. If one fails, `authorize()` answers `failed` and the requested action never runs
  — which is honest, because nothing the director asked for was saved — and the row it
  already wrote makes the next attempt a no-op that succeeds. It self-heals in one click,
  and plumbing a warning out through the gate would cost more than it buys.

- **`POST /api/projects` answers `photosSubmitted` and `photosAttached`.** It discarded
  `createProjectSubmission`'s count and returned a bare 201, so a student whose photos had
  been swept by the nightly cron — a form left open overnight submits ids that are already
  gone — was thanked for a write-up with no pictures. The form now says so on the
  confirmation. **Partial loss counts too** (`photosAttached < photosSubmitted`), which is a
  deliberate departure from the sibling write path in `capabilities/maintenance.ts`, whose
  check is `photosAttached === 0`: two of three lost is exactly as silent as three of three.
  Making maintenance symmetric is a reasonable follow-up; its tests pin the current
  behaviour.

- **`/projects/new` tells three states apart, not two.** A failed `/api/identity` fetch was
  read as "not signed in", so a 429 or a dropped connection replaced the whole form with a
  sign-in wall. The distinction was already in the data and was being thrown away:
  `/api/identity` answers **200 `{role:"anonymous"}`** for a signed-out visitor, so
  `fetchIdentity`'s `null` means only "could not ask". `IdentityStatus` is now
  `pending | answered | unavailable`; `unavailable` keeps the form up with a notice and a
  "Check again" control, and the server stays the authority, so a signed-in student can
  still submit. A 401 from the submit now renders a translated sentence rather than the
  route's English prose. **That invariant is now load-bearing** (`src/lib/auth/
  sign-in-client.ts`, both halves pinned by its test): if `/api/identity` is ever changed to
  answer 401 for anonymous, this branch starts catching genuinely signed-out visitors.
  `PrimaryNav`'s opposite choice was checked and left alone — it maps `null` to "signed
  out" deliberately and documents why, and it withholds nothing, so there is no false
  assertion with a cost.

**Refusal strings on the two write routes are hardcoded English**, not `next-intl` keys —
`POST /api/uploads` matches `POST /api/projects`' existing idiom and `ProjectSubmitForm`
renders `data.error` verbatim, so a refusal reads English in all twelve locales. Translating
them is one job across both routes, not one route. Everything else new is seven keys in
`messages/en.json`, inherited by the other eleven through `withEnglishFallback` (Article 6
as amended), which `src/i18n/messages.test.ts` enforces.

**Gate.** Observed green with every environment variable unset: `npm run lint` (0 errors, the
same 3 pre-existing warnings), `npm run typecheck` (clean), `npx vitest run` (**97 files,
1356 tests**), `npx playwright test` (**49 passed**; an earlier run of the same commit was
48 passed and one flaky — `tool-detail.spec.ts`'s gallery-card click, green on retry, the
client-router race under load the Phase 2 amendment describes and not a new defect),
`npm run spec:coverage` (73 surface items · 0 undocumented) and `npm run build`
(succeeds with no database). Each of the three code fixes was confirmed red with the fix
reverted. Not covered: nothing in `e2e/` exercises a banned floor address or a failed audit
write — both are proved at unit and component level only.

**Status.** Accepted, except the §3.4 sentence, which is open. Everything else is a detail
the spec left to implementation.

### 2026-09-22 — §3.4 settled, the floor's own audit gap closed, and Phase 6's engine confirmed

**§3.4 is settled: the environment variable wins.** The sentence left open by the previous
amendment — §3.4 says both "resolves as `super_admin` whatever its row says" and "a banned user
resolves to anonymous", which conflict when a floor address is banned — is decided in favour of
the floor. A banned address named in `AUTH_SUPER_ADMIN_EMAILS` resolves `super_admin`, and
`reconcileSuperAdminFloor` lifts the ban off the row on that person's first admin write.

The reason is that the alternative is a dead end. The floor exists so the lab can always recover;
if a ban outranked it, the documented recovery — add the address, redeploy — would leave the
person still locked out, with no UI able to lift the ban and a manual `UPDATE` the only way
back. The cost is that anyone who can edit the production environment can un-ban themselves,
which is already true of anyone who can deploy, and who could reach the database directly
regardless. Decided by Isaac, 2026-09-22.

**One hole remains, and it is narrow.** `auth.api.banUser` deletes the target's sessions, so if a
ban was applied through the app *before* the address was added to the floor, there is no session
left to carry the override and `session.create.before` refuses a fresh sign-in with
`BANNED_USER`. The app refuses to ban an address already on the floor, so reaching this state
takes a manual `UPDATE`, a restored backup, or a late addition to the list. Recovery there is
`UPDATE "user" SET banned = false` by hand. Documented rather than fixed: closing it means
running ahead of a plugin hook that better-auth pushes in front of the app's own.

**The floor's own audit writes are guarded now.** Adversarial verification of `3c76839` found the
guard it added to `app/admin/users/actions.ts` missing one function away.
`reconcileSuperAdminFloor` committed its row `UPDATE` and then wrote two audit events unguarded,
so an unreachable `audit_events` threw past a committed change; `authorize()` caught it and
returned `failed`, which the page renders as "That did not save. Nothing was changed" — over a
row that had just been promoted and un-banned. A ban lifted with no trail, reported as nothing
having happened, which is the Article 4 lie in its purest form.

The function now returns `{ changed, audited }` rather than a bare boolean and guards its audit
writes the way `actions.ts` guards its own. The gap travels back through `authorize()` as the
existing `audit_unavailable` warning, so both halves of a two-write action answer the admin's one
question — *did the trail record this* — with one warning. Only the row `UPDATE` itself still
throws. `actions.audit.test.ts` covers both shapes and both were confirmed red against the
unguarded version.

**Phase 6's engine is confirmed: the Workflow SDK, as §3.7 specifies.** Re-decided rather than
assumed, because the question was reopened. Every API name in §3.7 is still current against
`workflow@4.8.9`, and the composition was verified by building a scratch app on this project's
exact stack — Next 16.1.6, Turbopack, `cacheComponents: true`, `next-intl` — where
`withWorkflow(withNextIntl(nextConfig))` compiles clean. Three corrections to §3.7:
`@workflow/world-vercel` is never installed (it is selected automatically); `@workflow/world-postgres`
needs a long-lived polling worker and is a real escape hatch rather than a config flip; and
`maxRetries` is a property on the step function (`researchItem.maxRetries = 2`), not an option.

**eve was considered and rejected.** eve is a consumer of the Workflow SDK — "every session runs
as one durable workflow" — not an alternative to it, so adopting it would mean taking this same
layer plus an agent runtime, a session model and a second deploy surface (it runs as a peer Nitro
service, not a library). Three hard blockers independent of that: it requires `ai@^7` as a
non-optional peer dependency against this app's `ai@^6`, forcing an AI SDK major upgrade across
the live chat surface for a background job; it requires Node 24; and its eval runner always
targets an HTTP URL in a separate process, which Article 3's "every test passes with no
environment variables and no network" cannot accommodate. It is also in preview. Worth
revisiting only if the assistant itself ever becomes a durable multi-channel agent.

**Phase 6 is sized for the Hobby plan.** The binding constraint is not Workflow but the Function
duration behind each step: Hobby caps it at 300s with no extension, and a model call with eight
web searches and eight fetches can exceed that. Decided by Isaac, 2026-09-22: stay on Hobby and
engineer around it.

- **Four searches and four fetches per item**, not eight and eight. Halves the cost, halves what a
  retry re-buys, and fits inside 300s with room. Thin results surface as low confidence, which is
  the behaviour gate §5.4 already describes — never as an invented answer.
- **Two steps per item** — search, then fetch and verify — so neither alone approaches the ceiling.
- **A 240s `AbortSignal` inside each step**, so a slow item fails cleanly into `research_error`
  rather than being killed mid-flight by the platform.
- **25 items per batch**, matching the per-request limit §5.4 already sets, rather than 100.

**Two things Phase 6 must not do.** `mapWithConcurrency` (`src/lib/capabilities/intake.ts`) must
not move into the workflow function: it is a shared-cursor worker pool whose index claims depend
on completion order, so a replay can issue a different sequence of step calls and diverge. The
chunked `Promise.allSettled` in §3.7's sketch is correct and is deterministic. And `vi.mock()`
does not reach step code — `@workflow/vitest` loads steps from a pre-built esbuild bundle through
native `import()`, outside Vite's module graph — so this project's `vi.mock("ai")` pattern must
become an MSW handler on `api.anthropic.com` at that tier. MSW *does* reach step code, verified,
so the no-network guarantee holds. Testing steps and the workflow function as plain functions in
the existing config needs no new infrastructure and covers everything except retry semantics.

**A scope correction to §3.7's "reused code".** Today's `research_tool` makes no model call at
all — the chat model does the searching with its native tools, and `research_tool` only dedupes,
verifies links and scores confidence. So `verifyResourceLinks` and `confidence.ts` genuinely
move, but the server-side research prompt and its `generateText` call are **new code**. Phase 6 is
larger than "lift and shift".

**`research_error` is the diagnosis record, not the dashboard.** vercel/workflow#3373 (run history
on Next 16 with Turbopack) is still open, and Hobby retains run history for one day. §3.7 already
says the column is the record; build as though the dashboard does not exist.

**Phase plan changes.** Decided by Isaac, 2026-09-22: **Phase 7 leaves the build plan** — Isaac and
Luis will review the imported inventory on their own time, and it was never code. **Phase 9 is
deferred** until the app is otherwise in good shape, then layered on; English-only keys with the
`withEnglishFallback` behaviour remain correct in the meantime. Phase 8, the Notion mirror, stays.
Open questions 4 and 5 — reporter names in the mirror, and whether the mirror key is derived from
`AUTH_SECRET` — are still unanswered and are due before Phase 8.

**Residual risks accepted, not fixed.** A lost audit event survives only as a `console.error`: no
retry, no outbox, so the gap in `audit_events` is invisible to anyone reading the table later.
`report_issue` still reports photo loss only when *every* photo is lost, where `POST /api/projects`
now reports partial loss — the same Article 4 hole, on the other side, and worth closing when the
maintenance path is next touched. `POST /api/uploads` parses the multipart body before checking the
permission, so an anonymous caller can make the server read up to 18 MB before its 401; nothing is
stored and no URL is returned, and the 15/min-per-IP limiter is what bounds it.

**Status.** Accepted. §3.4 is no longer open.

### 2026-09-22 — Phase 5 part 4 built (the three queues), with as-built details

**What changed.** §5.6 is implemented, and with it the Phase 5 row of §9 that made the lab
runnable on this app rather than on Notion. Three pages, each gated on its own permission and each
refusing in words rather than a 404: `/admin/maintenance` (`maintenance.manage`),
`/admin/corrections` (`feedback.manage`) and `/admin/projects` (`projects.moderate`). `/admin`
now lists exactly the surfaces the viewer's permissions open, from one table rather than a stack of
conditionals, so a page added without an entry is simply unreachable.

**All three tables needed new read paths, which the brief did not expect.** `feedback` was
insert-only — there was no read of the table anywhere in the app. `maintenance.ts` read one unit's
history and nothing else. Every read in `projects.ts` filtered `published = true`. So
`listMaintenanceQueue`, `listFeedbackQueue` and `listProjectsForModeration` are genuinely new, and
the last of them is the only read in that module that can see an unpublished row.

**The queues do not carry a revision token, and that is a decision rather than an omission.** The
tool editor's optimistic concurrency exists because its panel is a form full of typing that a
conflict would discard. A queue control is a single click on a single field; there is nothing to
lose to a concurrent write but a value somebody can set again, and a conflict dialogue on a queue
somebody is trying to clear in ten minutes costs more than it protects. `runQueueWrite`
(`src/lib/admin/queue-write.ts`) is therefore the queue counterpart of the editor's
`tool-write-context.ts` and deliberately not the same helper.

**Only the project queue audits, and only it invalidates.** Publishing decides what the public
gallery shows, so `setPublished` writes `project.published` / `project.unpublished` and calls
`invalidateProjects()`. A lost audit event there is still `{ ok: true, warning:
"audit_unavailable" }` — the row has already changed, and the island answers a refusal by restoring
the previous value, which would leave the page asserting an unpublished project over a database
that has published it. Maintenance and correction edits write no events at all: §4.11 scopes the
trail to security-relevant actions and says ordinary edits are not logged, and nothing cached reads
either table.

**`published_at` and `published_by` describe the current publication, not the history**, so
unpublishing clears both. `audit_events` is the history, and it is append-only by construction. The
alternative — leaving a stamp on a row that is not published — gives the columns two meanings, and
the one a reader would guess is the wrong one.

**`date_resolved` is computed in SQL, from `labToday()`**, as `coalesce(date_resolved, <today>)`
when a ticket reaches `resolved` or `closed`, and null when it is reopened. §4.8's rule about
`LAB_TIMEZONE` is not pedantic: a ticket closed at nine on a Tuesday evening in New York is
Wednesday in UTC, and a day staff would not find it under. The `coalesce` keeps the first
resolution date rather than moving it every time somebody edits the note afterwards.

**One read selects a reporter's email now, and exactly one.** `listMaintenanceQueue` and
`listFeedbackQueue` carry `reported_by_email` / `reporter_email`, because the first thing an admin
does with a confusing ticket is ask the person who filed it, and a queue that shows a name they
cannot reach sends them back to their inbox to guess. `listMaintenanceHistoryForUnit` still does
not select the column at all — its rows reach a model prompt and the Notion mirror (§8). Which
function a caller picks is the whole of that decision, which is why they are two functions rather
than one with a flag, and why `maintenance.ts`'s module docstring now says so.

**Each queue's test proves the action checks *its own* permission.** No role holds `tools.edit`
without also holding `feedback.manage`, so a test signed in as an `admin` cannot tell a correct
gate from one that checks the wrong declaration. Each `actions.test.ts` therefore mocks `can()` for
one case, grants `tools.edit` and `tools.publish` only, and asserts the endpoint refuses — then
grants the surface's own permission and asserts it succeeds. Every other test in those files runs
against the real `can()`.

**Ordering comes from the vocabulary constants, with one reversal.** `MAINTENANCE_STATUS` and
`FEEDBACK_STATUS` are declared in the order work moves through them, so ranking by index is the
queue order and a value added later sorts where it was declared. `MAINTENANCE_PRIORITY` is declared
*ascending* in severity, so it is reversed — ranking it as declared put the low-priority tickets at
the top, which a test caught.

**The demo seed gained one row per queue** — an open ticket against the Trotec's unit, a correction
about the Form 4's materials, and an unpublished project — so each page has something real to show
and `e2e/admin-queues.spec.ts` has something to assert on. It deliberately did **not** gain a draft
tool, which the plan asked for: `e2e/admin-inventory.spec.ts` asserts that both seeded tools are
published and that `?state=draft` therefore empties the table.

**Still outstanding from the Phase 5 plan.** Migration `0004`, which was to add the `user.id`
foreign keys on `tools.last_reviewed_by` (§4.4), `projects.published_by` (§4.10) and
`maintenance_logs.assigned_to_user_id` (§4.8), was not written in any of the four parts. All three
columns are still bare `text` while the spec says they are foreign keys, and Phase 5 is the first
code to write two of them. Every existing row is null, so the ALTERs remain safe; it wants one
migration and a `db:generate` whose output is read before it is committed. *(Written at the
integration gate — see the amendment below.)*

**The gate, with every environment variable unset:** `npm run lint` (0 errors, 3 pre-existing
warnings), `npm run typecheck`, `npx vitest run` — **136 files / 1707 tests**, `npx playwright
test` — **65 passed**, `npm run spec:coverage` — 73 items, 0 undocumented, and `npm run build`,
which still reports `/tools/[id]` as Partial Prerender.

**Status.** Accepted.

### 2026-09-22 — Phase 5 integrated, four seams closed and migration `0004` written

Four agents built Phase 5 in parallel — the write layer, the review table, the editor panel, the
three queues — and each ran the gate green on its own. This amendment records what only showed up
when the four were read together, and what the gate found.

**Migration `0004` exists.** The three `user.id` foreign keys the plan asked for and no part
wrote — `tools.last_reviewed_by` (§4.4), `maintenance_logs.assigned_to_user_id` (§4.8) and
`projects.published_by` (§4.10) — are in `src/lib/db/migrations/0004_user_foreign_keys.sql`, three
`ALTER TABLE … ADD CONSTRAINT` statements and nothing else (the generated SQL was read before it
was committed, which is what that instruction was for). All three are `on delete set null`, so
removing a person never removes the work: the review date, the assignee's name snapshot and
`published_at` all survive the account that made them, and `audit_events` holds who. The three
columns now share one helper, `userReference()` in `schema/helpers.ts`, beside the `actorColumns()`
that already did this — a fourth spelling of the same foreign key was the thing to avoid.
`schema/user-references.test.ts` asserts both halves against PGlite: the key refuses an id naming
nobody, and a deleted account nulls the column rather than taking the row with it.

**The `/admin` pages were rendering with an unresolvable palette.** Every admin surface uses the
tool-detail utilities — `.td-panel`, `.td-eyebrow`, `.td-empty`, `.td-prose` — and
`.admin-row-status.is-warning` reads `--td-warning`. Those *rules* are global; their *tokens* are
scoped to `.tool-detail`. An unresolvable `var()` does not fall back to anything: the declaration
computes to `unset`, so a panel's border came out `currentColor` and the amber warning line came
out the colour of body text — the one line on the page whose whole job is to be noticed, silently
not being noticeable. `.admin-shell` now supplies the tokens, mapped onto the global theme tokens
so light and dark follow, with `--td-warning` the only one needing a pair of its own. Part 2 found
this and correctly left it as out of its scope; it was nobody's part and belonged to the gate.

**A resource's lost PDF no longer reports itself as a lost photo.** Part 3 made `addResource`
raise a warning on a file shortfall — right, since silently creating a manual with no manual is the
quiet lie Article 4 is about — but reused `photos_not_attached`, whose message is "some photos did
not attach". Told about a manual that sends somebody to the Photos section looking for a file that
was never there. `files_not_attached` is now a code of its own, because these codes *are* message
keys and the message is the only reason to raise one.

**Two smaller drifts, each a value declared twice.** The three queue surfaces each spelled their
refusal codes once in an exported `…ActionError` alias and again inside `QueueActionResult<…>`;
they now derive from one `…WriteError` declaration, so the union a page renders and the union its
action answers cannot drift apart. And `markToolReviewed` said `withToolWrite("tools.edit", …)`
where every other edit on the surface says `withToolEdit(…)` — one action quietly gating on
another's permission is exactly what a second spelling buys.

**The §10 scenario that needed a browser is covered.** `e2e/tool-editor.spec.ts` gained the flow
this phase exists for: a SuperMaker at a 390px viewport opens the sheet on a machine's own page,
marks its unit out of service in one gesture, and **the public tool page stops saying the machine
is available**. That last step is a seam no unit test could reach — the catalogue is cached behind
`cacheTag("catalog")`, the write busts it from `src/lib/revalidate.ts`, and a tag that did not
match would fail silently: no error, no failing test, a student walking to a dead machine. The test
was verified to have teeth by pointing `invalidateCatalog()` at the wrong tag, at which point it
failed with the page still reading "Available". It is `serial`, it touches the Trotec's unit status
(a field no other spec reads), and it puts the value back; the suite's one database and its
parallel workers leave no other honest way to write in E2E until the seed carries a row nothing
asserts on.

**The gate, run from `v5/` with every environment variable unset:** `npm run test:all` — lint 0
errors and the same 3 pre-existing warnings, `tsc --noEmit` clean, **137 files / 1711 tests**
passed, **67 Playwright tests** passed with none flaky; `npm run spec:coverage` — 73 items, 0
undocumented; `npm run build` — succeeds, `/tools/[id]` and all five `/admin` routes still Partial
Prerender.

**Still not built, and deliberately.** `markReviewed` writes no audit event: §4.11 scopes the trail
to security-relevant actions and `AUDIT_ACTIONS` has no `tool.reviewed`, so adding one is a spec
change rather than an implementation detail. `projects.author_user_id`, `feedback.reporter_user_id`
and `maintenance_logs.reported_by_user_id` are still bare `text` — §4.10 calls the first of them a
foreign key, and `0004` deliberately covered only the three the Phase 5 plan named. And the demo
seed still has no draft or archived tool, so no E2E exercises publish, archive or restore in a
browser; each is covered against PGlite in `src/app/admin/inventory/actions.test.ts`.

**Status.** Accepted.
||||||| 57d7ea3


### 2026-09-22 — `AUTH_ALLOWED_EMAILS`, so the domain rule cannot become a lock-out

**A new environment variable: `AUTH_ALLOWED_EMAILS`**, a comma-separated list of full addresses
allowed to sign in whatever domain they are on. Empty by default, and empty in the Cornell Tech
deployment, where it changes nothing.

**Why.** §3.4's domain rule is right for a university — it admits every student without anybody
maintaining a roster — but it ties every account to one institution's Google Workspace, including
the accounts that must never be locked out. The people who hold `super_admin` are exactly the ones
whose institutional address is temporary: a director who graduates, a maintainer after the project
leaves Cornell, a handover to somebody who does not have a `cornell.edu` address yet. The
super-admin floor was built to make lock-out unrecoverable-proof, but `isSuperAdminFloor` calls
`isAllowedEmail` first, so a floor entry on any other domain was **silently ignored** — the
env var would look set and do nothing, which is the worst shape a safety net can have.

**Named exceptions, never a second open domain.** `isAllowedEmail` now passes an address on the
configured domain **or** one named in the list. Adding an entry is a deliberate act by somebody who
can already deploy, and it admits exactly one person, not a provider. `AUTH_ALLOWED_EMAIL_DOMAIN`
keeps doing all the work for everybody else.

**One consequence worth stating plainly: setting this drops the Google `hd` hint.** `hd` is not only
a hint to the account picker — Better Auth verifies the claim on the returned id token, and a
personal Google account carries no `hd` at all. Left on, it would refuse every named exception
before this app's own check ran. So `socialProviders.google.hd` is omitted whenever the list is
non-empty. The picker gets wider; the two server-side enforcement points in §3.4 do not move, and
they are the control. A deployment that leaves the list empty is byte-identical to before.

**The bootstrap, decided 2026-09-22.** `AUTH_SUPER_ADMIN_EMAILS=ies22@cornell.edu` remains the
floor for launch — it works today with no code change. `steinbergisaac@gmail.com` goes in
`AUTH_ALLOWED_EMAILS`, and may be added to the floor, so access survives the Cornell account.

**Status.** Accepted. Tested in `roles.test.ts`: an off-domain named address is admitted, its
domain is **not** opened to anybody else, the institutional domain keeps working alongside it, and
an empty list behaves exactly as the domain rule did.
