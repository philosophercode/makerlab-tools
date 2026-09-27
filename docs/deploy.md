# Setup & Deploy

> How to run MakerLab Tools on your machine, and how to host it on Vercel.
>
> How it works: [`architecture-guide.md`](architecture-guide.md).
> How to operate it once live: [`handover.md`](handover.md). Monitoring, backups and
> restore: [`operations.md`](operations.md).

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

A crimson **DEMO DATA** banner appears. That is correct: with no `DATABASE_URL` the app
runs on an in-process Postgres (PGlite) seeded with two sample tools, and the banner exists
so nobody mistakes it for the lab's real inventory.

Working already: catalogue browse and search, facets, grid ⇄ table, tool detail pages,
`/projects`, the 12-language switcher, photo uploads (into `v5/.blob-data/`),
`/api/health` (`200` with `"catalog": "demo"`), and `npm run qr:labels`.

```bash
npm run test:all       # lint, typecheck, vitest, playwright — no credentials needed
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

Restart. **This is the biggest single unlock** — the assistant goes live against the demo
catalogue, which is enough to exercise most of the product:

| Try | What it exercises |
|---|---|
| From the gallery: *"I need to cut 6mm plywood"* | `search_tools`, project scoping |
| From a tool page: *"How do I replace the filament?"* | Manual-grounded answers |
| Ask in Spanish | Replies in the language asked |
| **REPORT** in the nav | Troubleshoots first, then offers to file |
| *"Do you have a waterjet?"* | Honest absence — it must not invent one |
| **ADD**, signed in as an admin (Stage 3b), paste a product URL | Intake: identify, then background research into a draft |

`npm run eval` runs the agent eval harness. It makes **real, paid** model calls and is
deliberately outside `test:all` — see `v5/evals/README.md`, including the §10 eval gate
to run before pointing production at a different model.

## Stage 2 · Real data: import the Notion inventory locally (30–45 minutes)

The lab's inventory was kept in Notion until September 2026. Postgres is the source of truth
now; Notion is read **once**, by `npm run import:notion`, and never again by the app. A new
lab with no Notion data skips this stage and adds equipment through intake instead.

Share the Notion databases with an integration and set in `.env.local`:

```bash
NOTION_API_KEY=ntn_...
NOTION_DB_TOOLS=...            NOTION_DB_CATEGORIES=...
NOTION_DB_LOCATIONS=...        NOTION_DB_UNITS=...
NOTION_DB_RESOURCES=...        NOTION_DB_MAINTENANCE_LOGS=...
NOTION_DB_FLAGS=...
NOTION_DB_PROJECTS=...         # optional — the projects gallery's old source
```

### Stage 2b · Import into a local database and review it

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
PGLITE_DATA_DIR=.pglite-data npm run dev -- -p 3001          # review it in the app
```

(Or put `PGLITE_DATA_DIR=.pglite-data` in `.env.local` and drop the prefix.) Each script
prints its target and where files go. Without `BLOB_READ_WRITE_TOKEN`, files are copied into
`.blob-data/` and their URLs point at `AUTH_BASE_URL/api/dev-blob/…` — so set
`AUTH_BASE_URL` to the dev server's real origin (e.g. `http://localhost:3001`) before
importing. Re-running the import is idempotent; to start over, stop the dev server and
delete `.pglite-data/` (both it and `.blob-data/` are ignored by version control).

Review and edit locally — display names, descriptions, research picks, photos, manuals —
then copy the result to a hosted deployment with `npm run data:push` (Part 2, step 6).
That is how `makerlab-ai` was filled.

