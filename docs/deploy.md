# Setup & Deploy

> How to run MakerLab Tools on your machine, and how to host it on Vercel.
>
> How it works: [`architecture-guide.md`](architecture-guide.md).
> How to operate it once live: [`handover.md`](handover.md).

**The app degrades on purpose, so you can do this in stages.** Nothing forces you to have
every credential before you see it working — each part that is not configured switches off
cleanly and says so, rather than crashing or pretending.

---

# Part 1 — Locally

## Stage 0 · It runs with nothing (2 minutes)

```bash
cd v5
npm install
npm run dev            # http://localhost:3000
```

A crimson **DEMO DATA** banner appears. That is correct: with no Notion credentials the app
serves a built-in sample catalogue, and the banner exists so nobody mistakes it for the
lab's real inventory.

Working already: catalogue browse and search, facets, grid ⇄ table, tool detail pages,
`/projects`, the 12-language switcher, `/api/health` (returns **503** `unconfigured`, which
is the honest answer), and `npm run qr:labels`.

```bash
npm run test:all       # lint, typecheck, 771 unit/integration, 33 E2E
```

> **Stop `npm run dev` before running `test:all`.** Both use `.next/dev/lock`, and E2E
> cannot boot its own server on :3100 while the dev server holds it. The failure looks like
> a broken test and is not one.

## Stage 1 · The assistant (2 minutes)

Every model call goes through the **Vercel AI Gateway** — there is no direct
provider key any more (gateway spec 2026-09-23; `ANTHROPIC_API_KEY` is read by
nothing). Create `v5/.env.local`:

```bash
AI_GATEWAY_API_KEY=...
```

Get a key from the Vercel dashboard, under **AI Gateway** on the project (or
any project in your team — Gateway keys are account-scoped). No Vercel project
needed to be linked to *this* one for local dev; the key alone is enough.

Restart. **This is the biggest single unlock** — all ten capability tools go live against
the demo catalogue, which is enough to exercise most of the product:

| Try | What it exercises |
|---|---|
| From the gallery: *"I need to cut 6mm plywood"* | `search_tools`, project scoping |
| From a tool page: *"How do I replace the filament?"* | Manual-grounded answers |
| Ask in Spanish | Replies in the language asked |
| **REPORT** in the nav | Troubleshoots first, then offers to file |
| **ADD** in the nav, paste a product URL | Intake + the confidence strip |
| *"Do you have a waterjet?"* | Honest absence — it must not invent one |

On **ADD**, watch the confidence strip. A legible model plate gives HIGH and a card;
something ambiguous gives **no card at all** and a specific question. That is the design
working, not a failure.

`npm run eval` runs the agent eval harness. It makes **real, paid** model calls and is
deliberately outside `test:all` — see `v5/evals/README.md`, including the §10 eval gate
to run before pointing production at a different model.

## Stage 2 · Real data (30–45 minutes — the real work)

Create a Notion integration, then seven databases shared with it. Set in `.env.local`:

```bash
NOTION_API_KEY=ntn_...
NOTION_DB_TOOLS=...            NOTION_DB_CATEGORIES=...
NOTION_DB_LOCATIONS=...        NOTION_DB_UNITS=...
NOTION_DB_RESOURCES=...        NOTION_DB_MAINTENANCE_LOGS=...
NOTION_DB_FLAGS=...
NOTION_DB_PROJECTS=...         # optional — enables the projects gallery
```

> **All seven of the first group are required together.** Miss one and the app falls back to
> the demo catalogue. Check `/api/health`: `200` with `"catalog": "live"` means real data.

**Three schema details that will bite you:**

| Database | Requirement | If missing |
|---|---|---|
| Flags | `status` select **must have a `New` option** | Corrections fail — Notion rejects unknown select options on write |
| Projects | a **`published` checkbox** | No moderation gate |
| Maintenance_Logs, Projects | `reporter_email` / `author_email` (Email) | Writes succeed without them; the code retries and logs |

The last row is deliberate — those two features ship safely before the schema change lands,
and start recording verified authorship the moment it does.

