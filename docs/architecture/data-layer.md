# Data layer

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

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
  `PGLITE_DATA_DIR` set (e.g. `.pglite-data`, git-ignored; relative to the repo root),
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
  guard every untrusted id passes before it reaches a uuid column).
  Relative imports with `.ts` extensions, no `@/` alias, no
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
  The Phase-2 page-id bridge (`src/lib/data/notion-ids.ts`) and the retired
  `/api/upload-notion` were deleted (2026-09-30). The retired Notion-dump `/api/admin/backup` was deleted (ops spec amendment
  2026-09-27); `/api/cron/daily` is the only backup.
- **No request path writes Notion** as of Phase 6, except the mirror, which
  pushes from a workflow and from its own settings page. Intake's chat tool,
  `identify_tools`, writes `pending_tools` rows and makes the photos it claims
  public; `create_tool` is **MCP-only** now and writes an unpublished Postgres
  draft (`createToolRecord`). See "Adding equipment" below.
- **Files** (tool images, manuals, project photos, maintenance photos) live in
  **Vercel Blob**, recorded row-by-row in `attachments` — see
  `next.config.ts`'s `images.remotePatterns`, which names only the lab's own
  public store (`src/lib/images/remote-patterns.ts`, derived from
  `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` at build time). `POST /api/uploads` is the one
  upload route; it reads an image's bytes (JPEG, PNG, WebP or GIF only, stored
  under the detected type — `images/upload-type.ts`) and a resource's PDF magic,
  writes the blob, inserts an **unowned** `attachments` row and
  returns `{ attachmentId, previewUrl }`. A **HEIC/HEIF** photo (an iPhone's,
  from a browser that cannot read it) is converted, not refused: decoded by
  `heic-decode` (libheif in WebAssembly, loaded on the first HEIC only —
  `images/heif.ts`), stored as a JPEG of at most 2048 px under a `.jpg` name
  (`images/convert-photo.ts`, the same rules as the browser's,
  `images/photo-rules.ts`), and a `chat` upload's answer carries
  `visionDataUrl`, the 1568 px copy the model sees. The chat downsizes every
  photo it can read before uploading (`lib/chat/downscale-image.ts`), so the
  conversion is the fallback (data platform spec amendment 2026-10-08). The write that follows *claims* those
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
- **Two Blob stores: public and private.** A Vercel Blob store is either
  all-public or all-private, so a deployment links the default store (public)
  and a second one connected with the custom prefix `BLOB_PRIVATE`
  (`BLOB_PRIVATE_READ_WRITE_TOKEN`, or `BLOB_PRIVATE_STORE_ID` + OIDC).
  **Every `@vercel/blob` call spreads `blobCredentials(access)`**
  (`src/lib/blob-mode.ts`) — never call the SDK without it. `BlobStore.list`
  and `del` take an access; `copyToPublic` reads from the private store and
  writes to the public one when both are linked (`copy()` cannot cross
  stores). With no `BLOB_PRIVATE_*`, private files use the default store, as
  before; `blobMode()` is unchanged (data platform spec, amendment 2026-09-27).
- **Chat illustrations are not attachments** (gateway spec amendment
  2026-10-07). A picture the assistant draws is a private blob under
  `chat/illustrations/`, recorded in its own table, `chat_illustrations`
  (migration `0030`: person, kind, status, model, cost, pathname — never the
  words it was drawn from), and served only to the person who asked for it by
  `/api/chat/illustrations/[id]`. Nothing that claims, promotes or publishes an
  `attachments` row can reach one, so an illustration can never become a
  tool's, a ticket's or a project's photo. The rows are the ledger the daily
  caps count; they cascade with their person. The nightly backup keeps the
  table; `data:push` leaves it out (`DEPLOYMENT_BOUND`: the blobs it names are
  the deployment's own). No sweep deletes the blobs yet (an open question in
  the amendment).
- **Tool skills are AI-written and travel** (tool skills spec 2026-10-07,
  migration `0031`). `tool_skills` holds every operating guide a tool has had
  (versioned per tool, `ready` or `failed`, cascading with the tool); the
  current skill is the latest `ready` row. Unlike `starter_answers` and
  `chat_illustrations` it is backed up **and** copied by `data:push`: a skill
  cites manuals by document id and page and links by the manufacturer's URL,
  never a stored file's address, so a skill written on a local copy holds on
  the hosted one. See `docs/architecture/tool-skills.md`.
- **Failing toward stale, not wrong (Article 4).** `DATABASE_URL` unset serves
  the PGlite demo seed with `DemoDataBanner` shown. `DATABASE_URL` set but
  unreachable never falls back to demo or invented data — cached pages keep
  serving and an uncached read renders the error state.