**Alternative: import straight into Neon.** Import from Notion, not from the local
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
AUTH_ALLOWED_EMAILS=                      # optional: named exceptions on other domains
AUTH_SUPER_ADMIN_EMAILS=you@cornell.edu   # the floor — see below
```

Only addresses on `AUTH_ALLOWED_EMAIL_DOMAIN` may sign in, plus any listed by name in
`AUTH_ALLOWED_EMAILS` (a maintainer whose institutional account is temporary, say). Anyone
else lands on a page explaining the domain rule.

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

It exports every Postgres table to a private blob, prunes old backups on tiers (daily for a
week, then weekly, monthly and quarterly to three years), and sweeps photos that were uploaded
but never attached to anything. It needs a Blob store and refuses without one.

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

Some tables are held out of the file on purpose: `session` and `verification` are sign-in
credentials, not records, and the Google tokens on `account` are blanked. A backup is
something you might email to yourself at 2am; it must not double as a way to sign in as
somebody. People, roles and bans are all still in there. The manual search tables
(`manual_pages`, `manual_chunks`) are left out too, because they are rebuilt from the stored
PDFs: after a restore, run `npm run manuals:index -- --force` from `v5/`
([`operations.md`](operations.md#restoring)).

---

# Part 2 — A new deployment on Vercel

> Written from what worked creating `makerlab-ai` (<https://makerlab-ai.vercel.app>),
> September 2026. Variable names are the ones `v5/src` reads; `v5/.env.example` explains
> each one.

The hosted copy starts from **your local inventory**, not from Notion: everything reviewed
locally (display names, descriptions, research picks, photos, English links, indexed
manuals) is copied up with `npm run data:push` in step 6. Keep working locally afterwards
and push again when ready — while the site is review-only.

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
set; no migrations to run") and the site runs on its built-in demo data. That is expected:
it gives you a working address for Google sign-in.

## 2 · Storage: Neon and two Blob stores

Project → **Storage**:

- **Neon Postgres** (Marketplace) → connect to the project, all environments. Adds
  `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`, which `data:push` prefers).
- **Blob — two stores.** A Blob store is either all-public or all-private, and the app
  keeps both kinds of file, so it needs one of each:
  1. **Public store** → create it with access **Public**, connect it with the **default**
     prefix, all environments. Adds `BLOB_STORE_ID` and `BLOB_READ_WRITE_TOKEN`. Tool
     photos, manuals, research images and project photos go here.
  2. **Private store** → create it with access **Private**, connect it with the **custom
     prefix `BLOB_PRIVATE`**, all environments, and tick **"Add a read-write token"**. Adds
     `BLOB_PRIVATE_STORE_ID` and `BLOB_PRIVATE_READ_WRITE_TOKEN`. The nightly backup (it
     holds user emails), maintenance and chat uploads, and research's private copies go
     here.

The app reads exactly these names: the public store as `BLOB_STORE_ID` or
`BLOB_READ_WRITE_TOKEN`, the private one as `BLOB_PRIVATE_STORE_ID` or
`BLOB_PRIVATE_READ_WRITE_TOKEN` (`blobCredentials()` in `v5/src/lib/blob-mode.ts`). On
Vercel a store id is enough — the deployment's OIDC token authenticates it.

**If a store was connected with a different prefix** (or was already connected to another
project under another name), the app does not see it. Add the two store ids under the
names the app reads, with the ids from each store's page (`store_…`):

```bash
cd v5
vercel link                                   # once, if v5/ is not linked yet
vercel env add BLOB_STORE_ID production       # paste the public store's id
vercel env add BLOB_PRIVATE_STORE_ID production   # paste the private store's id
```

Repeat with `preview` if previews should upload too. With no `BLOB_PRIVATE_*` at all the
app puts both kinds of file in the default store — fine for an older store that accepts
both, but a store created today refuses one kind.

## 3 · Google sign-in

Google Cloud console → APIs & Services → Credentials → your OAuth client (or a new *Web
application* client) → **Authorized redirect URIs** → add
`https://makerlab-ai.vercel.app/api/auth/callback/google`.

## 4 · Environment variables

Project → Settings → Environment Variables (Production, and Preview if you use previews).
**Every value must be real** — not a placeholder from `.env.example`
(`YourSecretHere`, `http://localhost:3000`) and not left blank:

```
AUTH_SECRET                 openssl rand -base64 32
AUTH_BASE_URL               https://makerlab-ai.vercel.app   (the real origin, no trailing slash)
GOOGLE_CLIENT_ID            from step 3
GOOGLE_CLIENT_SECRET        from step 3
AUTH_ALLOWED_EMAIL_DOMAIN   cornell.edu
AUTH_ALLOWED_EMAILS         optional: named addresses on other domains, comma-separated
AUTH_SUPER_ADMIN_EMAILS     permanent Cornell addresses of the super admins, comma-separated
CRON_SECRET                 any long random string (the nightly job)
ADMIN_REVALIDATE_SECRET     any long random string (cache refresh, hand-run nightly job)
CRON_HEARTBEAT_URL          optional: a heartbeat monitor's ping URL (operations.md)
```

- **Sign-in is Cornell-only.** Only `@cornell.edu` addresses (plus anyone named in
  `AUTH_ALLOWED_EMAILS`) can sign in; anyone else is shown why.
- **Super admins** are the addresses in `AUTH_SUPER_ADMIN_EMAILS`: created as
  `super_admin` on first sign-in and always resolved as one, so the lab cannot lock itself
  out. Everyone else's role is set on the **People** page (`/admin/users`).
- Model calls need **no key** on Vercel: the AI Gateway authenticates the project itself
  (OIDC). Notion variables are **not** needed — Notion is read only by the one-time import
  and receives a mirror only if an admin connects one on `/admin/mirror`.
