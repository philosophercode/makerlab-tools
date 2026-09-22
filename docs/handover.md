# Handover & Operations Guide

> For whoever runs MakerLab Tools at the Cornell Tech MakerLAB. It covers accounts, keys,
> routine tasks, and what to do when something breaks.
>
> You do **not** need to be able to write code to use most of this guide. The sections that
> need a developer are marked **[dev]**.
>
> How the code works is in [`architecture-guide.md`](architecture-guide.md).

---

## 1. What this system is, in operational terms

A website that lists the lab's machines and answers questions about them. The data lives in
**Postgres** (Neon, provisioned through Vercel) and the website reads from there, with an AI
assistant on top. **The website no longer reads Notion.** Notion was the source of truth
before this phase; its seven databases were read once, by a developer, to move everything
into Postgres, and are not read again. A one-way mirror back into an admin's own Notion
workspace is planned for a later phase.

**There is no admin login or dashboard yet, so there is currently no way to edit the
catalogue from the website.** Editing the old Notion databases no longer has any effect —
the website stopped reading them. Until inventory editing ships on the website, a wrong
record needs a developer **[dev]** to fix directly in Postgres.

Three moving parts, and it is worth knowing which is which when something is wrong:

| Part | What it is | Who provides it |
|---|---|---|
| **The website** | The app itself | Hosted on Vercel |
| **The data** | Tools, units, categories, locations, resources, tickets, projects | Neon Postgres (provisioned through Vercel) |
| **Files** | Tool images, manuals, project photos | Vercel Blob |
| **The assistant** | The AI | Anthropic API (Claude) |

---

## 2. Accounts and keys — fill this in at handover

**This section is the handover.** Until it is filled in with real names, the system has no
owner.

| Thing | Where | Who owns it | Notes |
|---|---|---|---|
| Vercel project | vercel.com | ⬜ **TBD** | Hosting, deploys, env vars, logs |
| Neon Postgres | Vercel → Storage → Marketplace | ⬜ **TBD** | **The catalogue's source of truth.** Provisioned through the Vercel Marketplace; sets `DATABASE_URL` automatically |
| Notion workspace | notion.so | ⬜ **TBD** | The seven original databases. No longer read by the website — kept for reference until a one-way mirror is set up |
| Notion integration token | Notion settings | ⬜ **TBD** | `NOTION_API_KEY`. Needed only to re-run the one-time import; not required for the website to run |
| `AI_GATEWAY_API_KEY` | Vercel → AI Gateway | ⬜ **TBD** | **The intended production path.** Model spend on the hosting invoice, with a platform spend limit |
| Anthropic API key | console.anthropic.com | ⬜ **TBD** | **Fallback.** Costs money per use. Keep it — it is the lever back if the gateway fails |
| GitHub repository | github.com | ⬜ **TBD** | The code |
| Domain / DNS | ⬜ | ⬜ **TBD** | |
| `ADMIN_REVALIDATE_SECRET` | Vercel env vars | ⬜ **TBD** | Forces the site to refresh |
| Vercel Blob store | Vercel → Storage | ⬜ **TBD** | Holds tool images, manuals and project photos (public) alongside maintenance photos and the nightly backup (private). Sets `BLOB_READ_WRITE_TOKEN`. **The private files contain student PII — keep those private** |
| `CRON_SECRET` | Vercel env vars | ⬜ **TBD** | Lets the nightly backup cron prove it is Vercel (§3) |

> [!WARNING]
> **Inference is a live bill and the only cost here that scales with use.** Every question a
> student asks costs a small amount. Whichever path you run, it must be owned by the
> institution rather than an individual, and it must have a spend limit.

### Which model path to run

**Run the gateway.** Set `AI_GATEWAY_API_KEY` and every model call routes through the Vercel
AI Gateway: spend lands on the invoice you already pay, a platform-enforced ceiling replaces
a promise to watch the dashboard, and whoever operates the app can see usage without holding
the Anthropic key.

**Keep the Anthropic key anyway.** Set both and the gateway wins — but do not revoke the
direct one. It is a one-env-var lever back to a working assistant if the gateway has an
outage, if billing lapses, or if the model id turns out wrong during a demo. It costs nothing
to keep and it is the only fallback the app has.

