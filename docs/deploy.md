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

Create `v5/.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

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
deliberately outside `test:all`.

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
store and no disk fallback, and `/api/dev-blob/…` answers 404. The Notion import still
insists on a real token, because its rows go to a shared database.

Two tables are held out of the file on purpose: `session` and `verification` are sign-in
credentials, not records, and the Google tokens on `account` are blanked. A backup is
something you might email to yourself at 2am; it must not double as a way to sign in as
somebody. People, roles and bans are all still in there.

---

# Part 2 — On Vercel

## 1 · Create the project

Import the repo. **Set the root directory to `v5`** — this is the one setting people miss,
and without it the build picks up the frozen v4 app at the repo root.

Not the Hobby plan: it is for non-commercial personal projects, and it caps cron jobs.

## 2 · Environment variables

**Required:**

```
NOTION_API_KEY + all 7 NOTION_DB_*     the catalogue
AI_GATEWAY_API_KEY                     inference — the intended production path
ANTHROPIC_API_KEY                      the fallback; keep it configured
ADMIN_REVALIDATE_SECRET                cache invalidation
```

**Sign-in** — same as Stage 3, but `AUTH_BASE_URL=https://<your-domain>` and the Google
redirect URI updated to match.

**Blob store** — link one (it sets `BLOB_READ_WRITE_TOKEN`). It carries **both** jobs now:
every photo a student uploads through the chat or the project form, and the nightly backup.
Without it the site still runs — uploads say so and the catalogue is unaffected — but
nothing is backed up and no photo can be attached.

**Backups** — with the store linked, set `CRON_SECRET`. The cron is already in
`vercel.json`, nightly at 07:17, pointing at `/api/cron/daily`.

**`LAB_TIMEZONE`** — optional, defaults to `America/New_York`. It decides the date on a
maintenance ticket; a function running in UTC would otherwise date an evening report
tomorrow. Set it before the first ticket is filed, or leave it to the default.

**Optional** — `NOTION_DB_PROJECTS`, `UPSTASH_REDIS_REST_*` (rate limits enforced across
instances rather than per-process), `MCP_TOKEN` (also the switch that exposes write tools
over MCP; unset means read-only), `RATE_LIMIT_ANON_CHAT`, and the `NEXT_PUBLIC_*` branding
set.

## 3 · Deploy, then verify in this order

1. **`/api/health`** → `200`, `"catalog": "live"`. If `503`, a `NOTION_DB_*` is missing.
2. **No DEMO DATA banner.** If it is there, same cause.
3. **Send one chat message.** This is the first time the gateway path has ever made a live
   call — see the warning below.
4. **Sign in** with an institutional account, then confirm a non-institutional one is
   rejected with an explanation rather than an error.
5. **File a test ticket** and confirm it lands in Notion with your verified name.
6. **Trigger the backup by hand** and confirm a file appears in Blob.

> [!IMPORTANT]
> **The gateway has never made a live call.** It spells model versions with dots
> (`anthropic/claude-sonnet-4.6`) where Anthropic's API uses dashes, and the two are not
> interchangeable. **Test on a preview deployment before production.** A wrong id fails
> loudly with `GatewayModelNotFoundError` on the first request — it does not silently fall
> back, which is why step 3 is a real check and not a formality.

## 4 · The safety net — do not skip

**Set an inference spend limit and alert.** Inference is the only cost here that scales with
use, and the only one that can run away. This is the main practical reason to run the
gateway: the ceiling is enforced by the platform rather than by remembering to look.

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
| Assistant errors | Check the model key, then the spend limit, then status.anthropic.com. The catalogue keeps working — they fail independently. |
| `test:all` fails to start E2E | `npm run dev` is still running and holding `.next/dev/lock`. |
| Bad deploy | Vercel → Deployments → last good one → **Promote to Production**. Roll back first, diagnose after. |