- **Never** set `DEV_AUTO_SIGN_IN` or `DEV_AUTO_SIGN_IN_EMAIL` here (the build fails if
  you do), nor `PGLITE_DATA_DIR`.

## 5 · Redeploy — after every variable change

Deployments → latest → **Redeploy**. Environment variables reach a deployment only when it
is built, so a variable added or changed in steps 2–4 does nothing until you redeploy. The
build also runs `db:migrate`, which creates the schema in Neon — `data:push` in step 6
needs that.

## 6 · Copy the local inventory up

Copies the local database (`v5/.pglite-data`) into Neon and the local files
(`v5/.blob-data`: tool photos, manual PDFs, private uploads) into the two Blob stores, so
the hosted site matches your local review, manuals already searchable.

Before you start: the project has deployed **with Neon connected** since the last
migration (step 5), you have checked out the same commit, and the local dev server is
**stopped** (the local database is single-process).

**Get the production credentials into a file.** Start with a pull:

```bash
cd v5
vercel env pull .env.hosted --environment=production
```

Values marked **Sensitive** come back **blank** from `vercel env pull` — on a production
deployment that is typically `DATABASE_URL` and the Blob tokens. When they do, copy them
from the dashboard instead: Project → **Storage** → the Neon database → **`.env.local`**
tab → *Show secret* → *Copy snippet*, and **append** it to the pulled file (use `>>`, not
`>` — overwriting would drop the `VERCEL_OIDC_TOKEN` the pull wrote; a later line wins over
the blank one the pull left):

```bash
pbpaste >> .env.hosted                 # Neon: DATABASE_URL, DATABASE_URL_UNPOOLED, …
```

and the same for each Blob store (its `.env.local` snippet):

```bash
pbpaste >> .env.hosted                 # public store: BLOB_READ_WRITE_TOKEN, BLOB_STORE_ID
pbpaste >> .env.hosted                 # private store: BLOB_PRIVATE_READ_WRITE_TOKEN, BLOB_PRIVATE_STORE_ID
```

The script needs `DATABASE_URL` (or `DATABASE_URL_UNPOOLED`) and, for Blob,
`BLOB_READ_WRITE_TOKEN` — or `BLOB_STORE_ID` plus a `VERCEL_OIDC_TOKEN` from a recent pull
(it lasts about 12 hours). For the private store, use its **read-write token**
(`BLOB_PRIVATE_READ_WRITE_TOKEN`): a laptop has no OIDC token of its own. Nothing from the
file is printed.

**Then rehearse, and run:**

```bash
PGLITE_DATA_DIR=.pglite-data npm run data:push -- --to .env.hosted --dry-run
PGLITE_DATA_DIR=.pglite-data npm run data:push -- --to .env.hosted --yes
```

Then **delete `.env.hosted` yourself** — it holds the production database password and
Blob tokens. (`v5/.gitignore` ignores `.env*`, but it should not sit on disk.)

What `npm run data:push` (`v5/scripts/push-local-to-hosted.ts`) does:

- **Dry run** (`--dry-run`): connects read-only to both sides and prints each table's row
  count (local vs. hosted now), how many files it will upload and how many an earlier push
  already stored, and any problem. It writes nothing. A real run needs `--yes`.
- **It replaces the hosted data.** Every app table on the hosted side is emptied and
  refilled from the local database. Anything created on the hosted site since the last push
  is lost — so while the site is review-only, make changes locally and push again.
- **It ends every hosted sign-in.** Sessions, OAuth handshakes and MCP access tokens are
  never copied; people sign in again. Users, roles, titles and blocks are copied; Google's
  OAuth tokens, the Notion mirror's token and OAuth client secrets are blanked.
- **Schema check.** It never migrates. The checkout, the local database and the hosted one
  must all be at the same latest migration; otherwise it refuses and says which is behind
  (redeploy the matching commit, or `npm run db:migrate` locally).
- **Files first.** Every `attachments` row served from the local store (`/api/dev-blob/…`,
  or a private file in `.blob-data/`) is uploaded to the store for its access — public
  files to the public store, private files to the private one — with a random suffix, and
  its pathname and URL are rewritten in the **hosted copy only**. A file an earlier push
  already uploaded (same attachment, access and size on the hosted side) is reused rather
  than stored again; everything else is uploaded. Bundled `/tool-images/…` need nothing.
  If an upload fails, the database has not been touched; the files already uploaded are
  listed. A local URL whose file is gone from `.blob-data/` stops the run
  (`--allow-missing-files` copies those rows as they are).
- **Then one transaction.** Tables are refilled parents first, ids, timestamps, jsonb and
  manual embeddings exactly as they are. Any failure rolls the whole thing back.