> [!IMPORTANT]
> **The gateway path has never made a live call.** It is written and unit-tested, but nobody
> has held a key. The gateway spells model versions with dots (`anthropic/claude-sonnet-4.6`)
> where Anthropic's own API uses dashes, and the two are not interchangeable. **Send one
> message through a preview deploy before production.** A wrong id fails loudly with
> `GatewayModelNotFoundError` on the first request — it does not silently fall back.

> [!NOTE]
> Routing through the gateway means student questions, and any photos they attach, transit
> Vercel's infrastructure. That is a genuine change in data flow and worth an explicit answer
> from the university rather than an assumption.

Two things a person has to do, neither of which is code:

1. Create the key in the Vercel dashboard (**AI Gateway → API keys**) and **set a monthly
   spend limit and an alert threshold at the same time.** A key without a limit is the whole
   financial risk of this app in one credential.
2. Confirm with the university that routing student questions — and the photos they upload —
   through Vercel's infrastructure is acceptable. This is a real change in where data flows,
   not a formality.

The gateway path has never been exercised against a live gateway; see
[`specs/2026-07-29-ai-gateway-migration-design.md`](specs/2026-07-29-ai-gateway-migration-design.md)
for what remains to verify before production traffic goes through it.

---

## 3. Routine tasks

### Add a machine to the catalogue

> [!WARNING]
> **This no longer works.** The steps below edited Notion, which the website read. The
> website now reads Postgres and does not read Notion at all, and the on-website editor that
> replaces this is not built yet. Adding a machine today needs a developer **[dev]** to
> insert it directly in Postgres. Once inventory editing ships on the website, this section
> will be rewritten to match it.
>
> ~~1. In Notion, add a row to the **Tools** database.~~
> ~~2. Fill in at least: name, description, category, location.~~
> ~~3. Add units in the **Units** database, linked to the tool — one row per physical machine,
>    with serial and status.~~
> ~~4. Add manuals or SOPs to **Resources**, linked to the tool.~~
> ~~5. Tick **published**. Until you do, it will not appear on the site.~~
> ~~6. Wait a few minutes, or force a refresh (§4).~~

### Mark a machine out of service

