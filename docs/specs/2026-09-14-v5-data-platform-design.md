# v5 Data Platform — Postgres, Blob, a Notion Mirror, Accounts and Admin Inventory — Design Spec

**Date:** 2026-09-14
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/data-platform-spec`
**Spec PR:** #TBD · **Implementation PRs:** one per phase (§9)

> Per constitution Article 1, this merges before implementation begins. It also proposes
> amendments to Articles 3, 5 and 7 (§7.1), which merge with it or before it.

## 1. Summary

v5 keeps every record in Notion, and the constitution makes that a principle: Notion is the
source of truth and the editing surface (Article 7), and publishing a draft happens there
(Article 5). That was right for a catalogue edited a few times a week by one person. It stops
being right once the app needs people in it: accounts with roles, a user-management page,
project posts tied to a signed-in author, and editing that staff and SuperMakers do on the
website rather than in a workspace most of them cannot open. Notion has no users table, no
transactions, no constraints, and file URLs that expire about an hour after they are read.

This spec moves v5's data to **Postgres** (Neon, provisioned through the Vercel Marketplace) and
its files to **Vercel Blob**. Notion becomes a **one-way mirror**: the app pushes to a set of
*new* Notion databases so Niti can still see the inventory in Notion, and never reads them back.
The databases v5 uses today are imported once and then frozen as an archive.

On that foundation it adds what the lab asked for on 2026-09-14:

- **Accounts.** A users table, four roles (member, SuperMaker, admin, super admin), and
  permissions expressed as **scopes granted to roles**, which a super admin switches on and off
  without a deploy.
- **Inventory editing on the website**, in two places: an admin inventory table for reviewing
  everything, and an edit mode on each tool page for quick fixes.
- **A two-step add-tool flow.** The assistant only identifies what a tool is and proposes a short
  pending table; a person checks it and presses Research; research runs in the background,
  outside the chat turn; a person reviews and approves the result.
- **Project posts require sign-in.** Anonymous visitors still browse, ask the assistant, and
  report problems.

**This is an architecture change, and that is the consequential part.** The source of truth moves
from Notion to Postgres, the approval surface moves from Notion into the app, and the test
suite's offline data moves from a mock catalogue to an in-process Postgres (PGlite). The data
layer is a fresh schema written for v5 — one lab, no multi-tenant scoping — as decided on
2026-09-14.

**Prerequisite.** Google sign-in is not configured in production today:
`POST /api/auth/sign-in/social` returns 503. Every role-based feature here depends on it.

## 2. Goals / Non-goals

### Goals

1. **No request path reads Notion.** After cutover, catalogue pages, tool pages, projects, unit
   status, maintenance history, chat and MCP read Postgres. `api.notion.com` is called only by
   the mirror job and the one-time import.
2. **Old links keep working.** Every URL and printed QR code of the form
   `/tools/<notion-page-id>` redirects permanently to `/tools/<slug>`.
3. **Roles change without a deploy.** A super admin changes a person's role on `/admin/users`, or
   which scopes a role has on `/admin/roles`, and it applies on that person's next request.
4. **Inventory is editable on the website.** Anyone with `tools.edit` can edit a tool, its units
   and its resources from `/admin/inventory` or from edit mode on `/tools/<slug>`, and the
   public page shows the change on its next load.
5. **Adding equipment never blocks the chat.** A person with `tools.add` gets a pending table in
   one chat turn, with no manual or spec research in that turn. Pressing **Research** runs
   research in the background. Nothing reaches the public catalogue until someone with
   `tools.publish` approves it.
6. **Duplicates are caught before research.** The check covers published tools, drafts and
   pending items, and offers **Add as another unit** (with a serial number) alongside **It's a
   different tool** and **Remove**.
7. **Anonymous visitors keep what they have** — browsing, the assistant, reporting problems and
   corrections — and lose only project submission.
8. **The Notion mirror is visibly fresh or visibly failing.** A change reaches the mirror within
   about two minutes; the last run's status and error show on `/admin`; a failed mirror never
   affects the app.
9. **Article 3 still holds.** `npm run test:all` passes with every environment variable unset and
   no network.
10. **Cutover is reversible** for a stated window (§5.8).

### Non-goals (this iteration)

- **Multi-lab support.** v5 serves one lab. There is no `org_id`. Multi-tenancy belongs to
  Blueprint, which is a separate product (decided 2026-09-14).
- **Reading from Notion after cutover, or editing in the mirror.** The mirror is write-only from
  the app's side. An edit made in a mirror database is overwritten by the next push, and each
  mirror database's description says so.
- **Writing to the old databases.** They are imported once and archived. The mirror job refuses
  their ids (§8).
- **Photo cleanup** — background removal, cropping, enhancement. An admin uploads a photo, and
  that is the whole flow for now.
- **Other sign-in providers, passwords, or accounts outside the institution's email domain.**
- **Field-level history or undo.** Edits record who and when (`updated_by`, `updated_at`), and
  security-relevant actions are logged (§4.12). There is no per-field revision history.
- **Hard-deleting tools.** Tools are archived, because maintenance history refers to them. Only
  pending items, units with no history, and orphaned uploads are ever deleted.
- **Changing MCP's trust model.** `MCP_TOKEN` stays the gate for MCP writes, and MCP callers have
  no role.
- **Live co-editing.** Concurrent edits are detected with an `updated_at` check and refused, not
  merged.
- **Blueprint compatibility.** Nothing here shares code or data with Blueprint.

## 3. Architecture

```
                   ┌──────────────────── Vercel (Next.js 16, v5) ────────────────────┐
 Browser ─────────▶│  pages · /admin/* · server actions · /api/*                     │
                   │      │                       │                    │             │
                   │  capabilities (chat, MCP) ─▶ src/lib/data/*   src/lib/files/*   │
                   │                             (query modules)    (uploads)        │
                   │  workflows/research-batch ─▶ src/lib/research/*                 │
                   │  workflows/mirror, cron ───▶ src/lib/mirror/*                   │
                   └────────────────────────────────┬────────────────────┬───────────┘
                                                    ▼                    ▼
                                             Neon Postgres          Vercel Blob
                                                    │
                        src/lib/mirror ─ push ────▶ Notion: new mirror databases
                        scripts/import-notion ◀─── read once ── Notion: today's databases
                                                                (archived afterwards)
```

### 3.1 The source of truth moves

Postgres is authoritative for every record. Notion is demoted twice over: the current databases
become a read-only archive after a one-time import, and a new set of databases receives a
one-way copy. This requires amending Articles 3, 5 and 7. The proposed text is in §7.1, so it can
be argued with before anything is built.

### 3.2 Database

- **Host.** Neon Postgres, installed on the `makerlab-tools-v5` Vercel project through the
  Marketplace (`vercel integration add neon`). The integration injects `DATABASE_URL` for
  production and creates a branch database per preview deployment. The per-preview branch is
  what makes a rehearsed cutover possible (§5.8).
- **ORM and migrations.** Drizzle ORM. `drizzle-kit generate` produces SQL migrations, committed
  under `v5/src/lib/db/migrations/`. Migrations run in a deploy step, never at request time.
  The `pg_trgm` extension is enabled in the first migration, for duplicate matching (§5.4).
- **Drivers.**
  - Production and preview: `@neondatabase/serverless` through `drizzle-orm/neon-serverless`.
    This is the pooled client, which transactions need.
  - Tests, local development and demo mode: `@electric-sql/pglite` through `drizzle-orm/pglite`.
    It is Postgres compiled to WebAssembly, running in-process with no network, and it is what
    keeps Article 3 true.
- **One entry point.** `src/lib/db/client.ts` exports `getDb()`, created lazily on first call so
  `next build` never needs `DATABASE_URL`. There is no `Proxy` wrapper.

```ts
// src/lib/db/client.ts (sketch)
export type DataSubstrate = "neon" | "pglite-demo";
export function dataSubstrate(): DataSubstrate;   // DATABASE_URL set → "neon"
export async function getDb(): Promise<Db>;       // memoized; PGlite migrates and seeds on first use
export class DbUnavailableError extends Error {}  // Neon configured but unreachable
```

**Failing toward stale, not wrong (Article 4).** Today a Notion failure silently serves the mock
catalogue. After this change:

- **`DATABASE_URL` unset** (tests, E2E, a fresh clone): PGlite with a demo seed, and the existing
  `DemoDataBanner` says the catalogue is sample data.
- **`DATABASE_URL` set but unreachable:** cached catalogue pages keep serving, and an uncached read
  renders the error state. Invented data is never served in production.

### 3.3 The transition switch

Phases 1–7 land on `main` while production keeps running on Notion. A temporary environment
variable selects the backend:

```
DATA_BACKEND = "notion" | "postgres"     # default "notion" until Phase 8
```

- **One branch point.** `src/lib/catalog.ts`, `src/lib/projects.ts`, and each capability's data
  calls branch on it through `dataBackend()`.
- **Environments.** Preview deployments set `postgres` and get a Neon branch. Production stays on
  `notion` until cutover.
- **Postgres-only features** — accounts, admin pages, the add-tool flow — render nothing while
  the backend is `notion`.
- **Removal.** Phase 9 deletes the switch and the Notion code paths.

Carrying both paths for a few weeks is the price of keeping `main` deployable. It is named as a
risk in §8.

### 3.4 Files

Vercel Blob (`@vercel/blob`, already a dependency for backups).

| Kind | Access | Why |
|---|---|---|
| Tool images, resource files (manuals) | `public` | Shown on public pages and served from the CDN |
| Maintenance photos | `private` | May show people; staff-only |
| Project photos | `private`, served through `GET /api/files/[id]` | Students may appear in them; readable only once published, or by the author and moderators |
| Photos on pending tools | `private`; copied to a public path on approval | Not yet reviewed |

- **One upload route.** `POST /api/uploads` replaces `/api/upload-notion`.
  - It accepts `image/*` up to 18 MB, and `application/pdf` up to 20 MB for resources only.
  - It writes to a random pathname and records an `attachments` row with no owner.
  - It returns `{ attachmentId, previewUrl }`.
  - Anonymous uploads stay allowed for maintenance reports and chat vision, rate-limited as today.
  - A daily job deletes unowned attachments older than 24 hours.
- **Chat vision** depends on PR #31's downscaled-image fix (§7.3). This spec does not change the
  image the model receives.
- **Images stop expiring.** Notion file URLs are signed and expire, which is the source of the
  broken catalogue images behind the 24-hour cache. Blob URLs do not expire. `next.config.ts`
  gains the Blob hostname in `images.remotePatterns`, and the import copies file bytes, never
  URLs (§5.8).

### 3.5 Accounts, roles and scopes

**Sign-in stays as the auth spec describes.** Better Auth runs the Google handshake, and the app
mints its own signed session cookie. Two things change:

1. **A user row on sign-in.** The after-hook in `src/lib/auth/config.ts` upserts `users` by
   lower-cased email — Google `sub`, name, `last_sign_in_at` — before minting the cookie.
2. **The role comes from the database, per request.** `resolveIdentity` reads the role from
   `users` in one indexed lookup, memoized per request with React `cache()`, instead of from
   `AUTH_STAFF_EMAILS` and `AUTH_ADMIN_EMAILS`. This is what makes Goal 3 true: a role embedded in
   the 30-day cookie would leave a demoted admin with their old role until it expired. A row with
   `disabled_at` set resolves to anonymous.

**Roles** (`src/lib/auth/roles.ts`), least to most privileged:

| Role | Who | How it is assigned |
|---|---|---|
| `anonymous` | Not signed in | — |
| `member` | Anyone signed in with an allowed address — students | Automatically, on first sign-in |
| `supermaker` | SuperMaker volunteers | By a super admin |
| `admin` | MakerLab staff | By a super admin |
| `super_admin` | MakerLab directors | By a super admin, or by `AUTH_SUPER_ADMIN_EMAILS` |

`AUTH_SUPER_ADMIN_EMAILS` is a **floor**, not a roster: an address listed there is always
`super_admin`, whatever its row says. It guarantees the lab cannot lock itself out, and it is how
the first super admin comes to exist.

**Scopes are defined in code**, because a scope means nothing until code checks it:

```ts
// src/lib/auth/scopes.ts
export const SCOPES = [
  "catalog.view_drafts",  // see unpublished and archived tools
  "tools.add",            // identify tools and start research
  "tools.edit",           // edit tools, resources, categories, locations
  "tools.publish",        // publish, unpublish, archive; approve researched items
  "units.edit",           // add units; change status, condition, serial
  "maintenance.manage",   // work the maintenance queue
  "feedback.manage",      // work the corrections queue
  "projects.submit",      // post a project write-up
  "projects.moderate",    // publish and unpublish projects
  "mirror.run",           // run the Notion mirror now; see its status
  "users.manage",         // change a person's role; disable an account
  "roles.manage",         // switch scopes on and off for a role
] as const;
export type Scope = (typeof SCOPES)[number];

/** Never grantable below super_admin, so no role can grant itself more. */
export const SUPER_ADMIN_ONLY: readonly Scope[] = ["users.manage", "roles.manage"];
```

**Which role has which scope lives in the database** (`role_scopes`), because the lab asked for it
to be "a very easy switch". `/admin/roles` is a role × scope matrix of toggles. `super_admin` holds
every scope implicitly and has no rows. The two `SUPER_ADMIN_ONLY` scopes cannot be toggled on for
any other role, so a mistaken toggle cannot escalate anyone.

**Default grants**, seeded by migration and changeable afterwards:

| Scope | member | supermaker | admin |
|---|:-:|:-:|:-:|
| `projects.submit` | ✓ | ✓ | ✓ |
| `tools.add` | | ✓ | ✓ |
| `units.edit` | | ✓ | ✓ |
| `maintenance.manage` | | ✓ | ✓ |
| `catalog.view_drafts` | | ✓ | ✓ |
| `tools.edit` | | | ✓ |
| `tools.publish` | | | ✓ |
| `feedback.manage` | | | ✓ |
| `projects.moderate` | | | ✓ |
| `mirror.run` | | | ✓ |

**One check, everywhere.** `can(identity, scope)` in `src/lib/auth/permissions.ts`.

- **Server-side:** server actions, route handlers, and capability composition call it.
- **Client-side:** `GET /api/identity` now also returns `scopes: Scope[]`, and components use it to
  hide controls. Hiding is presentation; the server check is the control.

**Capabilities declare scopes, not roles.** A capability or tool gains `requiredScope?: Scope`,
enforced once when the chat composes its tools. This replaces the `minimumRole` that PR #31
introduced (§7.3).

### 3.6 Capabilities (Article 2)

| Capability | Tools | Change |
|---|---|---|
| `catalog` | `list_tools`, `search_tools`, `get_tool_details` | Reads Postgres. Names and schemas unchanged. |
| `units` | `get_unit_details`, `get_maintenance_history` | Reads Postgres. |
| `maintenance` | `report_issue` | Writes `maintenance_logs`. The Notion retry-without-`reporter_email` workaround is deleted. |
| `flags` | `report_correction` | Writes `feedback`. Its raw Notion `fetch` is deleted. |
| `intake` | `identify_tools` (new, chat-only, `requiredScope: "tools.add"`); `create_tool` stays, **MCP-only** | `research_tool` and `propose_listing` leave the chat. Research moves into the workflow (§3.7). |

`identify_tools` is the only intake tool the model can call, and it creates pending rows owned by
the caller and nothing else. Starting research is a button press handled by a route, not a tool
call, so the model never spends research budget on its own initiative.

### 3.7 Background research: Vercel Workflow

Research runs as a durable workflow, `v5/src/workflows/research-batch.ts`, using the Workflow SDK:
the `workflow` package, `withWorkflow` from `workflow/next` in `next.config.ts`, and `start()` from
`workflow/api`.

**Why a workflow**, rather than the chat turn or a plain background function:

- The chat route has `maxDuration = 60`, a 10-step budget, and 5 searches and 5 fetches per turn —
  not enough to research a batch.
- A plain background function has no retries and loses its state when it times out.
- Workflow steps retry, persist their results, survive deploys, and appear in Vercel
  Observability, so a stuck research run can be diagnosed.

```ts
// v5/src/workflows/research-batch.ts (sketch)
export async function researchBatch(batchId: string) {
  "use workflow";
  const ids = await loadQueuedItems(batchId);                // step
  for (const group of chunk(ids, RESEARCH_CONCURRENCY)) {    // 4 at a time (Article 4)
    await Promise.allSettled(group.map((id) => researchItem(id)));
  }
  await finishBatch(batchId);                                // step: revalidate the intake view
}

