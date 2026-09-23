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
  setup sets it, so tests opt in to local mode with a temp `cwd`. The Notion
  import still requires a real token (`createVercelBlobUploader`).
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
  audit write happens *after* `auth.api.setRole` / `banUser` has committed, so
  throwing there would make the page show the old value over a database holding
  the new one. `record()` reports instead, and the action answers
  `{ ok: true, …, warning: "audit_unavailable" }`. Both islands keep the new
  value and show `admin.warnings.<code>` in `.admin-row-status.is-warning`.
  **Never answer `{ ok: false }` for a write that landed** — both islands
  respond to a refusal by restoring the previous value, which would then assert
  a state the database does not hold. Phase 5 reuses this rather than repeating
  it: `record` and `warn` now live in `src/lib/admin/audit-warning.ts`, and the
  codes every admin surface shares in `src/lib/admin/action-result.ts`.
- **`/admin/inventory` is the review table, and it is not the catalogue.** It
  lists every tool including drafts and archived ones, with the flags a review
  runs on — no photo, no manual, open tickets, never reviewed — computed in SQL
  by `src/lib/data/inventory.ts` in five statements whatever the size of the
  inventory. An *archived* tool carries no flags: archiving is one of the three
  outcomes of a review, so settled equipment stays out of the queue. Units that
  belong to no tool come back as their own list rather than being attached to a
  guessed tool.