### Stage 2b · Import Notion locally, review it, then import into Neon

`PGLITE_DATA_DIR` is a persistent PGlite database on your laptop (dev only — refused on
Vercel and in production builds). The dev server reads it when `DATABASE_URL` is unset:
the real inventory, no demo seed, no demo banner, and `/api/health` answers
`"database": "local"`, `"catalog": "live"`. Precedence everywhere — the app,
`import:notion`, `verify:import`, `db:migrate` — is `DATABASE_URL` > `PGLITE_DATA_DIR` >
demo seed (`--dry-run` always imports into memory).

A PGlite directory is **single-process**: stop `npm run dev` before importing, or the script
stops with "in use by process N … stop that process and try again".

```bash
cd v5
# with NOTION_API_KEY and the NOTION_DB_* ids in .env.local, DATABASE_URL unset
npm run import:notion -- --dry-run                           # rehearse; nothing kept
PGLITE_DATA_DIR=.pglite-data npm run import:notion           # rows + files into .pglite-data/
PGLITE_DATA_DIR=.pglite-data npm run verify:import           # counts, relations, files
PGLITE_DATA_DIR=.pglite-data npm run dev                     # review it in the app
```

(Or put `PGLITE_DATA_DIR=.pglite-data` in `.env.local` and drop the prefix.) Each script
prints its target and where files go. Without `BLOB_READ_WRITE_TOKEN`, files are copied into
`.blob-data/` and their URLs point at `AUTH_BASE_URL/api/dev-blob/…` — so set
`AUTH_BASE_URL` to the dev server's real origin (e.g. `http://localhost:3001`) before
importing. Re-running the import is idempotent; to start over, stop the dev server and
delete `.pglite-data/` (both it and `.blob-data/` are git-ignored).

When the local review looks right, import into Neon from Notion — not from the local
database, whose file URLs point at your laptop:

```bash
DATABASE_URL=postgres://… npm run db:migrate
DATABASE_URL=postgres://… BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… npm run import:notion
DATABASE_URL=postgres://… BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… npm run verify:import
```

A `DATABASE_URL` target always copies files to Vercel Blob and refuses to run without the
token (or pass `--skip-files`). Unset `PGLITE_DATA_DIR` before `next build`.

### Stage 2c · Starter questions for tools that have none (optional, a few cents)

On a tool's page the assistant opens with three questions about *that* tool instead of the
generic chips (gateway spec amendment "Tool-specific starter questions"). Research writes
them for new tools; migration `0009` gives every existing tool an empty list, which shows
the generic chips. `scripts/generate-starter-questions.ts` fills them in, one `researchRead`
model call per tool, from the tool's own name, description and resource titles — no web
search. It needs `AI_GATEWAY_API_KEY` (or a pulled `VERCEL_OIDC_TOKEN`) in `.env.local`,
follows the import scripts' target order (`DATABASE_URL` > `PGLITE_DATA_DIR`; stop the dev
server for a local database), prints an estimate first and the real usage last, and never
overwrites questions a tool already has.

```bash
cd v5
# rehearse on five tools: calls the model, prints the questions, writes nothing
PGLITE_DATA_DIR=.pglite-data node --env-file-if-exists=.env.local --experimental-strip-types \
  scripts/generate-starter-questions.ts --dry-run --limit 5
# then for real (drop --limit for every tool; --ids form-4,trotec-speedy-400 for some)
DATABASE_URL=postgres://… node --env-file-if-exists=.env.local --experimental-strip-types \
  scripts/generate-starter-questions.ts
```

Run `db:migrate` against Neon first. Staff can edit the questions afterwards in the tool
editor ("Assistant starter questions"); the tool pages pick them up once the catalogue's
few-minute cache expires.

### Stage 2d · Manual text for manuals already stored (optional, free)

