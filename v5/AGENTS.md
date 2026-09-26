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
- **AI:** Vercel **AI SDK v6** (`ai`, `@ai-sdk/react`) through the **Vercel AI Gateway** (`@ai-sdk/gateway`) — the *only* model path (gateway spec 2026-09-23: `ANTHROPIC_API_KEY`, `@ai-sdk/anthropic` and the direct-provider `src/lib/model.ts` are retired and removed). Every model call names a **job**, not a model — `chat`, `researchSearch`, `researchRead`, `imageRank`, bulk intake's `importParse` and `nameSuggest` (`MODEL_IMPORT_PARSE`, `MODEL_NAME_SUGGEST`, both flex), the display-name backfill's `displayName` (`MODEL_DISPLAY_NAME`, flex), the description shortener's `descriptionShorten` (`MODEL_DESCRIPTION_SHORTEN`, flex), and the embedding job `embed` (`openai/text-embedding-3-small` at 512 dimensions, manual search — manual text spec phase 2) — resolved by `src/lib/ai/models.ts`'s `MODEL_JOBS`, each with a code default (`openai/gpt-6-luna` for every language job — chat passed the §10 eval gate once its prompt was tuned, gateway spec amendment "Chat prompt tuning for Luna") and one `MODEL_<JOB>` env override. Each job also names a Gateway **service tier** — `flex` for the background jobs (research search/read, image ranking, the starter-question backfill), none for chat — sent by `providerOptionsFor(job)` and overridden by `MODEL_<JOB>_TIER` (`default`/`flex`/`priority`; amendment "Manuals as text and flex tier for research"). Research's read step gives a manual PDF as **text**, not a file part (`RESEARCH_ATTACH_PDFS = false` in `intake/limits.ts`) — the lab's own extraction first (a stored manual, or the downloaded PDF extracted in memory: outline plus the pages richest in specs), the search's captured copy only as the fallback (manual text spec, phase 1); chat answers from a processed manual with `search_manual` and attaches only the manuals not yet processed (phase 2). There is **no image model**: the `imageClean` redraw was retired on 2026-09-23 because it altered product labels (spec amendment "No generative redraw"); background removal is a deterministic cutout in code. Web search is `gateway.tools.exaSearch` (Exa, provider-executed — one request leaves our process regardless of how many search legs the Gateway runs); reading a specific page is `read_page`, our own capability tool over `src/lib/web/*`'s SSRF-guarded fetch, not a provider tool. Auth is `AI_GATEWAY_API_KEY` when set, else the deployment's own Vercel OIDC token — production sets neither key nor a fallback, only the Gateway. Markdown via `react-markdown` + `remark-gfm` on pages (`system/Markdown`) and `streamdown` in the chat (raw HTML off, UI system phase 5b).
- **MCP:** `@modelcontextprotocol/sdk` (stateless HTTP JSON-RPC server at `/api/mcp`, and `/api/mcp/signed-in` for OAuth clients) — see "MCP access" below.
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
  `dataSubstrate()` (`"neon" | "pglite-local" | "pglite-demo"`), `pingDb()`
  (throws `DbUnavailableError`), `resetDbForTests()`.
- **Local database (`PGLITE_DATA_DIR`).** Precedence is `DATABASE_URL` >
  `PGLITE_DATA_DIR` > demo seed. With `DATABASE_URL` unset and
  `PGLITE_DATA_DIR` set (e.g. `.pglite-data`, git-ignored; relative to `v5/`),
  `getDb()` opens a **persistent** PGlite in that directory — created if
  missing, migrated on every open, **never demo-seeded** — as substrate
  `"pglite-local"`: no `DemoDataBanner`, `/api/health` answers
  `"database": "local"`, `"catalog": "live"`. It exists to import the real
  Notion inventory and review it in the dev app before importing into Neon.
  Local only: `localDataDir()` (`src/lib/db/local-dir.ts`) **throws** on Vercel
  or with `NODE_ENV=production`, so unset it before `next build`.
  **Single-process:** `dir/lock` holds the owner's pid
  (`src/lib/db/pglite-lock.ts`); a second process gets `PgliteLockedError`
  ("in use by process N … stop that process"), so **stop `npm run dev` while an
  import, `verify:import` or `db:migrate` runs against it**. A stale lock (dead
  pid) is taken over; a failed open is not memoised, so the dev server recovers
  on the next request. The cluster itself is `dir/pgdata`. Vitest and the E2E
  servers blank the variable.
- `src/lib/db/schema/index.ts` — tables and vocabulary constants (stored
  snake_case, e.g. `in_use`; display text is derived, never stored).
- `src/lib/catalog.ts` — orchestration: fetch + join + derive `MakerLabTool`s
  from Postgres, cached with `cacheTag("catalog")` / `cacheLife("minutes")`.
- `src/lib/data/*.ts` — the query modules underneath: `catalog.ts`,
  `projects.ts`, `maintenance.ts`, `resources.ts`, plus `uuid.ts` (the shape
  guard every untrusted id passes before it reaches a uuid column) and
  `notion-ids.ts`. Relative imports with `.ts` extensions, no `@/` alias, no
  `"server-only"` — `scripts/` loads them under plain Node.
- **Notion is read only by the one-time import** (`npm run import:notion`;
  target per `src/lib/import/target.ts`: `--dry-run` → memory, else
  `DATABASE_URL`, else `PGLITE_DATA_DIR`; `verify:import` and `db:migrate`
  follow the same order).
  No request path reads Notion *as data*. The one-way mirror (app → an admin's
  own Notion workspace, Phase 8) writes to Notion through its own client in
  `src/lib/mirror/` — see "The Notion mirror" below.
- **Every student-facing write is on Postgres** as of Phase 3. A correction
  goes to `feedback`, a maintenance ticket to `maintenance_logs`, a project
  submission to `projects` + `project_tools` — see `src/lib/data/*.ts`.
  `src/lib/data/notion-ids.ts` (the Phase-2 page-id bridge) has no importers
  left and is awaiting deletion approval, as are `/api/upload-notion` and
  `/api/admin/backup`.
- **No request path writes Notion** as of Phase 6, except the mirror, which
  pushes from a workflow and from its own settings page. Intake's chat tool,
  `identify_tools`, writes `pending_tools` rows and makes the photos it claims
  public; `create_tool` is **MCP-only** now and writes an unpublished Postgres
  draft (`createToolRecord`). See "Adding equipment" below.
- **Files** (tool images, manuals, project photos, maintenance photos) live in
  **Vercel Blob**, recorded row-by-row in `attachments` — see
  `next.config.ts`'s `images.remotePatterns`. `POST /api/uploads` is the one
  upload route; it writes the blob, inserts an **unowned** `attachments` row and
  returns `{ attachmentId, previewUrl }`. The write that follows *claims* those
  ids (`claimAttachments`), and `/api/cron/daily` deletes anything still
  unclaimed after 24 hours. **Both write paths say when a photo did not stick**
  — `report_issue` appends it to the message the assistant paraphrases, and
  `POST /api/projects` answers `photosSubmitted` / `photosAttached` so the form
  can say it on the confirmation. A form left open overnight submits ids the
  cron has already swept, and thanking a student for pictures nobody has is the
  quiet lie Article 4 forbids. With no Blob store the route answers
  503 `{ code: "blob_not_configured" }` and both clients show a translated
  "photo uploads are unavailable" — never a fabricated id (Article 4).
- **Blob locally.** `blobMode()` (`src/lib/blob-mode.ts`) is the one rule:
  a `BLOB_READ_WRITE_TOKEN` → Vercel Blob; no token on Vercel (`VERCEL`) or in
  a production build → **none** (503 as above, never a disk fallback); no token
  in local dev → **local**: `.blob-data/<pathname>` (git-ignored), metadata in
  `.blob-data/.meta/`, via `src/lib/blob-local.ts`. Both write paths use it —
  `lib/blob.ts`'s `getBlobStore()` and step code's `createBlobUploader()`
  (`import/blob-uploader.ts`, used by the manual archiver). Public files get
  `<AUTH_BASE_URL>/api/dev-blob/<pathname>`, served by that route (404 for
  private files and outside local mode); `next.config.ts` allows those URLs for
  `next/image` in dev only. `BLOB_LOCAL_DISABLE=1` forces "none" — the Vitest
  setup sets it, so tests opt in to local mode with a temp `cwd`.
  `BLOB_LOCAL_DIR` (test-only) moves the folder and is the one thing that
  allows the local store in a production build (never on Vercel): the intake
  E2E's second `next start` server uses it to store and publish the cleaned
  product image. The Notion
  import's file store depends on its target (`src/lib/import/target.ts`,
  `uploaderForTarget`): a `DATABASE_URL` target still requires a real token
  (`createVercelBlobUploader` — a shared database must never hold localhost
  URLs); a `PGLITE_DATA_DIR` target uses `createBlobUploader()`, i.e.
  `.blob-data/` with `<AUTH_BASE_URL>/api/dev-blob/…` URLs when there is no
  token.
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
  lands on the person's next request and a ban bites immediately — **with one
  exception, a floor address, described under `AUTH_SUPER_ADMIN_EMAILS`
  below.** Better Auth's cookie cache is deliberately off.
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
- **"Whatever its row says" includes `banned`**, and that is the one exception
  to "a ban bites immediately". `identityFromSession` reads the floor *before*
  the ban check, so a listed address keeps resolving `super_admin` on a session
  it already holds. It does not rescue a *sign-in*: the admin plugin throws
  `BANNED_USER` from its own `session.create.before` hook, which runs ahead of
  anything this app can register, so the row itself has to change.
  `src/lib/auth/floor-role.ts` (`reconcileSuperAdminFloor`) is where it does —
  called from `/admin/users`' `authorize()` after the permission check, it
  writes the floor's `role` **and** clears `banned` on the caller's own row, so
  the first admin write a recovered director performs makes ordinary sign-in
  work again. It only ever promotes and unbans, only for an address the
  environment already names, and it records both as audit events with a null
  actor. It exists because `can()` honours the floor and the admin plugin does
  not: the plugin reads the stored `role` and `banned` for itself, so a row left
  disagreeing produces an opaque `failed` on every save.
- **Everything stays optional.** `AUTH_SECRET` alone gives database sessions;
  the two `GOOGLE_*` variables are what make *starting* one possible, and
  without them `/api/auth/sign-in/social` answers 503 and the header says
  sign-in is not set up. With neither, nobody is signed in and the catalogue and
  chat are unchanged. **Sign-in unlocks; it never gates the front door.**
- **Testing a role needs no Google.** `test/utils/session.ts` seeds a `user` and
  a `session` row and mints the cookie Better Auth would have set; the demo seed
  ships one account per role for E2E. See `test/README.md`.
- **Developing as a role needs no Google either — locally.** With
  `DEV_AUTO_SIGN_IN=1` (and `AUTH_SECRET`) in `.env.local`, `npm run dev` serves
  `GET /api/dev/sign-in?as=<email>&next=<path>`: a real Better Auth session via a
  `SERVER_ONLY` endpoint (`src/lib/auth/dev-sign-in-plugin.ts` — no
  `/api/auth/*` URL), so the create hook, the floor role and the ban check are
  Better Auth's own and cannot drift from Google sign-in. Guards in
  `src/lib/auth/dev-sign-in.ts`; each refuses with **404**: `NODE_ENV` must be
  `development`, `VERCEL` unset, `DEV_AUTO_SIGN_IN` exactly `1`, the request's
  Host loopback with no forwarded visitor address (tunnels refused), the address
  allowed and not banned. `DEV_AUTO_SIGN_IN_EMAIL` is the default `as`, and
  `/api/identity` adds `devSignIn: true` for an anonymous caller who passes the
  guards, which is the only time the header shows "Sign in as (dev)". Audited
  as `auth.dev_sign_in`. **Never set either variable on a deployment** — a
  Vercel build that has `DEV_AUTO_SIGN_IN` fails (`next.config.ts`,
  `dev-sign-in-build-check.ts`).