> [!WARNING]
> **This no longer works** — editing Notion has no effect on the website (see above).
> ~~Change the unit's **status** in the Units database to `Under Maintenance` or `Out of
> Service`. The site shows it as offline, and the assistant stops recommending it.~~ Until
> inventory editing ships on the website, this needs a developer **[dev]** to change directly
> in Postgres.

### Handle a maintenance ticket

Tickets from the assistant land in the **`maintenance_logs`** table in Postgres, with photos
if the student attached any. Corrections students report land in **`feedback`**, and project
submissions in **`projects`** (unpublished until staff publish them). None of the three go
to Notion any more, and the admin queues that work them are a later phase — until then,
working a ticket (`status` → `in_progress` → `resolved`, plus `resolution`) needs a
developer **[dev]**.

Nothing in the app enforces this. **A ticket queue nobody reads is worse than no ticket
queue** — students stop reporting after a couple of unanswered reports. Decide who checks
it and how often, and write that down here:

> **Ticket owner:** ⬜ **TBD** · **Checked:** ⬜ **TBD**

### Fix something the assistant got wrong

Almost always a data problem, not an AI problem. The assistant answers from Postgres, so a
wrong answer usually means a wrong or empty field there — which, until inventory editing
ships on the website, needs a developer **[dev]** to fix directly. Editing the old Notion
record does nothing; the website does not read it.

If it is wrong *and* the underlying record is right, that is a real bug — see §6.

### Change branding, colours, or the assistant's name

Environment variables in Vercel, no code change: `NEXT_PUBLIC_SITE_NAME`,
`NEXT_PUBLIC_INSTITUTION`, `NEXT_PUBLIC_TAGLINE`, `NEXT_PUBLIC_LOGO`,
`NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_DARK`,
`NEXT_PUBLIC_CHAT_ASSISTANT_NAME`, and `AUDIENCE`. Full explanations in
`v5/.env.example`. Redeploy after changing them.

### Check the nightly backup is still running

**Every night at 07:17 UTC (about 03:17 New York) the site backs itself up.** Vercel Cron
calls `/api/cron/daily`, which exports **every Postgres table** and writes one file to
private Vercel Blob storage as `backups/YYYY-MM-DD.json`. Files older than **30 days** are
deleted by the same job, so the store holds roughly a month at any time. The same run also
deletes photos that were uploaded but never attached to anything within 24 hours.

**This is the only copy of the data outside Neon.** Before it existed, one deleted database
meant ~100 machines of staff work was gone for good.

> The job used to dump Notion at `/api/admin/backup`. Postgres is the source of truth now,
> so the file holds database rows and its `source` field reads `postgres`. A file written
> before September 2026 holds raw Notion pages instead.

Three settings in Vercel make it work, and it does nothing without all three:

| Setting | Where | What it is |
|---|---|---|
| A **Blob store** linked to the project | Vercel → Storage | Sets `BLOB_READ_WRITE_TOKEN` automatically. **Also required for photo uploads** — with no store, the chat and the project form say photo uploads are unavailable instead of failing silently |
| `CRON_SECRET` | Vercel env vars | Vercel sends it so the route knows the nightly call is genuine |
| `ADMIN_REVALIDATE_SECRET` | Vercel env vars | Lets a person trigger the job by hand (same secret as §4) |

**How to check it, once a month:** Vercel dashboard → your project → **Cron Jobs**. A green
run means a file was written. **A red run means the backup did not happen** — the route
deliberately fails loudly rather than reporting success, because a backup that fails quietly
is discovered on the day you need it. The failure reason is in the run's log.

To run one by hand, or to confirm it works after changing anything:

```
GET https://<your-site>/api/cron/daily
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
```

It answers with the file it wrote, how many rows came from each table, which old files it
deleted, and what the orphaned-photo sweep removed. Anything other than `200` is a real
failure, and the body names which stage broke.

> [!WARNING]
> **The backup contains student names and email addresses** from `maintenance_logs` and
> `feedback`. It is written to *private* blob storage and must stay that way — never make
> the store public, never share a download link, and list it in whatever data inventory the
> university keeps.
>
> It deliberately contains **no sign-in credentials**: the `session` and `verification`
> tables are skipped and the Google tokens on `account` are blanked, so somebody holding a
> backup file cannot use it to sign in as anybody. People, their roles and their bans *are*
> in it, because that is the state a restore most needs to get right.

**To restore:** download the file from Vercel → Storage → Blob. The file holds the table
rows as JSON, so a person can read it and rebuild from it. There is no automated restore, on
purpose — it is far more work than the failure justifies.
**[dev]** for anything beyond reading the file.

---

## 4. Forcing the site to refresh

The site caches catalogue data from Postgres for a few minutes. To make a change appear
immediately:

```
POST https://<your-site>/api/admin/revalidate
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
Body:   {"tag": "catalog"}
```

Any HTTP client works. If you would rather not use one, waiting a few minutes has the same
effect.

---

## 5. Monitoring — what to watch

| Where | What | How often |
|---|---|---|
| Anthropic console | **Spend.** Set a limit and an alert. | Weekly, at minimum |
| Vercel dashboard | Failed deploys, function errors | When something looks wrong |
| Vercel logs | `DbUnavailableError` (Postgres unreachable) | Whenever the catalogue looks odd |
| Vercel → Storage | The Neon database is reachable | Whenever the catalogue looks odd |
| Vercel → Cron Jobs | The nightly backup ran green | Monthly — see §3 |
| Postgres: `maintenance_logs` | Open tickets | Per §3 |

**The one alert that matters: an Anthropic spend threshold.** Everything else is
recoverable; an unbounded bill is not.

---

## 6. When something breaks

### The site shows machines the lab doesn't own

**Now much less likely, and it no longer fails silently.** Before this phase, the app fell
back to a built-in demo catalogue whenever it could not reach Notion, with no visible error.
That is no longer how a database problem shows up:

- If `DATABASE_URL` is missing from the Vercel project — a genuine misconfiguration — the
  site serves the same small built-in demo catalogue used in development and testing, and
  shows a banner saying so.
- If `DATABASE_URL` is set but Postgres cannot be reached, the site keeps serving whatever it
  last cached rather than switching to demo data, and any page that isn't cached shows an
  error instead of inventing machines.

1. Check the Vercel logs for `DbUnavailableError`.
2. Check `DATABASE_URL` is set in the Vercel project's environment variables.
3. Check the Neon dashboard (Vercel → Storage) — a suspended or deleted branch is the usual
   cause. **[dev]**

### A machine is missing from the site

Check `published` is set on the tool in Postgres. Then force a refresh (§4). Until inventory
editing ships on the website, changing `published` needs a developer **[dev]**.

### A field is empty on the site but filled in the old Notion databases

The website reads Postgres, not Notion, so this means the one-time import either mapped that
field differently than expected or the field has since been edited in Postgres. **[dev]**:
compare the row in Postgres against the Notion page it was imported from
(`notion_page_id` on the row) to see where the two diverge.

### The assistant is down or erroring

1. Check status.anthropic.com.
2. Check the Anthropic key has not expired or hit its spend limit.
3. Check Vercel logs for errors on `/api/chat`.

The catalogue keeps working while the assistant is down — they fail independently.

### The site is entirely down

Check the Vercel dashboard. A failed deploy leaves the previous version running, so a total
outage is usually a platform incident or a domain problem rather than a bad deploy.

### Rolling back a bad deploy

Vercel dashboard → Deployments → find the last good one → **Promote to Production**. No code
or command line required. Do this first and diagnose afterwards.

---

## 7. Making code changes **[dev]**

```bash
git clone <repo> && cd makerlab-tools/v5
npm install
npm run dev          # works with no credentials, using the demo catalogue
npm run test:all     # must pass before merging
```

Read [`docs/constitution.md`](constitution.md) first — it is short and it is the rules.
**Every feature starts with a spec in `docs/specs/` that merges before the code.**

The live app is `v5/`. The root `src/` directory is the old v4 app and is not used.

---

## 8. Setting this up for another lab **[dev]**

> Full step-by-step for a first deployment: [`deploy.md`](deploy.md).

Nothing about Cornell is hardcoded.

1. Deploy the repo to Vercel.
2. Add Neon Postgres and a Blob store to the project through the Vercel Marketplace /
   Storage tab — this sets `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` automatically. Run
   `npm run db:migrate` once to apply the schema.
3. Set `ANTHROPIC_API_KEY` (or `AI_GATEWAY_API_KEY`, §2).
4. **Only if migrating an existing Notion-based catalogue:** set `NOTION_API_KEY` and the
   seven `NOTION_DB_*` IDs, and run `npm run import:notion` once against the new database. A
   brand-new lab with no existing data skips this step entirely.
5. Override the `NEXT_PUBLIC_*` branding variables.
6. Replace the logo in `v5/public/`.

Full variable list with explanations: `v5/.env.example`.

---

## 9. Known limitations — say these out loud at handover

- **No sign-in yet.** The assistant is open to anyone with the URL. Specced, not built.
- **No catalogue editing on the website yet.** Postgres is the source of truth, but the
  admin inventory pages that let staff edit it there are a later phase (§6, §8). Until then, a
  wrong or missing record needs a developer.
- **The old silent fallback is fixed.** A configured-but-unreachable database now fails
  toward stale cached data or an explicit error, never toward invented equipment (§6).
- **No analytics.** There is no way to see which machines get asked about most. This is the
  main reason a successor project exists.
- **No backup beyond Notion's own version history.** Notion keeps page history; there is no
  separate export. Consider a periodic manual export of the databases.
- **One person built this.** That is the risk this document exists to reduce. If something
  here is unclear, that is a bug in the document — fix it while you still have someone to
  ask.

---

## 10. Open items at handover

- [ ] Fill in every owner in §2
- [ ] Set an Anthropic spend limit and alert
- [ ] Name a maintenance-ticket owner and cadence (§3)
- [ ] Confirm who can deploy and who administers the Vercel project
- [ ] Decide whether student email in Notion is acceptable to the university (see the auth
      spec's open questions)
- [ ] Agree a periodic Notion export for backup