async function researchItem(id: string) {
  "use step";
  // status → researching
  // generateText with web_search (maxUses 8) and web_fetch (maxUses 8); output parsed by zod
  // verifyResourceLinks; scoreConfidence; resolve category and location against the taxonomy
  // status → researched | failed
}
```

- **Reused code.** The research prompt, link verification (`verifyResourceLinks`) and confidence
  scoring (`confidence.ts`) move from `capabilities/intake.ts` into `src/lib/research/`. The
  confidence rule is unchanged: the grade is computed from reported evidence in code and never
  taken from the model.
- **Errors.** A 429 or 5xx from the model or a fetch throws `RetryableError`, with at most 3
  attempts. Anything else throws `FatalError`, which marks that item `failed` with its error and
  leaves the other items running.
- **If Workflows prove unsuitable** (§11 q3), `researchItem` runs from a `research_jobs` claim
  table instead, driven by a trigger route. Nothing outside `src/workflows/` knows which runner is
  in use.

### 3.8 The Notion mirror

**Setup.**

1. A person creates a page, "MakerLab Tools — mirror", and shares it with the integration.
2. `scripts/notion-mirror-setup.ts` creates seven databases under it — Categories, Locations,
   Tools, Units, Resources, Maintenance, Projects — with fixed property schemas.
3. The script records their ids in `mirror_targets`.

**Push** (`src/lib/mirror/`):

1. Take the lease: a conditional update on `mirror_lease.running_since`, expiring after 15 minutes,
   so two runs never overlap.
2. For each entity, in dependency order — categories, locations, tools, units, resources,
   maintenance, projects — select rows with `updated_at > mirror_targets.last_pushed_at`.
3. Upsert each page through its `mirror_pages` row: update the page if the row exists; otherwise
   create it and record its id.
4. Archive the pages of archived tools.
5. Advance `last_pushed_at` only past rows that succeeded, and record status and error.
6. Release the lease.

Requests are throttled to 3 per second and retried on 429 using `Retry-After`. A run stops after 45
seconds and leaves the rest for the next run.

**What is mirrored.**

- Every tool, published or not, with a Published checkbox.
- Units, resources, categories and locations.
- Maintenance logs **without reporter emails**.
- Published projects only.
- Images: public URLs go into files properties as external URLs; private photos are never mirrored.

**Triggers.**

- A write to a mirrored table calls `requestMirror()`. It starts a short workflow that sleeps 60
  seconds, so a burst of edits coalesces into one push, and then pushes.
- A daily cron is the backstop. Hobby allows cron jobs at most once per day, so the cron alone
  could not deliver Goal 8.
- `/admin` has a **Run mirror now** button (`mirror.run`).

**Never the archive.** The push refuses any database id equal to one of the archived `NOTION_DB_*`
ids, so a misconfigured target cannot overwrite history.

### 3.9 Caching and invalidation (Article 4)

- **Reads.** Catalogue reads keep `'use cache'` with `cacheTag("catalog")`. Detail reads add
  `cacheTag("tool:<id>")`, and project reads add `cacheTag("projects")`.
- **Writes invalidate their tags.** Server actions call `updateTag`, so the person editing sees
  their own change on the next render. Route handlers and workflow steps call
  `revalidateTag(tag, "max")`.
- **Cache lifetime.** The 24-hour revalidation window was sized for slow, rate-limited Notion
  reads. With invalidation on every write, it can stay long: staleness now comes only from writes
  the app did not make, and after cutover there are none.

### 3.10 What moves where

| Today | After | Behaviour-preserving? |
|---|---|---|
| `src/lib/notion.ts` reads | `src/lib/data/*` query modules | Yes — `catalog.ts` keeps its exports |
| `src/lib/notion.ts` writes | `src/lib/data/*` | Yes |
| `capabilities/flags.ts` raw Notion `fetch` | `src/lib/data/feedback.ts` | Yes |
| `POST /api/upload-notion` | `POST /api/uploads` (Blob) | Yes for callers; the response shape changes |
| `GET /api/health` Notion probe | Postgres probe plus mirror status | Yes |
| `GET /api/admin/backup` (Notion to Blob) | Postgres dump to private Blob, same schedule and retention | Yes |
| `src/components/mock-catalog.ts` | PGlite demo seed, `src/lib/db/demo-seed.ts` | Yes, for tests and E2E |
| `AUTH_STAFF_EMAILS`, `AUTH_ADMIN_EMAILS` | `users.role` + `role_scopes`; `AUTH_SUPER_ADMIN_EMAILS` as floor | No — roles move into the app |
| Chat intake with research in the turn | `identify_tools` in chat; research in a workflow; review on `/admin/intake` | No — the new flow |
| Anonymous project submission | Requires `projects.submit` | No — deliberate |
| Publishing in Notion | `tools.publish` / `projects.moderate` in the app | No — deliberate |
| `scripts/migrate-tools-to-resources.ts`, `drop-deprecated-notion-columns.ts`, `clear-resource-migration-notes.ts`, `validate-notion-migration.ts` | Retired in Phase 9; deletion proposed separately | — |
| `scripts/generate-qr-labels.ts` | Reads Postgres and prints `/tools/<slug>` | Old labels still resolve (Goal 2) |

### 3.11 Environment contract

| Variable | Status | Purpose |
|---|---|---|
| `DATABASE_URL` | New (Neon) | Postgres connection; unset means PGlite demo |
| `DATA_BACKEND` | New, temporary | `notion` or `postgres`; removed in Phase 9 |
| `AUTH_SUPER_ADMIN_EMAILS` | New | Super-admin floor |
| `LAB_TIMEZONE` | New, default `America/New_York` | Dates on tickets (Article 6: configuration, not a constant) |
| `BLOB_READ_WRITE_TOKEN` | Existing | Uploads and backups |
| `CRON_SECRET` | Existing | Cron routes |
| `NOTION_API_KEY` | Kept | Mirror and import only |
| `NOTION_DB_*` (8) | Import only, then removed | Source databases; also the archive-id guard |
| `AUTH_STAFF_EMAILS`, `AUTH_ADMIN_EMAILS` | Removed in Phase 4 | Read once, by the roster import (§11 q4) |

## 4. Data model

- **One lab.** No `org_id`.
- **Keys.** UUID primary keys (`gen_random_uuid()`).
- **Timestamps.** Every mutable table has `created_at` and `updated_at`. `updated_at` is maintained
  by a `BEFORE UPDATE` trigger rather than by the ORM, because the import, the seed, and any manual
  SQL fix write outside Drizzle, and the mirror selects on that column.

**Vocabularies are `text` columns with named CHECK constraints, not `pgEnum`.** Adding a value is
then an ordinary transactional migration; `ALTER TYPE … ADD VALUE` cannot run inside the
transaction a migration uses. Stored values are machine identifiers, and display text comes from
`next-intl` (Article 6).

**Vocabularies come from Notion's defined option sets, not from the values in use.** A 2026-08-14
audit of this workspace (recorded in the Blueprint repository) found that every live maintenance
log was `Open`. A constraint built from observed values would have allowed only `open`, and
resolving a ticket would have failed in production. The same audit found options that v5's
TypeScript types do not list: unit condition `New` and maintenance status `Closed`. The import's
pre-flight re-reads the defined options and stops on anything unmapped (§5.8).

### 4.1 Vocabularies

```ts
// src/lib/db/vocabulary.ts
export const ROLES = ["member", "supermaker", "admin", "super_admin"] as const;
export const UNIT_STATUS = ["available", "in_use", "under_maintenance", "out_of_service", "retired"] as const;
export const UNIT_CONDITION = ["excellent", "good", "fair", "needs_repair", "new"] as const;
export const MAINTENANCE_TYPE = ["issue_report", "preventive_maintenance", "repair", "inspection", "calibration"] as const;
export const MAINTENANCE_PRIORITY = ["low", "medium", "high", "critical"] as const;
export const MAINTENANCE_STATUS = ["open", "in_progress", "resolved", "closed"] as const;
export const FEEDBACK_STATUS = ["new", "reviewed", "fixed", "dismissed"] as const;
export const FLAG_FIELDS = ["description", "image", "name", "category", "location", "materials", "safety_info"] as const;
export const PENDING_STATUS = ["identified", "queued", "researching", "researched", "failed", "approved", "discarded"] as const;
export const ATTACHMENT_OWNER = ["tool", "resource", "maintenance_log", "project", "pending_tool"] as const;
```

### 4.2 `users`, `role_scopes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `email` | text; unique on `lower(email)` | From Google, lower-cased |
| `name` | text null | |
| `google_sub` | text unique null | |
| `role` | text; CHECK in `ROLES`; default `member` | |
| `disabled_at` | timestamptz null | Set → resolves to anonymous |
| `last_sign_in_at` | timestamptz null | |

`role_scopes` has columns `role` (text, CHECK in `ROLES` and `<> 'super_admin'`) and `scope`
(text), with primary key `(role, scope)`. The query module validates `scope` against `SCOPES`,
because the list lives in code.

### 4.3 `categories`, `locations`

- **`categories`:** `name` not null; `group` null. Unique on
  `(lower(name), lower(coalesce("group", '')))`. Name alone cannot be unique: the live workspace
  has three case-insensitive name collisions across different groups.
- **`locations`:** `room` and `zone` not null; `map_tag` null, unique when present. Unique on
  `(lower(room), lower(zone))`.
- **Both** carry `notion_page_id` (text, unique, null) — the archive id from the import.

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
| `last_reviewed_at`, `last_reviewed_by` | timestamptz null / uuid fk `users` null | The **Looks good** mark from an inventory review |
| `notion_page_id` | text unique null | The legacy URL key for Goal 2 |
| `created_by`, `updated_by` | uuid fk `users` null | Null on imported rows |

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

- **Columns:** `tool_id` (fk, cascade, null); `title` not null; `type`; `url` (text null);
  `published` (boolean not null, default true); `notion_page_id`.
- **`type` is free text with no CHECK.** The workspace defines about a dozen options and intake
  narrows them to three, so a constraint built from either list would reject values already
  stored.
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
| `uploaded_by` | uuid fk `users` null | |

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

There is no CHECK requiring a unit or a tool: the audit found that most live logs have neither,
and a ticket with no target is still a ticket. `report_issue` still refuses to file without a
title.

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

### 4.10 `projects`, `project_tools`

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

### 4.11 `pending_tools`

```ts
// src/lib/data/pending-tools.ts (types)
export type PendingStatus = (typeof PENDING_STATUS)[number];
export type DuplicateResolution = "new_tool" | "add_unit" | "discard";

export interface PendingTool {
  id: string;
  batchId: string;               // items identified together
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
- **Cleanup.** An item left `identified` for 14 days is discarded, and its attachments deleted, by
  the daily cleanup job.

### 4.12 `audit_events`

Append-only: the data layer exposes insert and select, never update or delete.

- **Columns:** `at`, `actor_user_id`, `action`, `subject_type`, `subject_id`, `detail` (jsonb).
- **`action` values:** `role.changed`, `scope.granted`, `scope.revoked`, `user.disabled`,
  `tool.published`, `tool.unpublished`, `tool.archived`, `project.published`,
  `project.unpublished`, `pending.approved`.
- **Scope:** security-relevant actions only. Ordinary edits are not logged here (Non-goals).

### 4.13 Mirror tables

- `mirror_targets` — `entity` (text pk), `notion_database_id` (text not null), `last_pushed_at`
  (timestamptz null), `last_status` (text null), `last_error` (text null).
- `mirror_pages` — `entity` (text), `entity_id` (uuid), `notion_page_id` (text unique), `pushed_at`
  (timestamptz); primary key `(entity, entity_id)`.
- `mirror_lease` — a single row (`id` smallint pk, CHECK `id = 1`), with `running_since` and
  `requested_at` (both timestamptz null).

### 4.14 View models keep their shape

`MakerLabTool`, `MakerLabUnit` and `MakerLabProject` in `src/components/catalog-types.ts` keep
their fields, so pages, components and capability outputs are untouched.

- **Two values change meaning.** `id` becomes the Postgres UUID. `slug` becomes a readable slug
  instead of the Notion page id.
- **Derived fields** (`status`, `trainingLevel`, `trainingLabel`, and unit `condition`) are computed
  exactly as `catalog.ts` computes them today, from the new stored values.

### 4.15 What a person must do in Notion

Notion has no migrations. These steps are manual and happen in the phase named.

| When | Action | Who |
|---|---|---|
| Phase 6 | Create a page "MakerLab Tools — mirror" and share it, with edit access, with the integration behind `NOTION_API_KEY` | Niti or Isaac |
| Phase 6 | Run `scripts/notion-mirror-setup.ts`, which creates the seven databases. No properties are built by hand. | Isaac |
| Phase 8, after the final import | Rename today's databases with an `ARCHIVE — ` prefix, and set workspace members to view-only on them | Niti |
| Phase 8 | Tell staff: edit on the website; the mirror is view-only; the archive is history | Niti |

Records created before cutover are imported with their Notion page ids. Nothing in Notion is
deleted.

## 5. Behaviour / flow

### 5.1 Browsing and chat

Unchanged for visitors. Reads come from Postgres, and images come from Blob.

### 5.2 Signing in, and changing a role

1. A person signs in with Google. The after-hook enforces the domain as it does today, upserts
   their `users` row, and sets the cookie.
2. On their next request, `resolveIdentity` reads their role. A new address is `member`; an
   address in `AUTH_SUPER_ADMIN_EMAILS` is `super_admin`.
3. A super admin opens `/admin/users`, finds the person, and picks a new role. The server action:
   - checks `users.manage`;
   - refuses to demote an address in `AUTH_SUPER_ADMIN_EMAILS`, and the UI explains why;
   - writes the role;
   - records `role.changed`.
4. The person's next request resolves the new role. Nothing is cached across requests.

**Unhappy paths.**

- **The database is down during sign-in.** The upsert fails but sign-in still completes. The person
  resolves as `member` until a request can read their row. Sign-in never fails because of the
  upsert.
- **A disabled account** resolves to anonymous, and the header offers sign-in as if they were
  signed out.

### 5.3 Editing inventory

**(a) `/admin/inventory` — the review table.** Requires `tools.edit` or `units.edit`.

1. A server-rendered table of every tool, with drafts and archived tools included for
   `catalog.view_drafts`. Columns: photo, name, category, location, units (count and worst
   status), state (published, draft, archived), last reviewed, last updated.
2. Filters: state, category, location, free-text search, and **Needs attention** — no photo, no
   manual, unlinked units, open tickets, or never reviewed.
3. Selecting a row opens the **tool editor** in a side panel:
   - **Tool fields.**
   - **Units:** add one; edit label, serial, asset tag, status, condition, date acquired.
   - **Resources:** add a URL or upload a PDF.
   - **Photos:** upload, reorder, remove.
   - **Looks good**, which sets `last_reviewed_at`. A full inventory review is this table filtered
     to *never reviewed*, one row at a time: good, edit, or archive.
4. **Save** calls `updateTool(id, patch, expectedUpdatedAt)`. If `updated_at` has moved since the
   panel opened, nothing is written; the panel says someone else changed this tool and offers to
   reload. There is never a silent overwrite.
5. **Publish**, **Unpublish** and **Archive** appear only with `tools.publish`, and each writes an
   audit event.

**(b) Edit mode on `/tools/<slug>`.** Requires `tools.edit` or `units.edit`.

- An **Edit** control opens the same tool editor over the detail page.
- A person with only `units.edit` sees just the units section — for example, a SuperMaker marking a
  printer out of service from their phone.
- Drafts are reachable at their slug only with `catalog.view_drafts`. Everyone else gets the 404
  page.

**Deleting.**

- **Tools** are archived, never deleted, and an archived tool can be restored.
- **Units** can be retired (`status = retired`), or deleted if they have no maintenance history.

### 5.4 Adding equipment

**Step 1 — identify, in the chat** (`tools.add`).

1. The person opens the chat and sends photos, text, or both. The header's **Add** button seeds "I'd
   like to add new equipment to the inventory."
2. The model looks at the photos and the words and works out what each item is. For example, "a
   Bambu X-something" plus a photo of the front becomes *Bambu Lab X1-Carbon Combo*.
   - The intake prompt allows at most two web searches, and only to settle a model name. The
     route's per-turn cap of 5 remains the hard limit.
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
   - creates `pending_tools` rows (status `identified`, one `batchId`, `created_by` from the
     session);
   - attaches the photos;
   - runs the **duplicate check** against published tools, drafts and other pending items (a
     normalized name-plus-brand match first, then `pg_trgm` similarity above a threshold);
   - emits a `data-pending-table` card.
5. **The pending table card** is an editable table, not a row of chat buttons.
   - **Columns:** photo, name, brand, category, and a duplicate badge.
   - **Row actions:** edit inline, or remove.
   - **Duplicate rows** must choose one of **Add as another unit** (which asks for a serial number),
     **It's a different tool**, or **Remove**.
   - **Edits** go through `PATCH /api/pending-tools/[id]`, never through the model, so fixing a typo
     costs no tokens.
   - **Research N tools** stays disabled while any row is being edited or any duplicate is
     unresolved.

**Step 2 — research, in the background.**

6. **Research N tools** calls `POST /api/pending-tools/batches/[batchId]/research`. The route:
   - checks `tools.add`, and that the caller created the batch or holds `tools.publish`;
   - enforces the limits: 25 items per batch, and 100 researched items per person per day;
   - sets the items to `queued`;
   - calls `start(researchBatch, [batchId])` and stores the run id;
   - returns immediately.
7. The card changes to "Researching 5 tools — you can close this. Results will be on the Intake
   page," with a link to `/admin/intake?batch=…`.
8. **Add as another unit** rows skip research: they become `researched` straight away with their
   target tool, because there is nothing to look up.
9. The workflow researches the rest, four at a time (§3.7). Each item finishes as `researched` or
   `failed` independently.

**Step 3 — review and approve** (`/admin/intake`).

10. The queue groups items by batch. Each researched item shows:
    - the proposed record, editable in the same fields as the tool editor;
    - the confidence strip, reused from the identification card;
    - sources, verified links and dropped links;
    - the photo.

    The page polls every 5 seconds while any item in view is `queued` or `researching`.
11. **Actions.**
    - **Approve as draft** (`tools.add`) — creates the unpublished tool, its units, resources and
      attachments, in one transaction.
    - **Approve and publish** (`tools.publish`) — the same with `published = true`, plus an audit
      event.
    - **Add unit** (`units.edit`) — creates the unit on the existing tool.
    - **Re-run research**, or **Discard**.
12. **Low confidence** disables both Approve actions until the person either changes the name or
    brand and re-runs research, or ticks "I've checked this" and adds a note. This is the
    confidence spec's behaviour gate, moved from the chat card to the review page.

**Unhappy paths.**

- **The workflow fails to start:** the items stay `queued`, the error shows, and a **Retry** button
  appears.
- **The model cannot identify an item:** it asks one short question instead of calling
  `identify_tools` for that item.
- **The browser cannot encode a photo:** identification proceeds from the text, and the photo still
  attaches.
- **Two people add the same tool at the same time:** the second duplicate check sees the first
  person's pending row.
- **Research finds nothing:** the item becomes `researched` with low confidence and empty
  resources, never invented ones.

### 5.5 Projects

- `/projects/new` requires `projects.submit`. Anonymous visitors see "Sign in to share your project"
  in place of the form.
- The author is the signed-in user; the typed-name field is removed.
- Submissions stay unpublished until someone with `projects.moderate` publishes them on
  `/admin/projects`.

### 5.6 Maintenance and corrections

Anyone can still report a problem or a correction. After cutover staff can no longer work tickets
in Notion, so this spec includes the smallest queues that keep that work possible:

- **`/admin/maintenance`** (`maintenance.manage`): list tickets; change status, priority and
  assignee; write a resolution.
- **`/admin/corrections`** (`feedback.manage`): list corrections; mark them reviewed, fixed or
  dismissed; link to the tool editor.

Notifications, service targets and assignment rules are out of scope.

### 5.7 The mirror at work

Setup, push and triggers are in §3.8.

- **A failed push** is logged, shown on `/admin` as the last status and error, and retried on the
  next trigger.
- **Notion's API is down:** the app is unaffected.
- **A mirror database was deleted by hand:** that entity's push fails with "database not found", and
  `/admin` offers to re-run setup for it.

### 5.8 Import and cutover

**Import** (`scripts/import-notion.ts`, read-only against Notion):

1. **Pre-flight.** Read each database's schema and compare every select and multi-select option
   with §4.1. **Stop** on an unmapped value, naming the database, property and option. Silently
   mapping to a default is how data gets lost.
2. **Read** every source database, paginated, at 3 requests per second.
3. **Write** in dependency order, one transaction per entity, recording `notion_page_id` on every
   row.
4. **Copy files.** Download each Notion-hosted file during the run and upload its bytes to Blob.
   Notion file URLs expire about an hour after they are read, so a URL is never stored.
5. **Split maintenance descriptions.** v5 composes "What happened / Reported by / Date reported /
   Priority" into one description. The import parses these back into columns, and keeps the
   original text in `description` whenever parsing is not exact.
6. **Idempotent.** A re-run updates rows by `notion_page_id` and reports a diff. That is what makes
   a rehearsal followed by a final run safe.

**Verification** (`scripts/verify-import.ts`) checks:

- row counts per entity;
- relation integrity — every unit's tool, every resource's tool;
- files — every attachment has bytes in Blob;
- five named tools — their rendered `MakerLabTool` objects compared field by field between the
  Notion path and the Postgres path.

**Cutover runbook.**

1. **Rehearse** on a Neon preview branch: import, verify, and click through the preview
   deployment. Fix what breaks and repeat.
2. **Freeze.** Announce a time after which Notion edits will not be carried over.
3. **Final import** into the production database, then verify.
4. **Flip.** Set `DATA_BACKEND=postgres` in production and redeploy.
5. **Smoke test.**
   - The gallery count matches.
   - Three tool pages render with images.
   - An old `/tools/<notion-id>` URL redirects.
   - Anonymous chat answers, and a report files.
   - An admin edit appears on the public page.
   - The mirror's first run succeeds.
6. **Archive** the old databases (§4.15).
7. **Rollback window: 7 days.** To roll back, set `DATA_BACKEND=notion` and redeploy; the app returns
   to the frozen Notion data. `scripts/writes-since.ts` lists every row written in Postgres after
   the flip, so those can be re-entered by hand. After 7 days, Phase 9 removes the Notion code and
   the window closes.

## 6. UI

Admin pages follow the "Architectural Brutalism + Blueprint Archive" system
(`docs/MakerLab_design/DESIGN.md`). They are server components, with client islands for the tool
editor, the pending table card, and the role matrix.

| Surface | Components | Notes |
|---|---|---|
| Header | `AdminLink` (any admin scope); existing **Add** (`tools.add`) | Driven by `scopes` from `/api/identity` |
| `/admin` | `AdminHome`: counts, intake queue, open tickets, mirror status | |
| `/admin/inventory` | `InventoryTable`, `InventoryFilters`, `ToolEditorPanel` | |
| `/tools/<slug>` | `EditToolControl` and the same `ToolEditorPanel` | |
| `/admin/intake` | `IntakeQueue`, `ResearchedItemEditor`, reused `ConfidenceStrip` | Polls while research runs |
| Chat | `PendingTableCard` (new `data-pending-table` part) | Replaces `IdentificationCard` for intake |
| `/admin/users` | `UsersTable`, `RoleSelect` | |
| `/admin/roles` | `RoleScopeMatrix` | Super-admin-only scopes shown locked |
| `/admin/maintenance`, `/admin/corrections`, `/admin/projects` | A list with status controls | Minimal (§5.6) |
| `/projects/new` | Sign-in prompt for anyone without `projects.submit` | |

**States.**

- **Loading:** skeleton rows.
- **Empty:** a sentence naming what is missing and the action that would change it — "No drafts."
  "Nothing is waiting for review."
- **Database unavailable:** the error state, never sample data.
- **Conflict:** an inline message in the panel. Never a modal that could lose unsaved edits.
- **Saved:** an inline status in the panel.

**Mobile.**

- The inventory table becomes a card list, and the editor panel becomes a full-screen sheet.
- Edit mode on a tool page is designed phone-first, because a SuperMaker changing a unit's status is
  standing next to the machine.
- The pending table card stacks each row's fields vertically.

**Strings (Article 6).** Every new user-facing string goes into all 12 locale files. The admin
surfaces add roughly 200–250 keys. Article 6 has no exception for staff screens, so translation is a
real cost and a gate on Phase 5 (§11 q10).

## 7. Relationship to existing work

### 7.1 Constitution amendments (proposed here; merged with or before this spec)

- **Article 3, one sentence.** "The mock catalogue serves the data layer" becomes "An in-process
  Postgres (PGlite) with a demo seed serves the data layer."
- **Article 5, replaced:**
  > **Writes are drafts by default.** Anything the agent or a member creates — catalogue entries
  > from intake, project submissions — is written unpublished. Publishing requires a person holding
  > `tools.publish` or `projects.moderate`, and is recorded in `audit_events`. Do not add a write
  > path that publishes without one.
- **Article 7, replaced:**
  > **Postgres is the source of truth; Notion is a mirror.** The app reads and writes its Postgres
  > database. It pushes a one-way copy to the Notion mirror databases and never reads Notion at
  > request time. Staff edit records in the app.

### 7.2 Specs this partly supersedes

| Spec | Superseded | Kept |
|---|---|---|
| Auth and rate limiting (2026-07-29) | §3.3 env-list roles; §8 "no capability is role-gated" | Google sign-in, the signed cookie, domain enforcement, rate-limit tiers |
| Chat inventory intake (2026-06-01) | §4 research in the turn; §5 Notion write layer; §6.3 identification card for intake | §6.1 vision, §6.2 dictation, the capability registry |
| Intake confidence (2026-07-29) | §3.3 fan-out inside the chat turn | Evidence reporting, graded confidence, the behaviour gate (moved to review) |
| Student projects gallery (2026-07-29) | Anonymous submission; moderation in Notion | Gallery, detail pages, "built with this" |
| Operational hardening (2026-07-29) | Backing up Notion | Nightly backup to private Blob, 30-day retention |
| Report a correction (2026-07-29) | The Flags database | The form, `report_correction`, the fields |
| QR codes (2026-07-29) | Page id in the URL | Arrival behaviour; old labels redirect |

When the phase that supersedes each one merges, that spec gets a dated amendment pointing here
(`DRIFT.md`).

### 7.3 PR #31 (held)

PR #31 fixes chat vision and makes intake staff-only through `minimumRole`. It is held because
production sign-in is not configured.

- **The vision fix** is a prerequisite for Step 1 of §5.4. Merge it on its own, or carry it into
  Phase 2.
- **`minimumRole`** becomes `requiredScope` in Phase 4. If #31 has merged by then, Phase 4 migrates
  `capabilitiesForRole` to a scope-based version; if not, Phase 4 introduces the scope version
  directly.

### 7.4 Other

- **Branches:** no feature branches are in flight; everything earlier has merged.
- **`docs/v5-plan.md` §9.6** (admin-leverage features) is partly delivered by §5.3 and §5.6.
- **Blueprint** is not a dependency. Its 2026-08-14 audit of this Notion workspace is cited for data
  facts only.

## 8. Security and safety

**Authorization.**

- `can(identity, scope)` runs server-side in every server action, route handler, and capability
  composition. Hiding a control is presentation only.
- `users.manage` and `roles.manage` belong to `super_admin` alone and cannot be granted to any other
  role.
- An address in `AUTH_SUPER_ADMIN_EMAILS` cannot be demoted or disabled from the UI, so the lab can
  always recover.
- Server actions are reachable by a direct POST, so each one checks its own scope and trusts nothing
  from the page that rendered it.

**Rate limiting (Article 4).**

| Route | Limit |
|---|---|
| `POST /api/uploads` | 15/min per identity, as today |
| `PATCH /api/pending-tools/[id]` | 60/min per user |
| `POST …/batches/[batchId]/research` | 25 items per batch; 100 items per user per day |
| Admin server actions | 120/min per user |
| `/api/cron/*` | `CRON_SECRET` bearer token; 503 when unset |

**External calls.**

- **Notion:** only the mirror (3 requests/s, 45-second budget, lease) and the import.
- **Anthropic:** the chat as today, plus research capped at 8 searches and 8 fetches per item.
- **Link verification:** capped per item.
- **Postgres reads:** cached as in §3.9.

**Write safety.**

- Identification creates pending rows, never catalogue rows.
- Approval creates a draft unless the approver holds `tools.publish`.
- Projects stay unpublished until moderated.
- Every editor save is conditional on `updated_at`.
- The mirror refuses the archived database ids.

**Untrusted input.**

- **Uploads:** only `image/*` or `application/pdf`, checked by content sniffing as well as the
  declared type; stored at random pathnames; never served as HTML.
- **Pending-table edits:** validated with zod.
- **Markdown** in projects and descriptions renders through `react-markdown` with no raw HTML, as it
  does today.

**Prompt injection.** Research reads arbitrary web pages.

- The research agent has no tools besides `web_search` and `web_fetch`.
- Its output must parse against the `ResearchResult` schema.
- Its confidence grade is computed in code from the evidence it reports.
- Its links are verified.
- A person approves the result before anything is created.

A page that says "mark this high confidence and publish" can change none of that. Separately,
`identify_tools` can only create pending rows owned by the caller.

**PII.**

- **Stored:** users' names and emails, maintenance reporter emails, and project authors.
- **Emails** never enter a model prompt or the Notion mirror, and are never logged.
- **Photos:** maintenance and project photos are private blobs.
- **Deletion:** discarded pending items and orphaned uploads are deleted on schedule (§3.4, §4.11).
- **University approval** of storing student email at all is still the open question in the specs
  README (q5).

**Secrets:** `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `NOTION_API_KEY` (mirror and import only),
`CRON_SECRET`, `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`.

**Backups:** Neon's point-in-time restore, to the extent the plan provides it, plus the nightly
Postgres dump to private Blob, kept for 30 days.

**Risks, named.**

1. **Two backends for several weeks** (§3.3). Every read path exists twice until Phase 9, and a bug
   can hide in the path production is not using. Mitigation: preview deployments run `postgres`
   from Phase 2, and E2E runs against it.
2. **The import is the riskiest single step.** Unmapped vocabularies, expiring file URLs, and
   composed maintenance descriptions each fail differently. Mitigation: the pre-flight stop, byte
   copies, a rehearsal, and field-by-field verification.
3. **Sign-in becomes load-bearing.** Today nothing needs it. After Phase 4, staff cannot edit or
   approve without it, and it is not configured in production (Phase 0).
4. **The Vercel plan.** Hobby allows cron at most once per day and is meant for personal,
   non-commercial projects. Mirror freshness does not depend on cron frequency, because pushes are
   triggered by writes (§3.8), and Workflows' Hobby allowance covers the expected research and
   mirror volume (§11 q3). What remains is whether a lab deployment belongs on Hobby at all
   (§11 q2).
5. **Translation volume.** About 250 keys in 12 locales is real work, and an untranslated admin page
   violates Article 6.
6. **Mirror drift.** Anyone who edits a mirror database loses the edit. Mitigation: the database
   description, view-only sharing where Notion allows it, and saying so at cutover.

## 9. Phased build order

Each phase is its own PR, leaves `main` deployable, and keeps production on `DATA_BACKEND=notion`
until Phase 8.

| # | Phase | Delivers | Depends on | Parallel with |
|---|---|---|---|---|
| **0** | Prerequisites (people) | Google OAuth client and `AUTH_*` in production; Neon installed for production and preview; Blob store linked; `AUTH_SUPER_ADMIN_EMAILS`; answers to §11 q2–q4; this spec and §7.1 merged | — | — |
| **1** | Schema and import | `src/lib/db/*` (schema, migrations, client, triggers, demo seed); `scripts/import-notion.ts` with pre-flight; `scripts/verify-import.ts`. No runtime change. | 0 | — |
| **2** | Read path | `DATA_BACKEND`; `catalog.ts`, `projects.ts`, capability reads, chat manuals, `/api/health`, the legacy-id redirect, Blob images; previews on `postgres`; E2E on PGlite | 1 | — |
| **3** | Write paths | `report_issue`, `report_correction`, project submission, `POST /api/uploads`, attachment cleanup, backup route on Postgres | 2 | 4, 6 |
| **4** | Accounts | `users` upsert; role from the database; `role_scopes` with seeded defaults; `can()`; `scopes` in `/api/identity`; `requiredScope`; `/admin/users`, `/admin/roles`; `audit_events`; projects require sign-in | 2 | 3, 6 |
| **5** | Inventory editing | `/admin/inventory`, `ToolEditorPanel`, edit mode on tool pages, publish and archive, Looks good, `/admin/maintenance`, `/admin/corrections`, `/admin/projects`, cache-tag invalidation; locale keys (the gate) | 3, 4 | 6 |
| **6** | Notion mirror | Setup script, `src/lib/mirror/*`, lease, `requestMirror()`, daily cron, `/admin` status, archive-id guard | 1 | 3, 4, 5 |
| **7** | Two-step add-tool | `pending_tools`, `identify_tools`, `PendingTableCard`, `src/lib/research/*`, the `researchBatch` workflow (or the §3.7 fallback), `/admin/intake`; `research_tool` and `propose_listing` leave the chat | 4, 5 | — |
| **8** | Cutover | Rehearsal on a preview branch, freeze, final import, flip, smoke test, archive the old databases | 2–7 | — |
| **9** | Removal | Delete the Notion read and write code, `DATA_BACKEND`, the `NOTION_DB_*` readers, the mock catalogue and the Notion MSW fixtures; retire the Notion scripts. Each deletion is proposed and approved separately (constitution working agreements). | 8, plus 7 days | — |

## 10. Testing

Every layer runs with no environment variables and no network: PGlite for the database, MSW for
Notion and Blob, and `streamText` / `generateText` stubbed for models.

**Unit.**

- **Vocabulary mapping:** every Notion option maps to a stored value, and an unmapped option raises.
- **Slugs:** generation, collision suffixes, stability across renames.
- **Permissions:** `can()` for every role and scope; the implicit `super_admin` grant; the env floor;
  super-admin-only scopes cannot be granted.
- **Legacy ids:** detection and redirect target.
- **Mirror property builders** for each entity, asserting emails are never present.
- **The `ResearchResult` schema:** accepts well-formed results; rejects extra and wrongly typed
  fields.
- **The duplicate matcher:** normalization, brand-aware matching, the threshold.
- **Import mappers**, including the maintenance description parser, over fixtures shaped like the
  real data.

**Integration** (PGlite + MSW).

- **Query modules:**
  - `created_by` and `updated_by` stamping;
  - the `updated_at` trigger;
  - a save with a stale `expectedUpdatedAt` writes nothing and says so;
  - archive instead of delete;
  - approval is transactional.
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
  - the lease prevents overlapping runs;
  - on partial failure, `last_pushed_at` advances only past successes;
  - an archived database id is refused.
- **Routes:**
  - `/api/uploads`: type, size, anonymous rate limit;
  - pending-tools `PATCH`: scope and ownership;
  - research start: limits, and `start()` called with the batch;
  - cron routes: the secret is required.
- **Workflow steps**, called directly with the model stubbed: `researchItem` for success, verified
  and dropped links, a retryable error, and a fatal error.
- **One in-process `@workflow/vitest` test** of `researchBatch`, asserting that one failing item does
  not stop the others.

**Component.**

- `InventoryTable` filters, including Needs attention.
- `ToolEditorPanel`:
  - dirty state;
  - the conflict message keeps unsaved edits;
  - Publish is absent without `tools.publish`;
  - `units.edit` alone shows only the units section.
- `PendingTableCard`: inline edit, remove, duplicate choice, and Research disabled while anything is
  unresolved.
- `RoleScopeMatrix`: toggles work, and super-admin-only scopes are locked.
- The projects form shows the sign-in prompt without `projects.submit`.

**E2E** (Playwright, PGlite demo database).

The E2E server gets a test-only `AUTH_SECRET`, so server-rendered admin pages can read a real signed
cookie. This amends the auth spec's E2E note and still makes no network call.

1. An anonymous visitor browses, opens a tool, reports a problem, and cannot submit a project.
2. A member submits a project; it is not in the gallery until an admin publishes it.
3. An admin edits a tool's description in `/admin/inventory`, and the public page shows it.
4. A SuperMaker marks a unit out of service from the tool page at a phone viewport.
5. A SuperMaker adds two tools through chat (a stubbed stream emits the pending table), edits one,
   removes one, presses Research (the workflow is stubbed to finish), and approves as a draft. The
   draft appears in inventory and not in the gallery.
6. A super admin changes a member to SuperMaker, and that person's Add button appears on their next
   page load.
7. `/tools/<notion-page-id>` redirects to `/tools/<slug>`.

**Cases that would embarrass us in production.**

- The import silently drops, or defaults, rows with an unknown select value.
- Images break an hour after cutover because URLs were copied instead of bytes.
- A demoted admin keeps editing.
- The mirror writes into the archive.
- Printed QR codes 404.
- Research publishes something nobody approved.
- A student's project photo is reachable by URL before the project is published.
- The last super admin demotes themselves.
- Two people edit one tool and one person's change vanishes.
- Production serves demo data because `DATABASE_URL` went missing.

## 11. Open questions

| # | Question | Recommendation | Who | By |
|---|---|---|---|---|
| 1 | **Cutover date** relative to ISAM (Oct 11–13) | Cut over only after a clean rehearsal, and not in the 72 hours before the demo | Isaac | Before Phase 8 |
| 2 | **Vercel plan.** Hobby is meant for personal, non-commercial projects and limits cron to once a day. Nothing in this spec needs Pro to work, but a lab deployment may not belong on Hobby. | Pro, which also adds Spend Management for the model bill | Isaac, Niti (who pays) | Before Phase 8 |
| 3 | **Vercel Workflows cost.** Hobby includes 50,000 Workflow events and 1 GB of data written per month. Each step is about three events, so researching 100 tools is roughly 300–400 events, and mirror runs add a few thousand a month. Run data is kept 1 day on Hobby and 7 days on Pro. | Use Workflows; revisit only if usage approaches the allowance | Isaac | Before Phase 7 |
| 4 | **Initial roster:** who is super admin, admin and SuperMaker at launch, and how today's `AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` map | Staff → admin, unless named as a SuperMaker | Niti, Isaac | Before Phase 4 ships |
| 5 | **Default SuperMaker grants** (§3.5) | As proposed; they can change later without a deploy | Niti | Before Phase 4 ships |
| 6 | **Reporter names in the mirror.** Emails are excluded; should names be too? | Names in, emails out | Niti | Before Phase 6 |
| 7 | **Project photo consent** (open question 6 in the specs README) | A consent checkbox on submission before Phase 5 ships moderation | Niti | Before Phase 5 |
| 8 | **Who owns the Google OAuth client** — Cornell's Google Workspace or a personal Google Cloud project — and so who can rotate it after handover | Cornell-owned | Isaac, Niti | Phase 0 |
| 9 | **The archive:** renamed and view-only, or also exported | Renamed and view-only, plus the nightly backup | Niti | Phase 8 |
| 10 | **Admin translation:** all 12 locales per Article 6, or amend Article 6 for staff-only screens | Keep Article 6: SuperMakers are students and use the same language selector | Isaac | Before Phase 5 |