- **`created_by` / `updated_by` now reference `user.id`** (`on delete set null`),
  the foreign keys Phase 1 deferred. A write whose author is not a row is
  refused — correct, because in production that id comes from a session.
- **So do the three other columns that name a person**, as of migration `0004`:
  `tools.last_reviewed_by`, `maintenance_logs.assigned_to_user_id` and
  `projects.published_by`, which Phase 5 is the first code to write. They share
  `userReference()` in `src/lib/db/schema/helpers.ts` with `actorColumns()` — a
  fourth spelling of the same foreign key is the thing to avoid. All are
  `on delete set null`: removing a person must never remove the work, which is
  why `last_reviewed_at`, `assigned_to_name` and `published_at` are worth
  keeping beside them. They are what is left when the account goes.

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
- **One list of surfaces, three views** (UI system phase 4).
  `src/lib/admin/surfaces.ts` holds every admin page's key, href, group,
  permission, icon and count loader; `surfacesFor(identity)` — the same `can()`
  each page checks — feeds the `/admin` tiles, the section bar the layout puts
  on every admin page (`AdminNav`) and the ⌘K palette (`CommandPalette`). A
  page added there appears in all three; one left out is reachable from none,
  and `surfaces.test.ts` pins what each role is shown. The home's numbers are
  `loadAdminOverview(loaders)` (`src/lib/data/admin-overview.ts`): one
  aggregate per loader, only the viewer's, each failing to `null` on its own —
  a tile says "Could not be read", never 0. Waiting counts live on the tiles,
  never in the bar. Every admin page's header is `AdminPageHeader` (crumb from
  the group, a facts line from the page's own rows). Intake is the
  `src/app/admin/intake/(tabs)/` route group — Queue and Imports as `LinkTabs`
  links, **Import a list** as its header action, not a surface of its own
  (amendment 2026-09-25 "Admin polish"; its count rides on the Intake tile via
  `alsoCounts`) — and the four queues share `QueueList`. The home's tiles sit
  on one row grid (`TileGrid`/`TileGroup` subgrids, half tiles for a bare
  number or state).
- **Server actions check themselves.** A server action is a POST endpoint with
  a generated name, reachable without the page that offers it, so
  `src/app/admin/users/actions.ts` resolves the identity, rate-limits
  (`ADMIN_ACTION_TIER`, 120/min per person), and re-checks `users.manage` — it
  trusts nothing from the page that rendered the control (spec §8). Refusals are
  **values** (`{ ok: false, error }`), not exceptions, so the island can render
  the reason; every code has an `admin.errors.<code>` string.
- **The server actions are the only way in.** The admin plugin also mounts its
  own HTTP endpoints under `/api/auth/admin/*`, which would be a second,
  unreviewed door onto the same writes. `src/app/api/auth/[...all]/route.ts`
  refuses every path under that prefix with 403 `admin_api_not_exposed`, before
  the auth instance is even constructed — percent-decoding and lower-casing the
  path first, so `%61dmin` and `/ADMIN/` are the same refusal.
- **A change that landed minus a guarantee is a warning, not an error.** The
  audit write happens *after* `auth.api.setRole` has committed, so
  throwing there would make the page show the old value over a database holding
  the new one. `record()` reports instead, and the action answers
  `{ ok: true, …, warning: "audit_unavailable" }`. Both islands keep the new
  value and show `admin.warnings.<code>` in `RowStatus`'s warn tone.
  **Never answer `{ ok: false }` for a write that landed** — both islands
  respond to a refusal by restoring the previous value, which would then assert
  a state the database does not hold. Phase 5 reuses this rather than repeating
  it: `record` and `warn` now live in `src/lib/admin/audit-warning.ts`, and the
  codes every admin surface shares in `src/lib/admin/action-result.ts`.
- **`/admin/inventory` is the review table, and it is not the catalogue.** It
  lists every tool including drafts and archived ones, with the flags a review
  runs on — no photo, no manual, open tickets, never reviewed — computed in SQL
  by `src/lib/data/inventory.ts` in six statements whatever the size of the
  inventory. An *archived* tool carries no flags: archiving is one of the three
  outcomes of a review, so settled equipment stays out of the queue. Units that
  belong to no tool come back as their own list rather than being attached to a
  guessed tool.
- **The filters are client-side and in the URL, both on purpose.** The server
  renders every row and `InventoryBoard` (on the shared `DataTable` +
  `FilterBar`, UI system phase 2) narrows them in the browser (the
  `GalleryShell` idiom), so a facet costs no round trip; it then writes the
  filters back with `history.replaceState`, so "every tool with no manual" is a
  link somebody can send and the Back button still points where the reviewer
  came from. `inventory-filters.ts` is the directive-free sibling both the page
  and the island import — it owns which values a URL may carry, and drops any
  it does not offer. An empty table names the filter that emptied it; "no
  results" on its own tells a reviewer nothing (§6).
- **Editing inventory is optimistic, and its token is a string.** The tool
  editor reads a revision when it opens and hands it back with the save; the
  write happens only if `tools.updated_at` has not moved. The token is
  `extract(epoch from updated_at)::text`, computed and compared by Postgres,
  **never a JavaScript `Date`** — `now()` has microsecond resolution and a
  `Date` has milliseconds, so a `Date` comparison matches nothing on Neon while
  matching forever on PGlite. See `src/lib/data/revision.ts`. A unit, resource
  or photo edit touches the tool row in the same transaction, so the tool is the
  token for the whole panel; a *refused* child write rolls that touch back.
- **The tool editor is one panel offered from two places.**
  `ToolEditorPanel` opens as a side panel from a row of the review table and as
  a **full-screen sheet over a tool's own page** (§5.3(b)) — the phone-first
  case, because a SuperMaker marking a printer out of service is standing next
  to the machine. `EditToolControl` is what offers it there: it asks
  `/api/identity` *after mount*, like `AdminLink`, so the cached tool page stays
  cached for everyone who is not staff.
- **A conflict never costs anybody their typing.** The panel keeps the unsaved
  edits, says so inline (never a modal — §6), and **Reload** fetches the newer
  version and shows the other person's value beside every field they disagree
  on, with a control that takes it. The fields form is *rebased*, never
  synchronised: nothing copies fresh server values over a box somebody is
  typing in, so the panel remounts it with a new `key` after a save it knows
  landed. It also sends **only the fields that changed**, because a patch
  carrying every field would overwrite an edit the revision check cannot see.
  **A unit row follows both rules for itself**, and has to: the rows are keyed
  by unit id and never remount, so one opened ten minutes ago still holds what
  it opened with. Each field the person has not touched rebases onto the newer
  server value; each field they have is theirs; Save posts the second kind only.
- **A write that changed the tool's *state* re-reads it.** Publish, Unpublish,
  Archive, Restore and "Looks good" all commit through `run(…, { refresh: true
  })`, and that refresh takes the tool's state as well as its children — a panel
  still offering **Unpublish** under a "Saved" it just earned is the page
  asserting what the database no longer holds, and a second click writes a
  second audit event. The tool's *text* is left alone, because somebody may be
  halfway through typing it.
- **Hiding a resource hides it from visitors, not just from the assistant.**
  The editor's **Hide** flips `resources.published`, and `loadTools` filters on
  it exactly like `listResourcesForTool` does, so an internal SOP staff
  restricted leaves the public tool page. What it does not do is unpublish the
  file: a resource's PDF is a public blob at a random pathname and stays
  fetchable by anyone who already has the URL.
- **Every editor action is gated by `authorizeAdminAction`**
  (`src/lib/admin/action-gate.ts`): identity, then the limiter, then the one
  permission it needs — the sequence `/admin/users` established, now shared and
  parameterised. Editing is `tools.edit`; publish, unpublish, archive and
  restore are `tools.publish`. Both are `admin` today, so the split costs
  nothing and makes "SuperMakers may add tools but not publish them" a one-line
  change. `canPublish` hides those four controls; hiding is presentation.
- **Drafts are reachable at their slug only with `catalog.view_drafts`, and the
  refusal is a 404.** `getCatalogTool` is `"use cache"` and published-only and
  cannot see the caller, so a miss renders `DraftToolView` inside its own
  Suspense boundary — an async child that reads headers, checks the permission
  and calls `notFound()` for everyone else. Keeping that read inside the
  boundary is what leaves every *published* tool page prerenderable under
  `cacheComponents` (`npm run build` is the check); a different-looking refusal
  would confirm the draft exists.
- **With no Blob store (see "Blob locally") the panel says photos cannot be added and
  stays usable for everything else.** `POST /api/uploads` answers 503, the
  Photos and Resources sections show that sentence, and reordering, removal and
  every text field keep working — a deployment with no Blob store is still one
  where a wrong description is worth fixing (Article 4).
- **Two things cannot be undone, so they cannot be done.** An address in
  `AUTH_SUPER_ADMIN_EMAILS` cannot be demoted or removed (nor blocked), and the
  last `super_admin` cannot be demoted or removed; nobody removes themselves.
  The table disables those rows with the reason showing; the action derives
  them again before it writes.
- **Reads go straight to Postgres; a role change goes through the plugin,
  removal does not.** `src/lib/data/users.ts` selects the roster;
  `auth.api.setRole` changes a role. **Remove** (auth spec amendment
  2026-09-25, which retired Ban) is `removeUser` → `removeUserAccount`
  (`src/lib/data/user-removal.ts`): **one transaction** — name snapshots
  (`created_by_name` on `pending_tools`, `bulk_imports`, `chat_proposals`),
  sessions, personal tokens and OAuth grants deleted, `account` and `user`
  deleted, the optional block, and `user.removed` / `email.blocked` written
  *inside* it (so a lost event rolls the removal back — the opposite of a role
  change). History stays: `pending_tools.created_by` and `bulk_imports.created_by`
  stopped cascading in migration `0016`; tickets, corrections and projects keep
  their name/email snapshots and old id, and the queues say "<name> (removed)"
  (`accountRemoved()` in `data/account-removed.ts`, `components/admin/person-label.ts`).
  A removed owner's own Notion mirror cascades.
- **Blocked emails** (`blocked_emails`, `data/blocked-emails.ts`): written only
  by a removal with "Also block this email…", listed and **Unblock**ed on the
  People page (`email.unblocked`). `databaseHooks.user.create.before` refuses a
  blocked address before any row exists (`lib/auth/blocked-sign-in.ts`); the
  auth route rewrites Better Auth's `?error=email_blocked` redirect to
  `/auth/blocked`. The floor is never refused. The `banned` columns stay
  (the admin plugin selects them) and nothing writes them; migration `0016`
  turned every banned account into a block plus a removal.
- **Every security-relevant change is recorded.** `src/lib/data/audit.ts` is
  insert-and-select only — there is deliberately no update or delete export,
  and a test asserts the module's shape. Each event snapshots `actor_name` at
  insert (a subselect), so an actor removed later is still named. `AUDIT_ACTIONS`
  has no `user.unbanned`; old lifts are `user.banned` with `detail.banned: false`.
- **Server actions pass down as props.** `RoleSelect`, `RemoveUserControl` and
  `BlockedEmailsList` take the action rather than importing it, which keeps
  `next/headers`, the limiter and `server-only` out of a client component's
  graph and makes them testable with a `vi.fn`.