- **The filters are client-side and in the URL, both on purpose.** The server
  renders every row and `InventoryFilters` narrows them in the browser (the
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

## Adding equipment (`pending_tools`, Phase 6)

Two steps with a person between them (spec §5.4). **Identify** in the chat,
**research** in the background, **approve** on `/admin/intake` — research never
creates a tool (Article 5).

- **The chat identifies and nothing more.** `identify_tools`
  (`capabilities/intake.ts`, `tools.add`, chat-only) records each item as a
  `pending_tools` row in one batch, runs the duplicate check
  (`src/lib/data/duplicates.ts` — normalised name-plus-brand, then `pg_trgm`
  at 0.5) and emits one `data-intake-table` part. `research_tool` and
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
  `Promise.allSettled`, two steps per item (search, then fetch and verify),
  each with its own 240-second deadline and `maxRetries = 2` set as a property.
  The prompt, output parsing, error classification and assembly are
  `src/lib/research/*`. **Confidence is computed in code** (`scoreConfidence`),
  and the model's reported evidence is only ever lowered to match what
  verification found — so "research found nothing" grades low, never medium.
  Step code runs under plain Node: relative imports, no `"server-only"`
  anywhere below it, and `vi.mock` does not reach it under `@workflow/vitest`.
  The research route imports `researchBatch`, which is what makes `next build`
  compile the workflow at all.
- **Approval is one transaction** (`approvePendingTool` / `approvePendingAsUnit`
  in `src/lib/data/pending-tools.ts`), composed with the audit trail and
  `invalidateCatalog()` by `src/lib/intake/approve.ts`. Approving published
  records `pending.approved` **and** `tool.published`; a lost audit event is a
  warning on a success, as everywhere else. Low confidence keeps both Approve
  buttons off until "I've checked this" is ticked and a note written.
- **The daily cron expires what nobody researched.** `identified` rows older
  than 14 days are discarded and their photos released (`runPendingExpiry`),
  just before the orphan sweep deletes them from Blob.

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
| `src/lib/research/*` | The research engine: `prompt`, `model-output`, `errors`, `taxonomy-match`, `assemble`, `verify-links`, `result` (the `ResearchResult` schema) and `steps` (the workflow's steps) |
| `src/workflows/research-batch.ts` | `researchBatch` — the `"use workflow"` function, started only by the research route |
| `src/app/api/pending-tools/research/route.ts`, `[id]/route.ts` | **Research selected** and the table card's edits |
| `src/app/admin/intake/` | The queue (`IntakeList`, polls while research runs) and each item's preliminary page (`PreliminaryToolPage`, `ConfidenceStrip`) with their server actions |
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
| `src/app/admin/layout.tsx` | The `/admin` front door — signed in? holds an admin permission? |
| `src/app/admin/inventory/page.tsx` | The review table (`tools.edit`), uncached, filtered from the URL |
| `src/app/admin/users/actions.ts` | `setUserRole` / `setUserBanned` — the app's first server actions |
| `src/lib/data/users.ts` | The `/admin/users` roster, read straight from Postgres |
| `src/lib/admin/queue-write.ts` | `runQueueWrite` — the gate/write/record/refresh preamble the three §5.6 queues share |
| `src/app/admin/maintenance/`, `corrections/`, `projects/` | The three queues: one page, one result module and one action apiece |
| `src/components/admin/use-row-action.ts` | What every queue control does around its action — optimistic, refusal restores, warning keeps |
| `src/components/admin/MaintenanceQueue.tsx` / `CorrectionsQueue.tsx` / `ProjectQueue.tsx` | The three card lists, each with its own small island |
| `src/lib/data/audit.ts` | `audit_events` — insert and select, never update or delete |
| `src/lib/db/schema/auth.ts` | Better Auth's four tables; property keys are its field names |
| `src/lib/types.ts` / `src/components/catalog-types.ts` | Notion record types / resolved view types |
| `src/app/api/chat/route.ts` | Claude chat: streaming, capability tools (`get_unit_details`, `report_issue`, `identify_tools`, …) plus `web_search` / `web_fetch`, PDF manual attach |
| `src/app/api/mcp/route.ts` | MCP JSON-RPC server (5 tools), bearer-token auth |
| `src/app/api/uploads/route.ts` | The one upload route → Vercel Blob + an `attachments` row |
| `src/app/api/cron/daily/route.ts` | The single nightly cron (`vercel.json`): backup, then pending-item expiry, then orphaned-upload cleanup, then the mirror backstop, then the manual archive backfill |
| `src/lib/manuals/*` | The manual archive: `archive` (`archiveManual`), `steps`, `start` (the one `workflow/api` import), `trigger` (`requestManualArchive`, never throws) |
| `src/workflows/archive-manuals.ts` | `archiveManuals(resourceIds)` — one step per resource |
| `src/lib/data/manual-archives.ts` / `src/lib/cron/manual-archive.ts` | The archive's key, stale-copy release and the nightly due list; the cron stage |
| `src/lib/db/schema/mirror.ts`, `src/lib/data/mirrors.ts` / `mirror-pages.ts` | `notion_mirrors` and `mirror_pages`; every claim (run, Sync now, coalesced push) is one conditional `UPDATE` |
| `src/lib/mirror/*` | The mirror: `notion-client` (raw fetch, throttle, 429), `token-crypto`, `credentials`, `notion-id`, `database-schemas`, `databases` (create / validate pasted ids), `source` (what changed), `properties` (pure row → Notion builders), `push`, `steps`, `start`, `trigger`, `connect` |
| `src/workflows/mirror-push.ts` | `mirrorPush(mirrorId)` and `mirrorPushAfterChange()` — the `"use workflow"` functions |
| `src/app/admin/mirror/` + `src/components/admin/Mirror*.tsx` | The settings page, its seven server actions, and the four islands (`MirrorConnect`, `MirrorMapping`, `MirrorStatus`, `MirrorControls`) |
| `test/fakes/notion-fake.ts` | The in-memory Notion every mirror test (and the E2E stub) talks to |
| `src/app/api/admin/revalidate/route.ts` | Cache invalidation (`tools.edit`, or `x-admin-secret` for session-less callers) |
| `src/components/ChatFab.tsx` | Chat UI (`useChat`, citations stripped, photo upload) |
| `src/app/page.tsx`, `tools/[id]/page.tsx` | Gallery + tool detail |

## Conventions

- Use the `@/` import alias (→ `src/`).
- Server components by default; add `"use client"` only when needed.
- Server-only modules import `"server-only"` (e.g. `rate-limit.ts`).
- Theme/brand via **CSS variables** (`--primary`, `--background`, …) — `[data-theme="light|dark"]` on `<html>`, never hardcoded colors.
- **The `.td-*` utilities are global; their `--td-*` tokens are not.** They are
  declared on `.tool-detail`, and `.admin-shell` supplies its own mapped onto
  the global theme tokens. Using a `.td-*` class anywhere else means supplying
  the tokens there too: an unresolvable `var()` does not fall back, it computes
  to `unset`, so the rule fails *silently and wrongly* rather than visibly.
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
  `vitest.setup.ts` sets `BLOB_LOCAL_DISABLE=1`, so "no token" still means "no
  store"; the local-store tests opt in and write to a temp folder.
  Only the mirror writes Notion; its tests talk to an in-memory Notion
  (`test/fakes/notion-fake.ts`) through MSW, never to `api.notion.com`.
- **Two Vitest projects.** `unit` is the existing config; `workflow`
  (`vitest.workflow.config.ts`) runs `*.workflow.test.ts` under
  `@workflow/vitest`, where the model is stubbed with MSW on
  `api.anthropic.com` because `vi.mock` does not reach step code.
- E2E boots its own server on **port 3100** with `DATABASE_URL` unset (PGlite demo catalog) and intercepts `/api/chat` — it never touches your `:3000` dev server or real services.
- **The intake E2E is the exception** (`e2e/intake.spec.ts`): it needs `identify_tools` and the research workflow to run server-side, so the model is stubbed at the provider boundary by a second local server (`e2e/stubs/anthropic-stub.ts`, reached through `ANTHROPIC_BASE_URL`), and the workflow runs on the SDK's local world. It is its own Playwright project that runs after every other spec, because approving publishes a third tool into the shared demo database.
- **The mirror E2E** (`e2e/mirror.spec.ts`) is the same shape: Notion is a local stub (`e2e/stubs/notion-stub.ts`, port 3102, reached through `NOTION_API_BASE_URL`) serving the same fake, and the project runs after `intake`, last of all.
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
- **A server action's re-render can sit uncommitted.** In the production build
  (Next 16.1, React 19.2, `cacheComponents`), the page a server action
  refreshed with `revalidatePath` finished rendering and was not shown until
  something else updated the page — and a later `router.refresh()` queued
  behind it. Islands that depend on the re-rendered page (the mirror page's
  four) call `useRefreshNudge()` (`src/components/admin/use-refresh-nudge.ts`)
  after a successful action; islands that keep their own confirmed state (the
  queues, `RoleSelect`) are unaffected. E2E scenario 8 is the canary.
- The in-memory rate limiter is a per-process singleton; it resets on cold start (fine for abuse prevention). Upstash backs it only when **both** `UPSTASH_REDIS_REST_*` vars are set.
- Python scripts under `scripts/` use Node with `--experimental-strip-types`; they are migration/maintenance tools, not part of the app build.