## 7 · Check it

1. **`/api/health`** → `200`, `"catalog": "live"`.
2. **Sign in** with a super-admin address; a non-Cornell address is refused with an
   explanation.
3. **A tool page** shows its photo, short description and links; manuals the assistant can
   search carry the search icon.
4. **Ask a manual question** on a tool with that icon: the answer cites a page (`p. N`)
   that opens the lab's stored PDF.
5. **Trigger the nightly job by hand** and confirm a backup appears in the **private**
   store:
   `curl -H "x-admin-secret: $ADMIN_REVALIDATE_SECRET" https://makerlab-ai.vercel.app/api/cron/daily`

## 8 · Give people access

They sign in with their Cornell Google account, then a super admin sets their role on the
**People** page (`/admin/users`): Student (`user`), Supermaker (`admin`) or Super Admin
(`super_admin`). The same page sets a person's **title** — shown on the People page and in
their profile menu; blank falls back to the role's name. If people are asked to log in to
*Vercel* before seeing the site, turn off **Vercel Authentication** under Settings →
Deployment Protection; the app's own sign-in guards everything that needs it.

## 9 · The safety net — do not skip

**Set an inference spend limit and alert, on the Gateway itself** (Vercel dashboard → **AI
Gateway** → **Budgets**). Inference is the only cost here that scales with use, and the
only one that can run away; the Gateway limit applies across every model and job the app
calls, not just chat.

**Point an uptime monitor at `/api/health`** and **alert on the HTTP status code, not the
body.** The 503-when-degraded contract is the entire point; a body-only check would miss it.
Send alerts to a shared address, never one person.

**Give the nightly job a heartbeat** (`CRON_HEARTBEAT_URL`), so a backup that fails — or never
runs — sends an email instead of waiting in the cron log. Services, intervals and settings for
all of this: [`operations.md` → Monitoring](operations.md#monitoring).

---

# What only a person can do

| | Blocks |
|---|---|
| Google OAuth client | Sign-in anywhere |
| `AUTH_SUPER_ADMIN_EMAILS` | The first super admin, and therefore **every role**: nobody can be promoted until somebody can reach `/admin/users` |
| Two Vercel Blob stores | **Photo uploads** (chat, maintenance, projects), research photos, archived manuals and backups. Without them uploads refuse with a translated message rather than failing silently |
| Private Blob store + `CRON_SECRET` | The nightly backup |
| Inference spend limit | Nothing, until it does |
| Uptime monitor + nightly heartbeat | Nothing, until something breaks quietly ([`operations.md`](operations.md)) |

**Two decisions, not tasks:**

- **Student data.** Tickets, corrections and projects record the signed-in reporter's name
  and email in Postgres and the nightly backup; confirm that is acceptable to the
  university, and whether names may go to a Notion mirror.
- **Photo consent** for student work in a public gallery.

**One with a deadline:** `RATE_LIMIT_ANON_CHAT` for ISAM. Conference wifi puts every visitor
behind one NAT'd IP, so the default of 8/hour would be exhausted minutes after the demo
opens. Raise it, or use a shared demo account.

---

# Troubleshooting

| Symptom | Cause |
|---|---|
| The **DEMO DATA** banner on a deployment | `DATABASE_URL` is not set for that environment, or was added without a redeploy. |
| A page errors or `/api/health` answers 503 | Postgres is unreachable — check Neon under Storage and the logs for `DbUnavailableError`. The site never falls back to demo data when a database is configured. |
| A tool is missing from the site | It is unpublished (`/admin/inventory`), or the cache has not refreshed — use the header's Refresh control or `/api/admin/revalidate`. |
| Photo uploads say they are unavailable | No Blob store is linked under a name the app reads (step 2), or the variables were added without a redeploy. |
| A private upload or the backup fails, public ones work | The private store is not linked as `BLOB_PRIVATE_*`, so private files went to the public store, which refuses them (step 2). |
| `data:push` says the env file has no `DATABASE_URL` / no Blob credentials | Sensitive values came back blank from `vercel env pull`; copy them from the dashboard (step 6). |
| Sign-in fails right after deploying | `AUTH_BASE_URL` is a placeholder or the wrong origin, or the Google redirect URI does not match it exactly. |
| Assistant errors | Check the Gateway spend limit first (a capped budget answers like an outage), then `MODEL_*`/`EVAL_MODEL` for a malformed id (`ModelConfigError` names the variable), then the Gateway's own status. The catalogue keeps working — they fail independently. |
| `test:all` fails to start E2E | `npm run dev` is still running and holding `.next/dev/lock`. |
| Bad deploy | Vercel → Deployments → last good one → **Promote to Production**. Roll back first, diagnose after. |