- **Submitting a project needs an account** (spec §5.5) — the one place in the
  app where sign-in is required. `POST /api/projects` answers 401
  `sign_in_required` to an anonymous caller, the byline comes from the session
  and the typed-name field is gone. Browsing, chatting and reporting a problem
  are all still anonymous.
- **The three queues are what the lab actually runs on** (§5.6).
  `/admin/maintenance` (`maintenance.manage`), `/admin/corrections`
  (`feedback.manage`) and `/admin/projects` (`projects.moderate`) are the
  surfaces that replace working tickets in Notion. Each is a card list rather
  than a table, because every row carries prose somebody typed; each puts the
  open work on the page and folds the settled work behind a disclosure, because
  the person using these has twenty tickets and ten minutes; and each one's
  control **saves on the click**, with `useRowAction` giving all of them the
  same contract (optimistic, a refusal restores, a warning keeps). The shared
  preamble is `src/lib/admin/queue-write.ts` — gate, write, record, refresh,
  each step only as far as the last one earned.
- **Each queue checks its own permission, and a test proves it is its own.** No
  role holds `tools.edit` without `feedback.manage`, so each `actions.test.ts`
  mocks `can()` for one case and asserts the endpoint is refused to a caller
  holding the *adjacent* permission. That is the only way to catch an action
  that gates on the wrong declaration.
- **Only the project one audits, and only it invalidates.** Publishing decides
  what the public gallery shows, so it writes `project.published` /
  `project.unpublished` and calls `invalidateProjects()` — and a lost audit
  event is still `{ ok: true, warning: "audit_unavailable" }`, never a failure.
  Maintenance and correction edits are ordinary edits, which §4.11 says are
  deliberately not logged, and nothing cached reads either table.
- **A correction is one click from the field it corrects.** The row links to
  the tool's own page — where the field is shown and where `EditToolControl`
  opens the editor — not to `/admin/inventory`, which would land the reviewer
  in a table they then have to search.
- **`published_at` / `published_by` describe the current publication, not the
  history**, so unpublishing clears both. The history is `audit_events`.
- **One read selects a reporter's email, on purpose.** `listMaintenanceQueue`
  and `listFeedbackQueue` carry `reported_by_email` / `reporter_email`, because
  the first thing an admin does with a confusing ticket is ask the person who
  filed it. `listMaintenanceHistoryForUnit` still does not select it at all —
  its rows reach a model prompt and the mirror (§8). Which function a caller
  picks is the whole of that decision, which is why they are two functions and
  not one with a flag.

## Adding equipment (`pending_tools`, Phase 6; the image stage is gateway spec §3.5)

Three steps with a person at the end (spec §5.4). **Identify** in the chat,
**research** in the background — which now includes finding a product image —
**approve** on `/admin/intake`, choosing the image there — research never
creates a tool (Article 5).

- **The chat identifies and nothing more.** `identify_tools`
  (`capabilities/intake.ts`, `tools.add`, chat-only) records each item as a
  `pending_tools` row in one batch, runs the duplicate check
  (`src/lib/data/duplicates.ts` — normalised name-plus-brand, then `pg_trgm`
  at 0.5; different model tokens are never a match, and a merely *similar* name
  is stored pre-resolved as "It's a different tool" so it never blocks research
  — data-platform spec amendment 2026-09-24) and emits one `data-intake-table` part. `research_tool` and
  `propose_listing` are gone; the intake prompt allows two web searches, only
  to settle a model name.
- **The table card talks to routes, never to the model.** `IntakeTableCard`
  edits, removes and resolves duplicates through `PATCH
  /api/pending-tools/[id]`, and **Research selected (N)** is `POST
  /api/pending-tools/research` with exactly the ticked ids. Every check in that
  route runs before any row moves; add-unit items skip research; a `start()`
  that throws leaves the items `queued` with the reason in `research_error`,
  and the same POST is the Retry.
- **Research is a Workflow SDK run** (`src/workflows/research-batch.ts`, steps
  in `src/lib/research/steps.ts`): three items at a time by chunked
  `Promise.allSettled`, two model steps per item (search with `exa_search`,
  then a read step that fetches its candidate pages itself with `readPage` and
  hands the model their text, rather than giving the model a fetch tool),
  each with its own 240-second deadline and `maxRetries = 2` set as a property.
  The prompt, output parsing, error classification and assembly are
  `src/lib/research/*`. **Confidence is computed in code** (`scoreConfidence`),
  and the model's reported evidence is only ever lowered to match what
  verification found — so "research found nothing" grades low, never medium.
  Step code runs under plain Node: relative imports, no `"server-only"`
  anywhere below it, and `vi.mock` does not reach it under `@workflow/vitest`
  (models are stubbed at the Gateway's HTTP boundary with `test/gateway/*`
  instead). The research route imports `researchBatch`, which is what makes
  `next build` compile the workflow at all.