Each stored manual PDF is also kept as text, page by page, with its outline (manual text
spec, phase 1; migration `0010`). New manuals are processed right after they are archived;
manuals archived or uploaded before that need one backfill. It runs pdf.js locally — **no
Gateway calls, no cost** — reading each PDF back from Blob (`BLOB_READ_WRITE_TOKEN`, or
`.blob-data/` for a local database) and follows the import scripts' target order
(`DATABASE_URL` > `PGLITE_DATA_DIR`; stop the dev server for a local database).

```bash
cd v5
# rehearse: reads and extracts every stored PDF, reports ready / no_text / failed and pages, writes nothing
PGLITE_DATA_DIR=.pglite-data npm run manuals:index -- --dry-run
# then for real (--limit N, --ids <resource ids>; --force re-processes everything)
DATABASE_URL=postgres://… BLOB_READ_WRITE_TOKEN=… npm run manuals:index
```

Run `db:migrate` against Neon first. The `no_text` count is how many manuals are scans
(the spec's OCR question). The tool pages show each manual's **Contents** once the
catalogue's few-minute cache expires.

### Stage 2e · Manual search: passages and embeddings (a few cents)

Phase 2 of the manual text spec makes each ready manual **searchable**: its stored pages
are split into passages and each is embedded through the Gateway (job `embed`,
`openai/text-embedding-3-small` at 512 dimensions, `MODEL_EMBED` overrides it). The chat's
`search_manual` answers from them with page citations; a manual without passages is still
attached whole, as before.

- **pgvector.** Migration `0011` runs `CREATE EXTENSION IF NOT EXISTS vector` and creates
  `manual_chunks`. **Neon ships pgvector** — the migration is all it needs, no dashboard
  step. Locally PGlite loads it from `@electric-sql/pglite-pgvector`.
- **New manuals** get passages in the same archive workflow run that stores their text.
  **Manuals already stored** need the backfill, which is the same command as Stage 2d: after
  the text pass it chunks and embeds every ready document whose passages are missing or
  were built by another chunker version or embedding model, and prints tokens and the
  Gateway-reported cost (about $0.0006 for a 60-page manual, $0.002 for 150 pages).

```bash
cd v5
DATABASE_URL=postgres://… npm run db:migrate            # 0011: pgvector + manual_chunks
# rehearse: chunks and counts passages, embeds nothing, costs nothing
DATABASE_URL=postgres://… BLOB_READ_WRITE_TOKEN=… npm run manuals:index -- --dry-run
# for real — needs Gateway auth: AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN from `vercel env pull`
DATABASE_URL=postgres://… BLOB_READ_WRITE_TOKEN=… VERCEL_OIDC_TOKEN=… npm run manuals:index
```

`--text-only` skips the embedding pass. Changing `MODEL_EMBED` (or a new `CHUNKER_VERSION`)
makes every document stale; the same command re-embeds them. `/admin/research` shows how
many manuals are searchable, text only, scanned, failed or still processing, and a
resource row's **Re-process** in the tool editor rebuilds one manual. Storage: roughly
2 KB of vector plus ~1.5 KB of text a passage — a 150-page manual is ~200 passages; watch
Neon's allowance before backfilling hundreds of manuals.

## Stage 3 · Sign-in (15 minutes)

Google Cloud Console → **OAuth 2.0 Client ID (Web)** → authorized redirect URI exactly:

```
http://localhost:3000/api/auth/callback/google
```

```bash
AUTH_SECRET=              # openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_BASE_URL=http://localhost:3000
AUTH_ALLOWED_EMAIL_DOMAIN=cornell.edu
AUTH_SUPER_ADMIN_EMAILS=you@cornell.edu   # the floor — see below
```

`AUTH_SECRET` alone is enough for sessions; the two `GOOGLE_*` variables are
what make *starting* one possible. With them unset, `/api/auth/sign-in/social`
answers 503 and the header says sign-in is not set up here.

`AUTH_SUPER_ADMIN_EMAILS` is a **floor, not a roster**. Everyone else's role is
the `user.role` column, changed on `/admin/users`; an address listed here is
created as `super_admin` on first sign-in and stays one whatever its row says.
It is the only way the first super admin comes to exist (no user row exists
until somebody signs in) and the reason the lab cannot lock itself out.
`AUTH_STAFF_EMAILS` and `AUTH_ADMIN_EMAILS` were removed in Phase 4 — nothing
reads them, so delete them from the deployment's environment rather than
leaving a list that grants nothing.

Tickets and projects now record the **verified session** instead of a typed name. Anonymous
browsing and chat keep working — sign-in unlocks, it does not gate the front door.

### Stage 3b · Skip Google while developing (optional, local only)

Signing in through Google on every `npm run dev` restart gets old. With
`AUTH_SECRET` set, add to `.env.local`:

```bash
DEV_AUTO_SIGN_IN=1
DEV_AUTO_SIGN_IN_EMAIL=you@cornell.edu   # optional: who "Sign in as (dev)" makes you
```

Then visit `http://localhost:3000/api/dev/sign-in` (or click **Sign in as (dev)** beside
the header's Sign in control), or name somebody else to see their experience:
`/api/dev/sign-in?as=student@cornell.edu&next=/tools/form-4`. It creates a real database
session — the user row too if it is missing, with the role a first Google sign-in would
give — and records `auth.dev_sign_in` in the audit trail. `next` must be a path on this
site; anything else goes to `/`.

It answers **404** unless every guard holds: `next dev` (not `next build` / `next start`),
no `VERCEL`, `DEV_AUTO_SIGN_IN=1` exactly, a request to `localhost` / `127.0.0.1` carrying
no forwarded visitor address (so an ngrok or Cloudflare tunnel to your dev server cannot
use it), and an address that may sign in and is not banned.

> [!CAUTION]
> **Never set `DEV_AUTO_SIGN_IN` or `DEV_AUTO_SIGN_IN_EMAIL` in production** — not on
> Vercel, not in any deployment's environment. A Vercel build with `DEV_AUTO_SIGN_IN` set
> fails on purpose; a local `next build` warns that it is inert.

## Stage 4 · The nightly job locally (optional)

Cron does not run locally. Trigger it by hand:

```bash
curl -H "x-admin-secret: $ADMIN_REVALIDATE_SECRET" \
     http://localhost:3000/api/cron/daily
```

It exports every Postgres table to a private blob and sweeps photos that were uploaded but
never attached to anything. It needs a Blob store and refuses without one — the old
`/api/admin/backup` route it replaces dumped Notion and is no longer scheduled.

**Blob on a laptop.** With no `BLOB_READ_WRITE_TOKEN`, `npm run dev` does not refuse
uploads: every Blob read and write goes to `v5/.blob-data/` (git-ignored), a folder that
behaves like the real store — private and public files, random upload pathnames, copies to
public, list and delete. Photo uploads, chat photos, pending-tool photo promotion,
archived manual PDFs, this backup and the orphan sweep all work. Public files are served
by `GET /api/dev-blob/[...path]` at `AUTH_BASE_URL` (default `http://localhost:3000`);
private ones are never served. Set `BLOB_LOCAL_DISABLE=1` to get the old "uploads are
unavailable" behaviour back. The rule lives in `v5/src/lib/blob-mode.ts`: a token means
Vercel Blob; on Vercel (`VERCEL`) or in a production build without one there is **no**
store and no disk fallback, and `/api/dev-blob/…` answers 404. The Notion import into
`DATABASE_URL` still insists on a real token, because its rows go to a shared database; an
import into a local `PGLITE_DATA_DIR` database uses this store (see Stage 2b).

Two tables are held out of the file on purpose: `session` and `verification` are sign-in
credentials, not records, and the Google tokens on `account` are blanked. A backup is
something you might email to yourself at 2am; it must not double as a way to sign in as
somebody. People, roles and bans are all still in there.

---

# Part 2 — A new deployment on Vercel

> Written as it was done, 2026-09-26, creating `makerlab-ai` for a first review by lab staff.
> Steps marked *(to confirm)* are the plan and get rewritten with what actually happened.

The hosted copy starts from **your local inventory**, not from Notion: everything reviewed
locally (display names, descriptions, research picks, photos, English links, indexed manuals)
is copied up in step 5. Keep working locally afterwards and push again when ready.

## 1 · Create the project

Vercel → **Add New… → Project** → import `philosophercode/makerlab-tools`, branch `main`.

| Field | Value |
|---|---|
| Vercel Team | Your team. Hobby is fine for a review copy; for the lab's real launch use a Pro or university team (Hobby is for non-commercial personal use) |
| Project Name | `makerlab-ai` — this becomes `makerlab-ai.vercel.app` |
| Application Preset | Next.js |
| **Root Directory** | **`v5`** — the one setting people miss. (Once the repo is flattened to v5 only, this becomes `./`.) |
| Build and Output Settings | Defaults. The app's `build` script runs `db:migrate`, then `next build` |
| Environment Variables | **Remove any "detected" ones** — they come from the old v4 example file. Add the real ones in step 4 |

Press **Deploy**. With no database yet the build skips the migration ("DATABASE_URL is not
set; no migrations to run") and the site runs on its built-in demo data. That is expected: it
gives you a working address for Google sign-in.

## 2 · Storage *(to confirm)*

Project → **Storage**:

- **Neon Postgres** (Marketplace) → connect to the project, all environments. Adds `DATABASE_URL`.
- **Blob — two stores.** A Blob store is now either all-public or all-private, and the app keeps
  both kinds of file, so it needs one of each (data platform spec, amendment 2026-09-27):
  1. **Public store** → create it with access **Public**, connect it to the project with the
     **default** environment-variable prefix, all environments. Adds `BLOB_STORE_ID`,
     `BLOB_READ_WRITE_TOKEN` and `BLOB_WEBHOOK_PUBLIC_KEY`. Tool photos, manuals, research
     images and project photos go here.
  2. **Private store** → create it with access **Private**, connect it with the **custom prefix
     `BLOB_PRIVATE`**, all environments, and tick **"Add a read-write token"**. Adds
     `BLOB_PRIVATE_STORE_ID`, `BLOB_PRIVATE_READ_WRITE_TOKEN` and
     `BLOB_PRIVATE_WEBHOOK_PUBLIC_KEY`. The nightly backup (it holds user emails), chat,
     maintenance and import uploads, and research's cleaned copies go here. The token matters:
     scripts run from a laptop have no OIDC token, and without one the store id alone falls back
     to the public store, which refuses private files.

  Redeploy after connecting — environment variables reach a deployment only when it is built.
  With only one store (no `BLOB_PRIVATE_*`) the app puts both kinds in it, as before — fine for
  an older store that accepts both, but a store created today refuses one kind. The routing is
  `blobCredentials()` in `src/lib/blob-mode.ts`.

## 3 · Google sign-in *(to confirm)*

Google Cloud console → APIs & Services → Credentials → your OAuth client (or a new *Web
application* client) → **Authorized redirect URIs** → add
`https://makerlab-ai.vercel.app/api/auth/callback/google`.

## 4 · Environment variables *(to confirm)*

Project → Settings → Environment Variables (Production and Preview):

```
AUTH_SECRET                 openssl rand -base64 32
AUTH_BASE_URL               https://makerlab-ai.vercel.app
GOOGLE_CLIENT_ID            from step 3
GOOGLE_CLIENT_SECRET        from step 3
AUTH_SUPER_ADMIN_EMAILS     your Google address — the first super admin; everyone else gets roles on /admin/users
AUTH_ALLOWED_EMAILS         reviewers' addresses (or AUTH_ALLOWED_EMAIL_DOMAIN for a whole domain)
CRON_SECRET                 any long random string (the nightly job)
ADMIN_REVALIDATE_SECRET     any long random string (cache refresh, hand-run nightly job)
```

Model calls need no key on Vercel: the AI Gateway authenticates the project itself (OIDC).
Notion variables are **not** needed — Notion is only a one-way mirror now, off until you turn it on.

## 5 · Copy the local inventory up *(to confirm — script being written)*

Copies the local database (`v5/.pglite-data`) into Neon and the local files (`v5/.blob-data`:
tool photos, manual PDFs) into Blob, so the hosted site matches `localhost:3001`, manuals
already searchable. Re-runnable: each run **replaces** the hosted data, so while the site is
review-only, make changes locally and push again.

## 6 · Redeploy and check *(to confirm)*

Deployments → latest → **Redeploy** (so the build migrates Neon), then in order:

1. **`/api/health`** → `200`.
2. **Sign in** with the super-admin address; a non-allowed address is refused with an explanation.
3. **A tool page** shows its photo, short description and links; manuals the assistant can
   search carry the search icon.
4. **Ask a manual question** on a tool with that icon: the answer cites a page (`p. N`) that
   opens the lab's stored PDF.
5. **Trigger the nightly job by hand** (`ADMIN_REVALIDATE_SECRET`) and confirm a backup appears in Blob.

## 7 · Give reviewers access *(to confirm)*

They sign in with Google (their address must be allowed in step 4), then you set their role on
**/admin/users**. If a reviewer is asked to log in to *Vercel* before seeing the site, turn off
**Vercel Authentication** under Settings → Deployment Protection; the app's own sign-in still
guards everything that needs it.

## 8 · The safety net — do not skip

**Set an inference spend limit and alert, on the Gateway itself.** Inference is the only cost
here that scales with use, and the only one that can run away. This is the main practical
reason to route everything through the Gateway rather than a provider directly: the ceiling is
enforced by the platform (Vercel dashboard → **AI Gateway** → **Budgets**), not by remembering
to check a bill, and it applies across every model and every job the app calls, not just chat.

**Point an uptime monitor at `/api/health`** and **alert on the HTTP status code, not the
body.** The 503-when-degraded contract is the entire point; a body-only check would miss it.
Send alerts to a shared address, never one person.

---

# What only a person can do

| | Blocks |
|---|---|
| Google OAuth client | Sign-in anywhere |
| `AUTH_SUPER_ADMIN_EMAILS` | The first super admin, and therefore **every role**: nobody can be promoted until somebody can reach `/admin/users`. Roles live in `user.role` now; `AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` are retired and should be deleted from the environment |
| Vercel Blob store | **Photo uploads** (chat, maintenance, projects) and backups. Without it uploads refuse with a translated message rather than failing silently |
| Vercel Blob + `CRON_SECRET` | The nightly backup — **there is currently no backup at all** |
| Inference spend limit | Nothing, until it does |
| Uptime monitor | Nothing, until something breaks quietly |

**Two decisions, not tasks:**

- **Is student email in Notion acceptable to the university?** It affects tickets, projects,
  and corrections alike.
- **Photo consent** for student work in a public gallery.

**One with a deadline:** `RATE_LIMIT_ANON_CHAT` for ISAM. Conference wifi puts every visitor
behind one NAT'd IP, so the default of 8/hour would be exhausted minutes after the demo
opens. Raise it, or use a shared demo account.

---

# Troubleshooting

| Symptom | Cause |
|---|---|
| Machines the lab does not own | A `NOTION_DB_*` is missing. Check `/api/health` and the logs for `Falling back to mock catalog`. |
| A tool is missing from the site | `published` unticked, or the cache has not refreshed — the catalogue caches for 24h; use the Refresh button or `/api/admin/revalidate`. |
| A field is empty on the site but filled in Notion | Someone renamed the Notion property. The parser tolerates snake_case and Title Case, but not a rename. |
| Corrections fail silently | The Flags `status` select has no `New` option. |
| Assistant errors | Check the Gateway spend limit first (a capped budget answers like an outage), then `MODEL_*`/`EVAL_MODEL` for a malformed id (`ModelConfigError` names the variable), then the Gateway's own status. The catalogue keeps working — they fail independently. |
| `test:all` fails to start E2E | `npm run dev` is still running and holding `.next/dev/lock`. |
| Bad deploy | Vercel → Deployments → last good one → **Promote to Production**. Roll back first, diagnose after. |