- **A third workflow step finds a product image** (gateway spec §3.5,
  `src/lib/research/image-steps.ts`'s `findImages`), after the read step
  succeeds: candidates from the read pages' `og:image`/`twitter:image`/JSON-LD
  and from Exa's own image links, probed for real dimensions and format
  (`src/lib/images/inspect.ts`, no deps), ranked by a model shown up to
  `IMAGE_MAX_RANKED` of them — which must give each a `subject` verdict; only
  the product itself is kept (never an accessory, consumable, part, packaging
  or another model), the manufacturer's pictures lead their view tier, and
  when none passes there is no image (`images.allRejected`; amendment "The
  product itself, or no image") — and — for the top candidate only — cleaned
  (background removed). **Never a generative redraw** (spec amendment "No
  generative redraw: deterministic cutout"): each probed candidate's
  background is classified from its border pixels (`images/background.ts`:
  `transparent` / `plain` / `busy`, recorded on the candidate); ranking is
  told the class and a clean background wins a close call (`images/rank.ts`,
  `BUSY_PENALTY`). Candidates include the pages' gallery `<img>`s, and size
  variants count once (`web/image-url.ts`); ranking also flags **composites**
  (banners, price overlays, collages — ranked below every plain photo, tagged
  "Banner") and boxes the product, and a rank 1 that is a composite, busy or
  small in its frame is **cropped** to that box, then cut when the crop's
  backdrop is plain (`images/crop.ts`, `images/clean-copy.ts`;
  `cleaned.kind` `cropped_and_cut` / `cropped` — amendment "Composites and
  product crop"). Otherwise a `plain` rank 1 is cut out by a flood fill from the frame
  that keeps the original's pixels (`images/clean.ts` — validated, feathered,
  trimmed; a rejected cut records `images.cleanNote`); a `transparent` rank 1
  *is* the clean version and gets no copy; a `busy` one gets none either
  (`cleanNote: "busy_background"`). `sharp` does the decoding, loaded through
  `images/downscale.ts`'s guarded `loadSharp` (Next's own dependency; without
  it nothing is classified or cut). **Cleaning needs a Blob store**; with none
  configured the stage skips it and offers the research candidates alone (the
  intake E2E runs on a server with a local store, so it cuts the stub's
  plain-backdrop product out, picks the cleaned copy and sees it in the
  gallery — see `e2e/intake.spec.ts`). The result is `images` on
  the stored `ResearchResult` (`src/lib/research/result.ts`): up to three
  ranked candidates plus the cleaned copy's private attachment id, or
  `imageError` when the stage failed — never a reason to fail research itself.
- **Nothing is stored until approval.** The preliminary page's "Product image"
  control (spec §3.5, the *ProductImage* group) offers the cleaned copy (when
  there is one), each ranked candidate with a "From `<host>`" attribution, and
  "No image" — a choice, not a default. `GET
  /api/pending-tools/[id]/cleaned-image` streams the private cleaned PNG to a
  reviewer holding `tools.approve`, rate-limited; nothing else can read it.
- **Product page first, front-facing covers, reviewer corrections** (gateway
  spec amendment "Product-page first, front-facing images, reviewer notes").
  `research/source-pages.ts` classifies a URL from its address (the brand's
  product page, a manual/wiki/support page, a video). The read step always
  reads a found product page, videos go last, and a video never satisfies
  `manufacturerPageFound` / `specsFromSource`. Ranking also reports each image's
  `view`, and back views, details and parts sort last. **Research again** opens an
  inline "Anything to focus on?" panel (`ResearchAgainDialog`, amendment "Guided
  redo"): focus chips (everything, or some of description / specs / links /
  image), quick suggestions, and an optional one-paragraph note (≤1000,
  `tools.approve`, fenced in both prompts, recorded as `research.reviewerNote`).
  A scoped redo sends `focus`; `completeResearch` then **merges** only those
  fields into the stored result (`research/focus-merge.ts` — evidence and
  confidence move only when specs or links did), an image-only focus is **Find a
  different image**, and the page marks what changed "Updated just now". **Find a different image**
  (`requestDifferentImage` → `src/workflows/image-retry.ts` →
  `research/image-retry-steps.ts`) reruns only the image stage, with its own note
  and at most one Exa search. It costs one against the daily allowance, keeps its
  state in `research.imageRetry` (no migration) and replaces `research.images`,
  releasing the old cleaned copy. **A step module exports only steps**: the
  shared probe/rank/clean middle is `research/image-stage.ts`, imported directly,
  because a workflow bundle keeps every export of a step module (a re-export once
  pulled `guardedFetch` into it and broke `next dev`).
- **A page our server cannot open is read from the search's copy** (gateway
  spec amendment "Search text fallback and confidence cap"). Research's Exa
  search returns page text (12k chars per result); `searchItem` carries the
  texts of candidate pages (`research/search-text.ts`), and the read step uses
  one when `readPage` failed (403 bot challenge, 429, timeout), was too large or
  had no text — never for a `blocked` (SSRF-guard) result. It is fenced and
  labelled "text captured by search", recorded as `research.searchTextSources`,
  and counts for `manufacturerPageFound` / `specsFromSource` only when it is the
  brand's product page. **Confidence is capped at medium** when every page read
  was a video, or none was (`readCap` in `capabilities/confidence.ts`), and the
  strip says why.
- **Approval is one transaction** (`approvePendingTool` / `approvePendingAsUnit`
  in `src/lib/data/pending-tools.ts`), composed with the audit trail and
  `invalidateCatalog()` by `src/lib/intake/approve.ts`. Approving published
  records `pending.approved` **and** `tool.published`; a lost audit event is a
  warning on a success, as everywhere else. **The image choice is resolved
  here too:** "cleaned" promotes the already-stored private attachment to
  public; "original" downloads the candidate's own URL, **cleans it** with
  the same deterministic crop and cutout rank 1 gets
  (`research/images/pick-clean.ts`, from the candidate's recorded
  `background` / `composite` / `productBox`, classified on the spot when
  absent; the downloaded bytes when no cut is possible), and stores it —
  except rank 1's original chosen beside its cleaned copy, stored uncut
  (amendment "The picked image is cleaned too"; refresh's accepted cover
  goes through the same `storeResearchImage`). Both are
  `attachments.origin` `research_image` / `research_image_cleaned` — see
  C11 in the gateway spec; a download or store failure is never a reason to
  fail the rest of the approval — it is the `image_not_attached` warning
  (`admin.warnings.image_not_attached`), the same "warning on a landed write"
  shape every admin surface uses. Low confidence keeps both Approve buttons off
  until "I've checked this" is ticked and a note written. **Training is the
  lab's call** (amendment 2026-09-24, `src/lib/intake/training.ts`): research
  leaves a pending item's `trainingRequired` null, the page starts at "Staff to
  confirm (saved as required)" beside any verified training quote, and approval
  stores `true` unless the reviewer chose "No training needed".
- **Starter questions** (gateway spec amendment "Tool-specific starter
  questions"). The read step's JSON also carries `starterQuestions`: three
  short questions (≤80 chars) a student might ask the assistant about the
  tool, in the same call, so no extra cost. `src/lib/starter-questions.ts` is
  the one rule — `cleanStarterQuestions` reads a model's answer leniently
  (trimmed, one line, ends in "?", once each, three at most, an over-long one
  dropped, never refused); `starterQuestionsFromEditor` refuses staff input
  over three or over 80 (`invalid_field`) rather than cutting it. They are
  optional on `ResearchResult` (old rows parse), a **Description** redo
  regenerates them (`focus-merge.ts`; a run with none keeps the stored ones),
  approval copies them onto `tools.starter_questions` (migration `0009`,
  `text[] not null default '{}'`), the tool editor edits them (three boxes,
  saved through `updateTool` with the revision check), and the catalogue
  carries them as `MakerLabTool.starterQuestions`. The tool page renders
  `ToolChatStarters`, which registers them with `ChatLauncherContext`;
  `ChatFab` shows them as its chips while the path still names that tool (slug
  or id), and the generic, translated chips everywhere else and for a tool
  with none. The questions are data, English as written. Not carried by the
  Notion mirror (a new property would put existing mirrors in
  `schema_mismatch`) or MCP. **Backfill:** `scripts/generate-starter-questions.ts`
  (`--dry-run`, `--limit N`, `--ids a,b`) asks the `researchRead` model for
  tools whose list is empty, from name, description and resource titles only,
  and writes through `updateTool`; see `docs/deploy.md` Stage 2c.
- **The daily cron expires what nobody researched.** `identified` rows older
  than 14 days are discarded and their photos released (`runPendingExpiry`),
  just before the orphan sweep deletes them from Blob.

## Refresh research (`tool_refreshes`, `chat_proposals`; refresh research spec, migration `0012`)

Existing tools researched again, **blind**, with every change a proposal a person accepts
(Article 5). See the spec's 2026-09-23 amendment for the as-built detail.

- **The engine** is `research/engine.ts` (`runSearch`, `runRead`) — intake's steps and
  refresh's steps (`src/lib/refresh/steps.ts`, run by `src/workflows/refresh-batch.ts`)
  both call it. Refresh tells it only the tool's name and category name
  (`refresh/blind-input.ts`); the tool's own processed manual is given as its outline plus
  the passages for fixed spec-like queries (`refresh/manual-context.ts`, 16k budget). The
  read step asks every run for verbatim `citations` and an `emergencyStop`; code checks each
  quote against the page it names (`refresh/citations.ts`).
- **The diff is code** (`refresh/propose.ts`): kinds *differs* / *new* / *unverified*,
  safety fields first, list additions only, links the tool lacks, a cover only when it has
  none (ranked, never stored until accepted), a `floor_check` for a tool research could not
  identify. **Never PPE.** **Research never replaces a lab rule** (`refresh/lab-rules.ts`,
  amendment 2026-09-24): on a catalogue tool, restrictions only gain lines beside the lab's,
  training is never proposed off — in the diff, in `propose_change` (chat and MCP), in the
  conflict re-base and as `refusalFor`'s `replaces_lab_rule`. A pending item's values are
  drafts and may be replaced.
- **Queue**: `/admin/inventory` checkboxes → **Refresh research (N)** → `queueToolRefresh`
  (`tools.edit`, ≤ 25, the same daily ledger and lock as intake). **Review**:
  `/admin/refresh` and `/admin/refresh/[id]`. **Accept** writes through the editor's save
  path at `base_revision` (`refresh/apply.ts`, `refresh/decisions.ts`); a conflict writes
  nothing and re-bases the cards. A published rename needs `tools.publish`.
- **Research with the assistant** (§12): `capabilities/curation.ts` (`get_record`,
  `propose_change`) is composed by the chat route only for a caller who may curate the
  page's record (`lib/chat/curation.ts`); quotes are checked against what the turn read
  (`lib/chat/turn-sources.ts`); cards are `data-proposal` parts (`ChatProposalCards`), decided
  through `POST /api/chat-proposals` (`refresh/chat-decisions.ts`) — never a model tool.
- **Tests**: `refresh-batch.workflow.test.ts` stubs the Gateway's wire; the pure parts
  (`propose`, `citations`, `decide`, `blind-input`) have fixture tests shaped like the Aug 29
  reconciliation; `fixtures.test-helpers.ts` holds the shared fixtures.

## Bulk intake (`bulk_imports`, `research_allowances`; bulk intake spec, migration `0013`)

Importing a list — a CSV/TSV file, pasted cells, a plain list, a document or a PDF — as
**identified** pending items, reviewed before a cent is spent. Nothing an import makes is
researched or published on its own (Article 5). See the spec's 2026-09-24 amendment.

- **Parsing is code** (`src/lib/import/`, client-safe and plain Node): `table.ts` (RFC 4180,
  BOM, delimiter sniffing — tab first), `columns.ts` (header synonyms, the column map),
  `items.ts` (validation: names, http(s) links, lab documents by host, quantity 1–50,
  serials, `consumable?`), `line-list.ts` (plain lists), `detect.ts` (table / list /
  document). Only prose and PDF text reach a model: job **`importParse`**, no tools, the text
  fenced (`extract.ts`), run by `src/workflows/import-document.ts`. **Caps refuse, never
  cut** (amendment 2026-09-24): a document over 200,000 characters is `document_too_long`
  before any model call, worded in pages (≈ 3,300 chars a page, limit ≈ 60); over 1,000
  items is `too_many_items` with the count — a document that names that many fails as
  `too_many_items:<n>`, nothing written.
- **`src/lib/import/service.ts`** (`startImport`, `confirmImportMapping`) is the one path for
  `POST /api/imports`, the mapping step and the chat's `start_import`. Rows are made only by
  `addImportItems` (`data/bulk-imports.ts`): one transaction, the import locked, each row
  duplicate-checked against inventory, waiting items and the import's earlier rows.
- **The review page** `/admin/intake/imports/[id]` (`ImportReview`, `ImportTable`,
  `ImportMapping`; server actions in `app/admin/intake/imports/actions.ts`, each checking
  `tools.add` and ownership). **Research selected** goes to the existing research route 25 at
  a time from the browser (`import/research-queue.ts`) — a partial chunk at the allowance's
  edge, the rest said to wait. **Suggest names** is job **`nameSuggest`** (one call with Exa,
  name/brand/category only), workflow `suggest-names.ts`, charged a quarter item each.
- **Units and lab documents at approval**: `max(quantity, serials)` units of one tool
  (`import/resources.ts`); lab documents become `resources.origin = 'lab_document'` — never
  archived, never in the chat's manual list, never a `read_page` host, badged *Lab document*
  on the tool page. The list's own links are offered on the preliminary page.
- **Setup allowances**: `researchLimitFor` (`data/research-allowances.ts`) = 100 + running
  grants, used by research, refresh and Find a different image; granted on `/admin/users`
  (`users.manage`), audited `allowance.granted`.
- **Uploads**: kind `import` on `POST /api/uploads` (private, `tools.add`). The chat's
  paperclip takes list files and names them to the model as `[Attached documents: …]`.

## Tool names: display and official (`tools.official_name`; tool display names spec, migration `0015`)

A tool has two names (`docs/specs/2026-09-24-tool-display-names-design.md`).
**`tools.name` is the display name** — short, what people say ("Makita Plunge Base",
"Formlabs Form 4"), no part numbers, ≤ 40 — and every surface that already read `name`
(gallery, tool page title, breadcrumbs, admin tables, chat, QR and unit labels, the mirror's
title, the slug) keeps reading it. **`tools.official_name`** (nullable) is the full product
name with model or part number, shown under the tool page's title when it differs
(`officialNameShown`), searched beside the name, given to research (`blindInput` →
`lookupName`) and returned over MCP as `official_name`.

- **One rule module**, `src/lib/tool-names.ts` (pure, no imports): `displayNameProblems`,
  `isValidDisplayName`, `cleanDisplayName` (the guard — removes part numbers, bracketed
  noise and spec runs, cuts at a word boundary to 40, never adds a word; keeps `Form 4`,
  `X2D`, `MK4S`, `Speedy 400`), `displayNameFrom`, `officialNameShown`, `lookupName`.
- **Research** asks for `officialName` and `displayName`; the official name is still stored
  as `ResearchResult.canonicalName` (key kept so old rows parse), the display name as
  optional `displayName`, always through the guard (`assemble.ts`). Old rows derive it
  (`researchDisplayName`).
- **Writes refuse, never cut**: `updateTool` and `approvePendingTool` answer
  `invalid_field` for a display name over 40; the editor says so before saving.
- **Refresh** proposes `official_name` (a proposal field) with a verified quote, and `name`
  only when the current display name breaks the rules — a lab's rule-following name is
  kept, like a lab rule. Chat/MCP `propose_change` refuse a `name` that breaks the rules.
- **Backfill**: `npm run names:backfill -- [--dry-run] [--ids] [--limit]`
  (`scripts/backfill-display-names.ts`, job `displayName`, flex): shortens names that
  break the rules and moves the long form to `official_name` only when that is empty.
  The model sees name, category, description and same-brand names; all answers are
  resolved together (`resolveDisplayNames`) before any write.
- **Says what it is, and unique** (amendment 2026-09-25). A display name that is only a
  brand ("Hakko", "Aoyue Int") is refused wherever a model answer is guarded
  (`isBareBrand`, `src/lib/tool-name-brand.ts`); the fallback is brand + category noun
  ("Hakko Soldering Station"), else the old name. Four bare digits are a model line
  ("Dremel 3000"). **Display names are unique across tools** (`normalizeName`, archived and
  drafts included; no index): `updateTool`, `approvePendingTool` and MCP `create_tool`
  refuse `duplicate_name` (`src/lib/data/tool-name-clash.ts`); the editor and intake page
  warn first. A collision keeps the distinguishing spec ("Ryobi ONE+ 4Ah Battery") —
  a spec is allowed only when needed (`specNeeded`; `src/lib/tool-name-choice.ts`).
  The display-name instructions are **one text**, `DISPLAY_NAME_RULES`
  (`src/lib/display-name-rules.ts`), shared by the backfill, research's read prompt and
  Suggest names.

## Tool descriptions: short (gateway spec amendment 2026-09-26 "Short descriptions")

- **The rule** (the owner's): say what the tool is and what students use it for, touching on a
  spec or two; **1–3 sentences, at most 5** for a complicated machine, about 450 characters
  (code's limit is `DESCRIPTION_LIMIT_CHARS`, 500), plain prose, **no Markdown list**. One
  module, `src/lib/description-rules.ts` (pure): `DESCRIPTION_RULES` (the text research's
  read prompt and the shorten script share), `descriptionProblems`, `newNumbers`.
- **Research** still gathers the full `specs` list (evidence, confidence), but approval no
  longer folds it into the description (`proposedDescription` is the description alone).
- **Shorten what is stored**: `npm run descriptions:shorten -- [--dry-run] [--ids] [--limit]`
  (`scripts/shorten-descriptions.ts`, job `descriptionShorten`, flex): rewrites descriptions
  that break the rule from **only the facts already in them**; a rewrite that still breaks
  the rule, is not shorter or adds a number is rejected; writes carry the revision read at
  selection (an edit meanwhile is skipped). Same target/lock handling as `names:backfill`.

## MCP access (`api_tokens`, `oauth_*`; MCP access spec, migration `0014`)

MCP callers act as a person, with that person's role and never more
(`docs/specs/2026-09-23-mcp-access-design.md`, amendment 2026-09-24; user guide `docs/mcp.md`).

- **Who is calling** is `resolveMcpCaller` (`src/lib/auth/mcp-caller.ts`), used by the MCP route
  only: `Bearer mlt_…` (a personal access token, looked up by SHA-256 hash), the deprecated
  `MCP_TOKEN` (anonymous, read-only, warns once), any other bearer as a Better Auth `mcp`-plugin
  OAuth access token, or no header → anonymous. A bearer that does not resolve is a 401 naming the
  reason — never anonymous. Ban, floor and domain rules are `evaluateUser`, shared with sessions.
  **`resolveIdentity` (every other route) still reads only the cookie** — a token never works on
  `/api/chat`, uploads or research.
- **What is listed** is `mcpToolAllowed`: capability and tool `requiredPermission` via `can()`;
  every write (and `requiresSignIn`) needs a signed-in caller; a read-only token or grant gets no
  writes. The server is built per request. Anonymous gets the six public reads; maintenance
  history carries reporter names only for `maintenance.manage`.
- **MCP-only tools**: `list_my_reports` (`capabilities/reports.ts`), and `propose_change` in
  `capabilities/staff.ts` (a `chat_proposals` row with `chat_id = "mcp"`, shown on
  `/admin/refresh` under "Proposals from assistants"). Nothing over MCP publishes or edits the
  catalogue (Article 5).
- **Staff queue tools, chat and MCP** (amendment 2026-09-25): `list_intake_queue`
  (`tools.approve`), `list_open_tickets` and `update_ticket` (`maintenance.manage`, through
  `lib/admin/ticket-write.ts`, the admin page's own path) in `capabilities/staff.ts`. The chat
  offers them only through `capabilitiesForIdentity` (never to anonymous or students), and
  `staffPromptFragment` tells staff the rule: state the exact change and wait for a yes before
  `update_ticket`. Reporter names, never emails.
- **Rate limits**: `mcp` 30/min per IP, `mcpSignedIn` 60/min per token or person, `mcpWrite`
  10/min per identity before each write call.
- **Sign in with Google is the default way to connect** (amendment 2026-09-24): the page and
  `docs/mcp.md` give every OAuth-capable client (Claude Code, Codex, Claude Desktop, claude.ai,
  ChatGPT) `/api/mcp/signed-in` first (`SignInSetup`, `mcpSnippets().claudeCodeSignIn` /
  `codexSignIn` / `codexLogin`); tokens are the fallback for clients or scripts that can't.
- **The public `/mcp` page** (amendment 2026-09-25): the two addresses for the request's origin
  (`lib/request-origin.ts`), every MCP tool grouped Anyone / Signed-in / Staff with the viewer's
  own marked — generated by `describeMcpTools` (`capabilities/mcp-catalog.ts`) from the registry
  through `mcpToolAllowed`, never a hand list — **Try it** for the anonymous reads
  (`tryItToolNames`), and `SignInSetup` (moved here from `/account/tokens`). Try it is the server
  action `runMcpTryIt` → `lib/mcp/try-it.ts`, which builds a `tools/call` `Request` with no cookie
  and no `Authorization` and hands it to `handleMcpRequest`: always anonymous, under the `mcp`
  per-IP limit, and a write or staff tool is `not_runnable` before any call.
- **Tokens** (`/account/tokens`, profile menu → Connect an AI assistant): shown once, stored as a
  hash, prefix for display, **90 days for every token, no choice** (`TOKEN_LIFETIME_DAYS`,
  `lib/account/token-lifetime.ts`; a posted `expiry` is ignored — amendment 2026-09-25 "One
  lifetime"), read-only option, ≤ 20 live, audited `token.created` / `token.revoked`. The
  reveal says "Save this token now…" above the token and beside **I've copied it**, and both it
  and `/mcp` offer **Copy setup prompt for your AI** (`AiSetupPrompt`), which names
  `MAKERLAB_MCP_TOKEN` and never contains a token. **Never log a token** — only `displayPrefix`.
- **OAuth** (the `mcp` plugin in `auth/config.ts`): clients use `/api/mcp/signed-in`, whose
  anonymous 401 points at `/.well-known/oauth-protected-resource/…`; the auth route forces
  `prompt=consent` on `/api/auth/mcp/authorize`; `/oauth/sign-in` and `/oauth/consent` (read-only
  there adds the `read_only` scope). Grants are listed and revoked as Connected apps. Backups skip
  `oauth_access_token`.

## The Notion mirror (`notion_mirrors`, Phase 8)

A one-way copy of the inventory into an admin's own Notion workspace (spec
§3.8, §5.8). Postgres stays the source of truth; nothing is ever read back.

- **One mirror per admin, found from the session.** `/admin/mirror`
  (`mirror.manage`) shows only the caller's own row; no server action in
  `src/app/admin/mirror/actions.ts` takes a mirror id. The four setup actions
  (test, connect, create databases, save mapping) also pass
  `MIRROR_SETUP_TIER` (10/min). Connect and disconnect audit
  `mirror.connected` / `mirror.disconnected`.
- **The token is validated by one read, then stored encrypted.** AES-256-GCM
  under a key HKDF-derived from `AUTH_SECRET` with a fixed info string
  (`src/lib/mirror/token-crypto.ts`). Rotating `AUTH_SECRET` makes every stored
  token unreadable; the page then asks for it again. The nightly backup blanks
  the ciphertext. **Never log a token, `AUTH_SECRET` or an email** — error
  text goes through `scrubSecrets`, and `last_error.detail` is generic English
  built in code, never Notion's message.
- **Seven databases, fixed schemas** (`database-schemas.ts`), in dependency
  order: categories, locations, tools, units, resources, maintenance,
  projects. **Create databases** makes the missing ones under the shared page;
  pasted ids are validated against the schema before anything is saved.
- **The push** (`push.ts`, run by `mirrorPush` in
  `src/workflows/mirror-push.ts`): an overlap guard (`running_since`, 15 min),
  rows newer than `last_synced_at` or than their `mirror_pages.source_updated_at`,
  upsert by `mirror_pages`, archive pages of archived tools, unpublished
  projects and deleted rows. 3 requests/s, 429 honoured via `Retry-After`,
  45-second budget per push (then up to six rounds, 5 s apart). The budget
  stops new requests only; one already started runs to Notion's answer or a
  30 s ceiling, never cut short (an aborted create would duplicate a page).
  Only a clean, complete push advances `last_synced_at`; a 401 pauses the
  mirror. A round skipped because another push holds the mirror waits 30 s
  and tries again (up to ten times).
- **Mapping changes and running pushes.** `setMirrorMapping` (when the
  mapping changes) and `resetMirrorEntities` bump `mapping_generation`; a push
  records pages and advances `last_synced_at` only while the mirror is still
  at the generation it claimed, and otherwise stops as `incomplete` for
  another round. `resetMirrorEntities` also marks the pages of every entity
  with a relation into the reset ones (`relationDependents`) as not mirrored,
  so their links are rewritten to the new pages.
- **Only a current admin's mirror pushes.** Every claim except Sync now (whose
  server action already checked `mirror.manage`) requires the owner's `user`
  row to hold a role in `MIRROR_OWNER_ROLES` and not be banned; demoting or
  banning an admin stops their mirror. Sync now is refused (`sync_running`)
  while another push holds the mirror, without spending the 15 minutes.
- **What it carries.** Every tool (with a Published checkbox), units,
  resources, categories, locations, maintenance logs and published projects;
  public attachments as external files, never private ones. **Reporter,
  assignee and author names and emails are carried** (open question 4,
  answered 2026-09-23) — the mirror's workspace holds personal data. Emails
  still never enter a model prompt or a log line.
- **Three triggers.** (1) `requestMirrorPush()` (`src/lib/mirror/trigger.ts`)
  after a committed write — approving a tool, every tool-editor write
  (`tool-write-context.ts`), publishing a project, working a maintenance
  ticket. It never throws, costs one query when nobody has a mirror, and
  starts `mirrorPushAfterChange`, which sleeps two minutes so a burst
  coalesces. (2) **Sync now**, once per mirror per 15 minutes. (3) The daily
  cron's `mirror` stage (`src/lib/cron/mirror-backstop.ts`), for any mirror
  whose data is newer than its last sync.
- **Notion is called with raw `fetch`** (`notion-client.ts`, API version
  `2022-06-28`) — no SDK. `NOTION_API_BASE_URL` overrides the base URL for the
  E2E stub only; production never sets it.

## Archived manuals (link rot)

A manufacturer moves a PDF and the tool loses its manual. So each manual link
is copied into Blob once, and the tool page and the chat prefer the copy.

- **No table of its own.** The copy is an `attachments` row owned by the
  resource — public, `application/pdf`, `source_key =
  manual:<resource id>:<source url>` (`src/lib/data/manual-archives.ts`). The
  resource keeps its own `url`, the manufacturer's link. A copy whose key does
  not match the resource's current `url` is stale: hidden everywhere, and
  released to the orphan sweep when the new link is archived.
- **`archiveManual(resourceId)`** (`src/lib/manuals/archive.ts`) archives a
  Manual, or any resource whose link answers a PDF. The body must *be* a PDF
  (`%PDF-`, or `application/pdf` that is not markup) — an HTML product page is
  refused. 30 s, 25 MB. Skips a resource that already holds a PDF (uploaded,
  imported, or this link's copy), and skips as `blob_not_configured` without a
  token. It returns `archived | skipped | failed` with a reason and never
  throws for an expected failure; it logs the link's host only, never the path
  or query. Step code: it writes Blob through `import/blob-uploader.ts`, not
  the `server-only` `lib/blob.ts`.
- **Runs in a workflow**, `archiveManuals(resourceIds)`
  (`src/workflows/archive-manuals.ts`), one step per resource, `maxRetries = 2`,
  retrying only a transient failure (network, 5xx/429, a Blob write, the
  database). Started by `requestManualArchive()` (`src/lib/manuals/trigger.ts`)
  after approving a tool, after MCP `create_tool`, and after the editor adds a
  resource or changes its link or type. It never throws and never fails the
  write that called it.
- **The daily cron's `manuals` stage** (`src/lib/cron/manual-archive.ts`) hands
  up to ten due Manuals to one run each night — the backfill for imported
  manuals and the backstop for a start that never happened. The window moves
  each night and wraps, so a manual that always fails cannot stall it.
- **Readers.** `resourceLinks` gives an archived manual **one** link, to the
  copy, with the manufacturer's URL as `sourceHref` (the tool page shows only
  `href`). `listResourcesForTool` sets it apart as `archivedUrl` and leaves it
  out of `fileUrls`; the chat attaches `archivedUrl` first, so one manual is
  attached once, and "(attached)" matches the copy or the source.

## Manual text and search (`manual_documents`, `manual_pages`, `manual_chunks`; manual text spec phases 1–2)

Every stored manual PDF is also kept as **text, page by page, with its
outline** (`docs/specs/2026-09-23-manual-text-and-search-design.md`, migration
`0010`), and — phase 2, migration `0011` — as **search passages** the chat's
`search_manual` answers from with page citations. Whole-PDF attachment is only
the fallback for a manual that is `no_text`, `failed` or not processed yet.

- **Extraction** is `src/lib/manuals/extract.ts` (`extractManual`, **unpdf** —
  pdf.js without a worker, `isEvalSupported: false`): lines rebuilt, end-of-line
  hyphenation joined, running headers/footers and bare page numbers dropped,
  bookmarks resolved to pages (identifier-like bookmarks such as `_tyjcwt`
  ignored), headings inferred from font size without them, printed page labels
  kept. `ready` / `no_text` (under 100 chars a page) / `failed` (`encrypted`,
  `corrupt`, `too_large`: 25 MB, 1,000 pages, 60 s — the deadline is checked
  between pages because pdf.js never yields to a timer). Bump
  `EXTRACTOR_VERSION` when what is stored changes; older documents re-process.
- **One document per stored PDF** (`attachment_id` unique, cascade). A resource's
  *current* PDFs are its archive of the link it carries now, or any file staff
  uploaded (`data/manual-documents.ts`); a stale archive copy is never
  processed or shown.
- **Processing runs in the archive workflow**: `archiveManuals` calls
  `indexManualStep` after each archive that did not fail
  (`manuals/index-document.ts`), which reads the bytes back from Blob
  (`manuals/stored-bytes.ts` — `.blob-data/` locally, `@vercel/blob` `get`
  otherwise, private files too), extracts and writes document + pages in one
  transaction. Idempotent on attachment + version; only a transient Blob read
  or an unreachable database is retried; `no_text` and `failed` are stored
  answers. It never changes the archive's counts. Adding a resource **with an
  uploaded PDF** now starts the same run.
- **Backfill:** `npm run manuals:index -- [--dry-run] [--ids …] [--limit N]
  [--force]` (`scripts/index-manuals.ts`), same target order as the import;
  stop the dev server for a local database. No Gateway calls in phase 1.
- **Readers.** The editor's resource row shows `ManualStateTag` (Text stored ·
  N pages / No text (scanned) / Failed: reason / Processing); the tool page
  shows a collapsed **Contents** under a public manual's link
  (`ManualContentsList`, `getManualContents`, cached with the catalogue), each
  entry opening `<pdf>#page=N`. Research's read step looks a manual URL up in
  the stored text first (`findStoredManualByUrl`), else extracts a downloaded
  PDF in memory (`readPage` with `maxPdfBytes` 25 MB), and gives the model
  `manualDigest` — the outline plus the spec-richest pages, labelled with page
  numbers, within `RESEARCH_MANUAL_TEXT_MAX_CHARS`; Exa's copy is the fallback.
  A manual PDF Exa returned but the search did not list is added to the reads
  (`research/manual-pdfs.ts`).
- **pgvector.** Migration `0011` creates the `vector` extension and
  `manual_chunks` (a generated English `tsvector` + GIN, `vector(512)` + HNSW
  cosine, `tool_id`). PGlite loads the extension from
  `@electric-sql/pglite-pgvector` (`PGLITE_EXTENSIONS` in `db/pglite.ts`, kept
  in `serverExternalPackages` like PGlite itself); Neon ships it.
- **Passages** (`manuals/chunk.ts`, `CHUNKER_VERSION`): cut along the outline,
  never across a section; a numbered heading the outline lacks ("2.2 Technical
  specifications") becomes a subsection; ~2,400 characters with ~320 of
  overlap, split at paragraphs, then sentences, then words; each records its
  pages and section path. The indexed `search_text` is the contextual header
  `"<tool> — <document> › <section path>"` plus the passage; `content` is the
  passage alone.
- **Embeddings** are job **`embed`** (`openai/text-embedding-3-small`,
  `MODEL_EMBED`), an *embedding* job — `embeddingModelFor`, not
  `languageModelFor` — asked for `EMBEDDING_DIMENSIONS` (512) through the
  Gateway's provider options (`embeddingProviderOptions`: OpenAI `dimensions`,
  Voyage `outputDimension`); a vector of another length is refused before it
  reaches the column. ≤ 96 inputs a call (`manuals/embed.ts`), cost from
  `providerMetadata.gateway`. The document records `embedding_model`
  (`openai/text-embedding-3-small@512`) and `chunker_version`; either one
  differing makes it stale.
- **The passages step** (`manuals/passages.ts`) runs inside `indexPdf` after
  the text is stored — and for text stored earlier, on the next run — embeds
  outside any transaction, then replaces the passages and records both
  versions in one. Failures are values: rate limits, 5xx, timeouts and no
  answer are `transient` and `indexManualStep` retries them; auth, an unknown
  model or a wrong dimension are not. The stored text survives any of them.
- **Search** (`manuals/search.ts`, `searchManuals`): the lexemes of
  `websearch_to_tsquery('english', q)`, each weighted by its idf among the
  passages searched (so the tool name every header carries weighs nothing),
  plus an exact match on part-number-like tokens, plus vector top 30; fused by
  RRF (k = 60), top 8, adjacent passages of a section merged. **Access is in
  the SQL**: `can(viewer, "tools.edit")` searches private files, hidden
  resources and draft tools too; everyone else only public files on published
  resources of published tools; archived tools and stale archive copies never.
  A query that cannot be embedded degrades to full text (`vectorFailed`).
- **Chat** (`capabilities/manuals.ts`): `search_manual({ query, tool? })`,
  preset to the focused tool, open to everyone, on MCP too (public manuals
  only, since MCP carries no identity). Each passage comes back fenced
  (`<untrusted-page>`) with its `citation` ("Form 4 Manual, p. 42") and a
  `url` ending `#page=N`. On a tool page the route loads the searchable
  manuals (`chat/tool-manuals.ts`) — their outlines go into the prompt (levels
  1–2, ≤ 8,000 characters), and their resources are **never attached**;
  `MAX_PDFS_PER_CHAT` counts only the fallbacks. Vector search always has a
  nearest passage, so "the manual doesn't cover it" is the model's judgement
  from the passages (the prompt requires it; `says_not_covered` evals it) —
  `no_results` only means no searchable manual in scope.
- **Backfill** adds a second pass: after the text, every ready document whose
  passages are missing or stale is chunked and embedded, with tokens and the
  Gateway-reported cost printed (`--text-only` skips it; `--dry-run` chunks and
  counts without embedding).
- **Admin.** The editor's tag says **Searchable · N pages** once passages
  exist; **Re-process** on a resource row with a PDF marks its documents stale
  (`markResourceManualsStale` — nothing deleted) and starts the archive
  workflow (`reprocessManual`, `tools.edit`, revision untouched).
  `/admin/research` (`tools.edit`) counts current PDFs by state
  (`countManualsByState`).
- **Tests** seed documents straight into PGlite (`test/manuals/seed.ts`) and
  embed with `test/ai/fake-embeddings.ts` (hashed bag of words, or pinned
  one-hot vectors); `models-stub.ts` has `setEmbeddingModel`, and the workflow
  tier stubs the Gateway's `/embedding-model` endpoint (`gatewayHandlers({
  embedding })`). The live retrieval eval is a `.livecheck` script (results in
  the spec's phase-2 amendment).

## Key files

| Path | Purpose |
|---|---|
| `src/lib/site-config.ts` | White-label branding (env-driven, all have defaults) |
| `src/lib/db/client.ts` | `getDb()`, `dataSubstrate()`, `pingDb()` — the one entry point to Postgres/PGlite |
| `src/lib/notion.ts` | Notion API client — used by the one-time import and its scripts (and the retired `/api/admin/backup`, awaiting deletion); no request path reads or writes Notion through it (the mirror has its own client) |
| `src/lib/data/attachments.ts` | `attachments` rows: create, claim onto an owner, reorder, release, list orphans, delete |
| `src/lib/data/revision.ts` | The editor's concurrency token — `extract(epoch from updated_at)::text`, **never a `Date`** (read the docstring before touching a conflict check) |
| `src/lib/data/tools.ts` / `units.ts` | Row-level inventory writes, every one revision-checked. Tools are archived, never deleted |
| `src/lib/data/inventory.ts` | The `/admin/inventory` read — every tool, its state and its needs-attention flags, plus the units that belong to no tool |
| `src/lib/data/taxonomy.ts` | `listCategories()` / `listLocations()` — the two option lists an editing surface needs, the only place these tables are read whole — plus `findOrCreateCategory` / `findOrCreateLocation` for intake |
| `src/lib/data/pending-tools.ts` | `pending_tools`: the batch, every status transition as a conditional write, and the two approval transactions |
| `src/lib/data/duplicates.ts` / `tool-create.ts` | The intake duplicate check (same normalisation in TypeScript and SQL), and `createToolRecord` — one tool with its units and resources, slug retried in a savepoint |
| `src/lib/intake/*` | Client-safe intake types, limits and `canActOnPendingTool` / `isResearchable`; `approve.ts` composes approval with audit and invalidation |
| `src/lib/research/*` | The research engine: `prompt`, `model-output`, `errors`, `taxonomy-match`, `assemble`, `verify-links`, `result` (the `ResearchResult` schema, `ImageCandidate`/`ResearchImages`), `step-types` (the steps' shared result types) and `steps` / `image-steps` (the workflow's steps) |
| `src/lib/research/images/*` | The image stage's parts: `candidates`, `probe` (SSRF-guarded download, then `background`'s `transparent`/`plain`/`busy` classification), `rank` (the vision call, plus the `BUSY_PENALTY` nudge and composites last), `crop` (the product box: validation, padding, the crop), `clean-copy` (what rank 1's cleaned copy is: crop, cut, both or none), `clean` (the deterministic flood-fill cutout and its validation — never a generative redraw), `pixels` (RGBA decoding and border helpers), `downscale` (`loadSharp`, and the ranking model's JPEG view) |
| `src/lib/ai/models.ts` | The job registry (gateway spec §3.1) — `MODEL_JOBS` (language jobs only; the image job was retired), `modelIdFor`/`languageModelFor`, `serviceTierFor`/`providerOptionsFor` (per-job service tier), `gatewayProvider()`. No `"server-only"`: step code imports it |
| `src/lib/ai/gateway-usage.ts` | `gatewayCallReport` / `describeGatewayCall` — the cost and applied service tier from a call's `providerMetadata.gateway`, for research's log lines, the backfill summary and live checks |
| `src/lib/ai/gateway-errors.ts` | `classifyModelError` — a Gateway failure in the app's own words (`model_not_found`, `auth`, `rate_limited`, …), never a provider's |
| `src/lib/ai/exa.ts` | `chatExaSearch()` / `researchExaSearch()` — the Gateway's provider-executed web search; `countExaCalls` / `exaImageHints` read it back off `result.steps` |
| `src/lib/ai/tool-caps.ts` | `countToolCalls` / `activeToolsWithinCaps` — the chat's `prepareStep` cap that drops a tool from `activeTools` once its call budget is spent (between steps only: `read_page` also enforces its cap inside the tool; research's Exa budget is advisory, one Gateway request, logged on overshoot) |
| `src/lib/web/read-page.ts` | `readPage()` — the read step's and the chat's `read_page` tool's page fetch: HTML/PDF, capped, timed out, never throws for an expected failure |
| `src/lib/web/guarded-fetch.ts` / `address-guard.ts` | The SSRF guard everything above reads through — `readPage`, the image probe, approval's download of a chosen original, link verification (`research/verify-links.ts`, since the gateway migration: a model-proposed resource link to a private address is dropped unopened), the manual archiver's download (`manuals/archive.ts`) and the chat's download of a manual from its source link (`chat/fetch-manual-pdf.ts`; the app's own Blob copies are fetched plainly) — refuses loopback/private/link-local/metadata addresses, `READ_PAGE_TEST_ORIGIN` exempts one exact origin for tests only |
| `src/lib/web/html-text.ts` | `extractPage()` — a page's readable text plus its `og:image`/`twitter:image`/JSON-LD product image, no HTML parser dependency |
| `src/lib/images/inspect.ts` | `inspectImage()` — a JPEG/PNG/WebP's real dimensions and alpha channel from its header bytes, no deps |
| `src/lib/research/image-steps.ts` | `findImages` (probe, rank, clean the top candidate, write `images`) / `completeWithoutImages` — the workflow's third step per item |
| `src/lib/research/image-stage.ts` / `image-retry-steps.ts` | The image stage's shared probe → rank → clean (no steps, never exported through a step module); **Find a different image**'s step, run by `src/workflows/image-retry.ts` |
| `src/lib/research/source-pages.ts` | Product page vs manual/wiki/support vs video, from the URL — page order for reading, image source weighting, the video evidence rule |
| `src/app/api/pending-tools/[id]/cleaned-image/route.ts` | Streams the private cleaned PNG to a reviewer holding `tools.approve`; 404 otherwise |
| `src/workflows/research-batch.ts` | `researchBatch` — the `"use workflow"` function, started only by the research route |
| `src/app/api/pending-tools/research/route.ts`, `[id]/route.ts` | **Research selected** and the table card's edits |
| `src/app/admin/intake/` | Add equipment: the `(tabs)` route group (Queue — `IntakeList`, polls while research runs; Imports; Import a list) and each item's preliminary page (`PreliminaryToolPage`, `ConfidenceStrip`) with their server actions |
| `src/components/IntakeTableCard.tsx` | The chat's intake table (`data-intake-table`) |
| `src/lib/files/promote.ts` | Copies a claimed chat photo to a public pathname before it is shown as equipment |
| `src/lib/inventory/*` | Those writes composed with cache invalidation and the audit trail — the layer `/admin/inventory`'s server actions call |
| `src/lib/admin/audit-warning.ts` | `record` / `warn` — the shared "a lost audit event is a warning on a success" channel |
| `src/lib/admin/action-gate.ts` | `authorizeAdminAction(permission)` — identity, limiter, permission: the preamble every admin server action runs |
| `src/lib/data/tool-editor.ts` | The editor panel's read — one tool with its units, resources and photos, drafts and retired rows included |
| `src/app/admin/inventory/actions.ts` + `unit-`/`resource-`/`photo-actions.ts` | The editor's server actions, one module per section, each checking its own permission |
| `src/components/admin/ToolEditorPanel.tsx` | The editor itself: the revision token, the conflict, and the five sections beside it |
| `src/app/tools/[id]/EditToolControl.tsx` / `DraftToolView.tsx` | Edit mode on a tool page (phone-first), and drafts at their slug for `catalog.view_drafts` |
| `src/lib/revalidate.ts` | `invalidateCatalog()` / `invalidateProjects()` — the one home for the cache tag strings, and `{ expire: 0 }`, because `revalidateTag` with a *named* profile is stale-while-revalidate and would serve the pre-publish page to one more reader |
| `src/lib/blob.ts` | The Blob seam — `put` (private backups, fixed pathname) and `putUpload` (random pathname, caller's access) |
| `src/lib/cron/backup.ts`, `src/lib/cron/cleanup.ts` | The nightly Postgres export and the orphaned-upload sweep |
| `src/lib/cron/backup-policy.ts` | What the nightly export holds back — `session` / `verification` skipped, `account` tokens blanked. A backup is data, not credentials |
| `src/lib/catalog.ts` | Catalog orchestration + cache, reading Postgres |
| `src/lib/rate-limit.ts` | In-memory (or Upstash) sliding-window limiter, tiered by role |
| `src/lib/auth/config.ts` | The Better Auth instance: Drizzle adapter, database sessions, admin plugin, domain enforcement |
| `src/lib/auth/identity.ts` | `resolveIdentity(req)` — the one way to learn who is calling. Never throws |
| `src/lib/auth/permissions.ts` | `statement` / `ac` / `roles` / `can()` — what each role may do |
| `src/lib/auth/super-admins.ts` | `AUTH_SUPER_ADMIN_EMAILS`, the lock-out floor |
| `src/lib/auth/floor-role.ts` | `reconcileSuperAdminFloor` — writes the floor's role and lifts its ban onto the row, because the admin plugin reads the row and not `can()` |
| `src/app/admin/layout.tsx` | The `/admin` front door — signed in? holds an admin permission? — then the section bar on every admin page, and `PaletteScope` telling the header's ⌘K who this is |
| `src/lib/admin/surfaces.ts` / `src/lib/data/admin-overview.ts` | Every admin surface once (tiles, bar, palette, each with its permission) / the home's count loaders |
| `src/components/palette/*` | The ⌘K palette on every page: `CommandPalette`, `HeaderSearch`, `PaletteScope`, `palette-match` |
| `src/app/admin/inventory/page.tsx` | The review table (`tools.edit`), uncached, filtered from the URL |
| `src/app/admin/users/actions.ts` | `setUserRole` / `removeUser` / `unblockBlockedEmail` — the People page's server actions (Ban retired 2026-09-25) |
| `src/lib/data/user-removal.ts` / `blocked-emails.ts` / `account-removed.ts` | Removing a person in one transaction; the blocked-address list; "an id that names no account" in SQL |
| `src/lib/auth/blocked-sign-in.ts` | Refusing a blocked address in the create hook, and the redirect to `/auth/blocked` |
| `src/lib/data/users.ts` | The `/admin/users` roster, read straight from Postgres |
| `src/lib/admin/queue-write.ts` | `runQueueWrite` — the gate/write/record/refresh preamble the three §5.6 queues share |
| `src/app/admin/maintenance/`, `corrections/`, `projects/` | The three queues: one page, one result module and one action apiece |
| `src/components/admin/use-row-action.ts` | What every queue control does around its action — optimistic, refusal restores, warning keeps |
| `src/components/admin/MaintenanceQueue.tsx` / `CorrectionsQueue.tsx` / `ProjectQueue.tsx` | The three card lists, each with its own small island |
| `src/lib/data/audit.ts` | `audit_events` — insert and select, never update or delete |
| `src/lib/db/schema/auth.ts` | Better Auth's four tables; property keys are its field names |
| `src/lib/types.ts` / `src/components/catalog-types.ts` | Notion record types / resolved view types |
| `src/app/api/chat/route.ts` | The chat: streaming, through the Gateway (job `chat`); capability tools (`get_unit_details`, `report_issue`, `identify_tools`, `read_page`, …) plus `exa_search` (added directly, like the retired `web_search` before it — not a capability), PDF manual attach |
| `src/app/api/mcp/route.ts`, `signed-in/route.ts`, `src/lib/mcp/handler.ts` | The MCP endpoint: caller → rate limit → a server holding only that caller's tools (6 public reads anonymously) |
| `src/lib/auth/mcp-caller.ts` | `resolveMcpCaller` — personal token, legacy `MCP_TOKEN`, OAuth token, or anonymous; a bad bearer is refused, never anonymous |
| `src/lib/capabilities/mcp-access.ts` | `mcpToolAllowed` / `mcpToolsFor` — which tools an MCP caller is offered |
| `src/lib/capabilities/mcp-catalog.ts`, `src/app/mcp/`, `src/lib/mcp/try-it.ts` | The public `/mcp` page: the registry described by audience, and Try it (anonymous, through the MCP handler) |
| `src/lib/data/api-tokens.ts`, `src/lib/auth/api-token-format.ts` | Personal access tokens (hash, prefix, revoke, last use) and the OAuth grant reads ("Connected apps") |
| `src/app/account/tokens/`, `src/app/oauth/`, `src/app/.well-known/` | The token page, the OAuth sign-in and consent pages, the discovery documents |
| `src/app/api/uploads/route.ts` | The one upload route → Vercel Blob + an `attachments` row |
| `src/app/api/cron/daily/route.ts` | The single nightly cron (`vercel.json`): backup, then pending-item expiry, then orphaned-upload cleanup, then the mirror backstop, then the manual archive backfill |
| `src/lib/manuals/*` | The manual archive: `archive` (`archiveManual`), `steps` (`archiveManualStep`, `indexManualStep`), `start` (the one `workflow/api` import), `trigger` (`requestManualArchive`, never throws); manual text: `extract` (unpdf), `index-document`, `stored-bytes`, `digest`; manual search: `chunk` (`CHUNKER_VERSION`), `embed` (job `embed`), `passages` (the index step's second half), `search` (`searchManuals`, hybrid + RRF) |
| `src/lib/data/manual-documents.ts` | `manual_documents` / `manual_pages`: the one-transaction write, current-PDF lists for the step and backfill, editor states, tool-page contents, research's stored-text lookups |
| `src/lib/data/manual-chunks.ts` | `manual_chunks`: the one-transaction passage write, which documents need passages, the chat's view of a tool's manuals, Re-process, the `/admin/research` counts |
| `src/lib/capabilities/manuals.ts` / `src/lib/chat/tool-manuals.ts` | `search_manual` and its prompt (outline of the focused tool's searchable manuals); what the chat route loads to decide what is searched and what is attached |
| `src/app/admin/research/page.tsx` + `actions.ts` | **Manuals** (`tools.edit`): the state strip, the library table (`listManualLibrary`) and Re-process (`reprocessLibraryManual`) |
| `scripts/index-manuals.ts` | `npm run manuals:index` — the manual-text and passages backfill (tokens and cost printed) |
| `src/workflows/archive-manuals.ts` | `archiveManuals(resourceIds)` — one step per resource |
| `src/lib/data/manual-archives.ts` / `src/lib/cron/manual-archive.ts` | The archive's key, stale-copy release and the nightly due list; the cron stage |
| `src/lib/import/*` | Bulk intake: the parsers and validation (pure), `service.ts` (starting an import), `extract.ts` / `suggest-names.ts` (the two model calls), `import-steps.ts` / `suggest-steps.ts` (steps), `research-queue.ts` (chunked Research selected) |
| `src/lib/data/bulk-imports.ts` / `research-allowances.ts` | `bulk_imports` and the rows it makes; setup allowances and `researchLimitFor` |
| `src/app/api/imports/route.ts`, `src/app/admin/intake/imports/` | **Import a list**, and the import review page with its server actions |
| `src/workflows/import-document.ts` / `suggest-names.ts` | Reading a document into rows; the Suggest names pass |
| `src/lib/db/schema/mirror.ts`, `src/lib/data/mirrors.ts` / `mirror-pages.ts` | `notion_mirrors` and `mirror_pages`; every claim (run, Sync now, coalesced push) is one conditional `UPDATE` |
| `src/lib/mirror/*` | The mirror: `notion-client` (raw fetch, throttle, 429), `token-crypto`, `credentials`, `notion-id`, `database-schemas`, `databases` (create / validate pasted ids), `source` (what changed), `properties` (pure row → Notion builders), `push`, `steps`, `start`, `trigger`, `connect` |
| `src/workflows/mirror-push.ts` | `mirrorPush(mirrorId)` and `mirrorPushAfterChange()` — the `"use workflow"` functions |
| `src/app/admin/mirror/` + `src/components/admin/Mirror*.tsx` | The settings page, its seven server actions, and the four islands (`MirrorConnect`, `MirrorMapping`, `MirrorStatus`, `MirrorControls`) |
| `test/fakes/notion-fake.ts` | The in-memory Notion every mirror test (and the E2E stub) talks to |
| `src/app/api/admin/revalidate/route.ts` | Cache invalidation (`tools.edit`, or `x-admin-secret` for session-less callers) |
| `src/components/ChatFab.tsx` | Chat UI: `useChat` and its transport, the docked `Sheet`, the launchers (the floating button on public pages only); starter chips are the tool's own on its page (`ToolChatStarters` → `ChatLauncherContext`), else the generic three. Its parts live in `src/components/chat/` (`ChatMessage`, `ChatResponse` with manual citations, `ChatComposer`, `use-chat-attachments` for photo/list uploads, `use-dictation`, `AskAssistantButton`) on AI Elements in `src/components/ai-elements/` |
| `src/lib/starter-questions.ts` / `scripts/generate-starter-questions.ts` | A tool's assistant starter questions — the cleaning rules, and the backfill for tools that have none |
| `src/lib/tool-names.ts` / `scripts/backfill-display-names.ts` | A tool's display and official names — the display rules and guard, and the backfill that shortens imported names |
| `src/lib/tool-name-brand.ts` / `tool-name-choice.ts` / `display-name-rules.ts` / `data/tool-name-clash.ts` | Bare-brand refusal and category nouns; unique names with the distinguishing spec; the one rules text the prompts share; the `duplicate_name` read |
| `src/app/page.tsx`, `tools/[id]/page.tsx` | Gallery + tool detail |

## Conventions

- Use the `@/` import alias (→ `src/`).
- Server components by default; add `"use client"` only when needed.
- Server-only modules import `"server-only"` (e.g. `rate-limit.ts`).
- Theme/brand via **CSS variables** (`--primary`, `--background`, …) — `[data-theme="light|dark"]` on `<html>`, never hardcoded colors.
- **The `--td-*` tokens and `.td-*` classes are gone** (public polish). Legacy
  CSS reads the global theme tokens directly. An unresolvable `var()` does not
  fall back — it computes to `unset` — so a rule copied from old history that
  names one fails *silently and wrongly*; use the theme tokens.
- **UI system** (spec `docs/specs/2026-09-25-ui-system-design.md`, being
  adopted phase by phase): Tailwind 4 theme + utilities with no preflight,
  from `src/styles/ui.css` (imported before `globals.css`); shadcn primitives
  in `src/components/ui`, app-level ones (`StatusGlyph`, `Sparkline`,
  `PageHeader`, `EmptyState`) in `src/components/system`, classes joined with
  `cn` (`@/lib/utils`). Orange *text* is `--primary-ink`, errors are
  `--status-bad` (never crimson), focus is the global `:focus-visible` outline —
  never `outline: none`. Fonts are self-hosted (`src/app/fonts.ts`). New
  components never carry legacy classes: unlayered legacy CSS beats utilities.
  **Every list of records is `DataTable`** (`src/components/system/data-table/`:
  TanStack Table v8 state, our markup; `FilterBar` + `FacetFilter` with per-value
  counts + `ColumnsMenu`; `facetOptions`). The caller filters and, where the view
  is worth linking, writes the filters to the URL with `replaceState`
  (`inventory-filters.ts`, `users-filters.ts`). Below `sm` a `mobileRow` list
  replaces the table; `usePhoneLayout` renders only one of the two once the
  browser can say which, so a row's controls exist once. In jsdom both render:
  scope queries to `getByRole("table", { name })`. A table inside a panel
  (the chat's intake table) uses `layout="container"`: its own width decides,
  and an unmeasurable one (jsdom) keeps the table only.
  **Every review is `ReviewCard`** (`src/components/system/review/`:
  `ReviewCard`, `ReviewValues`, `ReviewSources`, `ReviewNote`,
  `ReviewDiagnosis`; `DuplicateChoice` for "this matched X" — a radio group
  whose arrows never choose, because choosing saves). Form fields are
  `system/Field` (label above, hint below, `hintId(id)` for
  `aria-describedby`). Refresh and chat proposals, the intake queue and approve
  page, import review and the chat's intake table are all on them (UI system
  phase 3); `admin-intake.css` and `intake-table.css` are gone.
  **Admin navigation** (phase 4): `Tile`/`TileGroup`, `LinkTabs` (tabs that
  are URLs: links with `aria-current`, never `role="tab"`) and `queue/QueueList`
  (search + facets over a queue, open work on the page, settled behind a
  disclosure) in `system/`; `AdminNav`, `AdminPageHeader` and `CommandPalette`
  (shadcn `Command` over `cmdk` in `ui/dialog`; since public polish in
  `palette/`, mounted in the site header for everybody — see below) in `admin/`. An inline outcome
  is `RowStatus` (codes, or `tone` + words); a page that could not read its
  data is `EmptyState tone="bad"`. `admin-row-status`, `admin-empty`,
  `admin-section*` and the `admin-queue*` rules are gone.
  **Public pages** (phase 5a): working pages are `PublicPage` + `PageSection`
  (`system/PublicPage.tsx`); Markdown on a page is `system/Markdown`, never the
  chat's `.chat-markdown`. The gallery is `FilterBar` + `FacetFilter` +
  `ChoiceMenu` (Sort, Group by), its state in the URL through
  `gallery-filters.ts` and `useUrlSearch` (the page is one cached prerender, so
  the island reads the query string itself); grouped, it is sticky-headed
  sections with counts. The tool page is one column (`DetailShell`, units as
  `tool/UnitsTable`, the maintenance history from `getToolMaintenanceHistory` —
  no names). `app/not-found.tsx` / `app/error.tsx` exist. `account.css`,
  `mcp.css`, the `.tool-detail` palette and the gallery/projects legacy rules
  are gone.
  **Public polish**: every list's toolbar is the one `FilterBar` (search with
  the count, then facets left and `secondary`/`end` right; a phone **Filters**
  `Sheet`, `ui/sheet.tsx`); view switches are `system/SegmentedControl`; the
  gallery table has a Status facet, Columns and sorting on every column
  (`useGalleryColumns`). The ⌘K palette (`palette/CommandPalette`) is in the
  header on every page (`HeaderSearch`): published tools from the root layout
  (`getPaletteTools`), the role from `PrimaryNav`'s identity
  (`lib/auth/identity-store.ts`), and on admin pages the server-resolved role
  and draft index via `PaletteScope`. Floating menus use `FROSTED`
  (`system/frosted.ts`). The root always shows its scrollbar so the header
  never moves (`e2e/header-stability.spec.ts`). Save-on-click controls report
  "Saved" in a reserved `SaveSlot` (`admin/RowStatus.tsx`). The tool page is
  two columns on desktop and draws no empty section.
  **Chat** (phase 5b): AI Elements copied from `registry.ai-sdk.dev` into
  `src/components/ai-elements/` (Conversation, Message, PromptInput, Tool,
  Sources, InlineCitation, Suggestion, Loader), trimmed to what the chat uses
  — never run the AI Elements CLI (it prompts to overwrite `ui/` and installs
  every component's dependencies). The chat is a frosted `Sheet`; Markdown is
  streamdown with its `raw` rehype plugin dropped (model text never renders
  as HTML) and plain elements (`ai-elements/message-markdown.tsx`) styled by
  the pages' `MARKDOWN_PROSE`. A link whose address one of the turn's
  `search_manual` passages returned is an inline citation, and the cited
  pages are the answer's Sources (`chat/manual-citations.ts`). Messages carry
  `data-role` / `data-kind` for tests. The floating button is not drawn on
  `/admin/*`: the section bar's **Ask the assistant** and ⌘K (`onAsk`, from
  `HeaderSearch`) open it. `FlagButton` is a `Dialog`. The `.chat-*` CSS and
  `admin-import.css` are gone.
- All branding strings come from `siteConfig` (`@/lib/site-config`).
- Every API route is **rate-limited by identity** before expensive work — user id when signed in, hashed IP when not.
- Authorization is **always** `can(subject, permission)` from `src/lib/auth/permissions.ts`. Never compare role names, and never gate inside a capability tool's `run()`.
- Maintenance tickets are always written in **English** even when the chat replies in another locale.

## Testing

Comprehensive, **fully-mocked** suite (no live Notion/Gateway/Redis/Postgres —
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
  `vitest.setup.ts` sets `BLOB_LOCAL_DISABLE=1`, so "no token" still means "no
  store"; the local-store tests opt in and write to a temp folder.
  Only the mirror writes Notion; its tests talk to an in-memory Notion
  (`test/fakes/notion-fake.ts`) through MSW, never to `api.notion.com`.
- **Every model call is stubbed, at one of two seams, and never with a
  provider-specific mock** (never `vi.mock("@ai-sdk/gateway")`):
  - **`test/ai/models-stub.ts`** — `vi.mock("@/lib/ai/models", …)` swaps
    `languageModelFor` for a `MockLanguageModelV3` (from `ai/test`) built
    with `textModel`, `toolCallModel`, `scriptedModel`, etc. This is
    the seam for anything that imports the registry directly — most unit and
    route-integration tests.
  - **`test/gateway/*`** — `wire.ts` (dependency-free request/response
    builders matching the Gateway's own wire format), `msw.ts`
    (`gatewayHandlers({ language?, image? })`, MSW handlers over it) and
    `png.ts` (`makePng`, a real decodable PNG with or without alpha, and
    `makeProductPng`, a product on a plain white backdrop — both no deps).
    `test/images/synthetic.ts` paints synthetic photos with `sharp` for the
    classifier and cutout tests. This is the seam for the **workflow tier**
    (`*.workflow.test.ts` under `@workflow/vitest`, where `vi.mock` does not
    reach step code) — it now talks to `https://ai-gateway.vercel.sh`
    (stubbed by MSW), not `api.anthropic.com`.
- E2E boots its own server on **port 3100** with `DATABASE_URL` unset (PGlite demo catalog) and intercepts `/api/chat` — it never touches your `:3000` dev server or real services.
- **The intake E2E is the exception** (`e2e/intake.spec.ts`): it needs `identify_tools` and the research workflow (including the image stage) to run server-side, so the model is stubbed at the Gateway's own wire format by a second local server (`e2e/stubs/gateway-stub.ts`, reached through `AI_GATEWAY_BASE_URL`, using the same `test/gateway/wire.ts`/`png.ts` builders under `node --experimental-strip-types`), and `READ_PAGE_TEST_ORIGIN` exempts that one loopback origin from the SSRF guard so the read step and `read_page` can reach the stub's own pages. The workflow runs on the SDK's local world. It is its own Playwright project, run after every other spec, **against its own server**: the same build started again on port 3103 with a local Blob folder (`BLOB_LOCAL_DIR=.blob-data-e2e`), so the image stage cleans the top candidate, the review page shows it through the cleaned-image route, and the test picks it and sees it on the gallery card — while the main server keeps the "uploads unavailable" branch `projects.spec.ts` asserts. Its demo database is separate, so the approved tool never reaches `gallery.spec.ts`'s count.
- **The mirror E2E** (`e2e/mirror.spec.ts`) is the same shape: Notion is a local stub (`e2e/stubs/notion-stub.ts`, port 3102, reached through `NOTION_API_BASE_URL`) serving the same fake, and the project runs after `intake`, last of all.
- Tests are colocated (`*.test.ts(x)` next to source); shared harness in `test/`.
- **Read these before writing tests:** `TESTING.md` (runbook), `test/README.md` (harness internals, the two model-stubbing seams above, and env-stubbing patterns), and `docs/specs/2026-05-29-v5-test-suite-design.md` (design + coverage matrix). The harness deps/scripts are already wired — don't hand-edit `package.json` for them.

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
- The in-memory rate limiter is a per-process singleton; it resets on cold start (fine for abuse prevention). Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set.
- Python scripts under `scripts/` use Node with `--experimental-strip-types`; they are migration/maintenance tools, not part of the app build.
