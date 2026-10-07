# Handover & Operations Guide

> For whoever runs MakerLab Tools at the Cornell Tech MakerLAB. It covers accounts, keys,
> routine tasks, and what to do when something breaks.
>
> You do **not** need to be able to write code to use most of this guide. The sections that
> need a developer are marked **[dev]**.
>
> How the code works is in [`architecture-guide.md`](architecture-guide.md); setting up a
> deployment is in [`deploy.md`](deploy.md).

---

## 1. What this system is, in operational terms

A website that lists the lab's machines and answers questions about them, at
<https://makerlab-ai.vercel.app>. The data lives in **Postgres** (Neon, provisioned through
Vercel); files live in **Vercel Blob**; an AI assistant sits on top. Staff manage everything
**in the app**, under **Admin** — the inventory, tickets, corrections, projects, new
equipment and people.

**Notion is no longer where the data lives.** The lab's old Notion databases were imported
once, in September 2026, and are not read again; editing them has no effect on the website.
An admin can connect a **one-way mirror** (`/admin/mirror`) that copies the inventory into
their own Notion workspace for reading.

| Part | What it is | Who provides it |
|---|---|---|
| **The website** | The app itself | Hosted on Vercel |
| **The data** | Tools, units, categories, locations, resources, tickets, corrections, projects, people | Neon Postgres (through Vercel) |
| **Files** | Tool photos, manuals, project photos (public store); maintenance photos, backups (private store) | Vercel Blob — two stores |
| **The assistant and research** | The AI models | Vercel AI Gateway (billed with hosting) |
| **Sign-in** | Google accounts, Cornell addresses only | A Google OAuth client |

**Who is who in the app.** Roles are set on **Admin → People** (`/admin/users`):

| Role | Shown as | May |
|---|---|---|
| `user` | Student | Browse, chat, report problems and corrections, submit projects |
| `admin` | Supermaker | Also edit the inventory, work the queues, add equipment, run research, manage the mirror |
| `super_admin` | Super Admin | Also manage people, roles, titles and allowances, and export the tools as a CSV (**Admin → Inventory → Export CSV**: every tool, the filtered ones, or the selected ones) |

Anyone not signed in can still browse and chat. A person's **title** (also set on People)
is only a label — it is what shows on the People page and in their profile menu.

---

## 2. Accounts and keys — fill this in at handover

**This section is the handover.** Until it is filled in with real names, the system has no
owner. The lab's owners are Niti Parikh (Director), Luis Rodrigo Navarro (Assistant
Director) and Isaac Steinberg (Tech Lead).

| Thing | Where | Who owns it | Notes |
|---|---|---|---|
| Vercel project `makerlab-ai` | vercel.com | ⬜ **TBD** | Hosting, deploys, env vars, logs, cron |
| Neon Postgres | Vercel → Storage | ⬜ **TBD** | **The source of truth.** Sets `DATABASE_URL` |
| Vercel Blob stores (two) | Vercel → Storage | ⬜ **TBD** | **Public** store (default prefix: `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN`) and **private** store (prefix `BLOB_PRIVATE`: `BLOB_PRIVATE_STORE_ID` / `BLOB_PRIVATE_READ_WRITE_TOKEN`). **The private store holds student PII — keep it private** |
| Vercel AI Gateway | Vercel → AI Gateway | ⬜ **TBD** | Every model call. Production uses the project's own OIDC identity — no key to rotate. **Set a budget** (§5) |
| Google OAuth client | console.cloud.google.com | ⬜ **TBD** | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; redirect URI `https://<site>/api/auth/callback/google` |
| Super admins | `AUTH_SUPER_ADMIN_EMAILS` in Vercel | ⬜ **TBD** | Permanent Cornell addresses. The lock-out guarantee |
| GitHub repository | `philosophercode/makerlab-tools` | ⬜ **TBD** | The code |
| Notion workspace | notion.so | ⬜ **TBD** | The old databases, kept for reference. `NOTION_API_KEY` is needed only to re-run the one-time import |
| Domain / DNS | ⬜ | ⬜ **TBD** | `makerlab-ai.vercel.app` until a custom domain is chosen |
| `ADMIN_REVALIDATE_SECRET` | Vercel env vars | ⬜ **TBD** | Forces a refresh; runs the nightly job by hand |
| `CRON_SECRET` | Vercel env vars | ⬜ **TBD** | Lets the nightly cron prove it is Vercel (§3) |
| `CRON_HEARTBEAT_URL` + heartbeat monitor | Vercel env vars; Healthchecks.io or Better Stack | ⬜ **TBD** | Emails the shared address when the nightly backup fails or does not run ([`operations.md`](operations.md)) |
| Uptime monitor on `/api/health` | UptimeRobot or Better Stack | ⬜ **TBD** | Emails the shared address when the site or database is down |
| Resend (staff email) + sending domain | Vercel Marketplace → Resend; the domain's DNS | ⬜ **TBD** | `RESEND_API_KEY` (injected), `EMAIL_FROM`, `EMAIL_REPLY_TO`. Ticket alerts and the 08:00 maintenance reminder. Resend processes staff addresses ([`architecture/notifications.md`](architecture/notifications.md)) |

> [!WARNING]
> **Inference is a live bill and the only cost here that scales with use.** Every question a
> student asks and every tool researched costs a small amount. It must be owned by the
> institution rather than an individual, and it must have a spend limit.

> [!NOTE]
> Student questions, and any photos they attach, transit Vercel's infrastructure on the way
> to the model provider. That is worth an explicit answer from the university rather than an
> assumption.

---

## 3. Routine tasks

### Add a machine

**Add equipment** (in the header, or **Admin → Intake**), as a Supermaker or above. Paste a
product link or a list, or photograph the label. The app identifies each item and
**researches it in the background** — official name, a short description, manuals, a clean
product photo. Open the result, correct anything wrong, and approve. The tool is created
**unpublished**; publish it from **Admin → Inventory** when it is ready. A long list goes
through **Import a list** on the Intake page.

### Edit a machine, or mark one out of service

**Admin → Inventory**, or **Edit** on the tool's own page. Units (the physical machines)
have their own status — set a unit to under maintenance or out of service and the site
shows it offline and the assistant stops recommending it. Changes appear immediately.

### Re-check a machine's details

**Admin → Refresh** re-runs research for tools already in the inventory and shows what it
would change, field by field, to accept or reject. Nothing changes until someone accepts.

### Handle a maintenance ticket

Tickets from the assistant and the report form land on **Admin → Maintenance → Tickets**,
with photos if the student attached any. Corrections students report land on **Admin →
Inventory → Page corrections**, and project submissions on **Admin → People → Student
projects** (unpublished until someone publishes them). The admin **Overview** says what is
urgent (Need to know), what recurring checks are due (Shift checklist) and how many items are
waiting for a decision.

Once email is set up (`RESEND_API_KEY`, `EMAIL_FROM`; [`deploy.md`](deploy.md) step 4),
everyone who can work tickets gets an email when one is filed, with a link straight to it,
and a reminder at 08:00 on days when recurring maintenance is due or overdue. Each email has
a one-click "Turn off" link for that person. Email helps, but it does not replace an owner.
**A ticket queue nobody reads is worse than no ticket queue**: students stop reporting after
a couple of unanswered reports. Decide who checks it and how often, and write that down here:

> **Ticket owner:** ⬜ **TBD** · **Checked:** ⬜ **TBD**

### Fix something the assistant got wrong

Almost always a data problem, not an AI problem. The assistant answers from the inventory,
so a wrong answer usually means a wrong or empty field — fix it in **Admin → Inventory**. If
the record is right and the answer is still wrong, that is a real bug (§6).

### Give someone access

They sign in with their Cornell Google account first (nobody appears on People until they
have). Then a Super Admin sets their role and, optionally, a title on **Admin → People**.
Blocking or removing someone is on the same page.

### Change branding, colours, or the assistant's name

Environment variables in Vercel, no code change: `NEXT_PUBLIC_SITE_NAME`,
`NEXT_PUBLIC_INSTITUTION`, `NEXT_PUBLIC_TAGLINE`, `NEXT_PUBLIC_LOGO`, `NEXT_PUBLIC_WORDMARK`,
`NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_DARK`,
`NEXT_PUBLIC_CHAT_ASSISTANT_NAME`, and `AUDIENCE`. The lab hours shown in the header and on
the lab screen are `NEXT_PUBLIC_LAB_HOURS` (one line of text, default `LAB OPEN 8AM-8PM`).
Full explanations in `.env.example`. **Redeploy after changing any variable** — a
deployment only sees the values it was built with.

### Run the lab status screen (`/kiosk`)

`/kiosk` is a full-screen, read-only status page for the TV at the front of the lab and the
ISAM booth iPad (kiosk spec, phase 1). Nobody signs in on it. It shows which machines are
down or under maintenance (from each unit's status), the number of open tickets, the lab
hours, a rotating featured tool or published student project (author as "Maya R."), and a
large QR code that opens the catalogue with the assistant on the viewer's own phone
(`/?src=kiosk&ask=1`). It refreshes itself every minute through `GET /api/kiosk`, keeps its
last data if the network drops (an amber bar says so after three minutes), shifts a few
pixels every five minutes against burn-in, and reloads itself at 04:00 so a deploy reaches
it.

- **TV:** open `https://makerlab-ai.vercel.app/kiosk` in the TV's browser and make it full
  screen (F11 or the browser's kiosk mode). Turn off the TV's own sleep/screensaver.
- **iPad:** open the same address in Safari → Share → **Add to Home Screen**, open it from
  the home screen, then Settings → Accessibility → **Guided Access** on (triple-click to
  start) and Settings → Display & Brightness → **Auto-Lock: Never**. Landscape or portrait
  both work.
- `?lang=fr` (any supported language) changes the screen's language; otherwise it is always
  English, whatever the device is set to.
- **It is only as current as the unit statuses.** A broken machine nobody marked in
  **Admin → Inventory** still shows as running.

### Check the nightly backup is still running

**Every night at 07:17 UTC (about 03:17 New York) the site backs itself up.** Vercel Cron
calls `/api/cron/daily`, which exports **every Postgres table** to the **private** Blob
store as `backups/YYYY-MM-DD.json`. The same job prunes on tiers: **every night for a week,
then one a week to a month, one a month to a year, and one a quarter to three years** — about
30–35 files at any time. The manual search tables are left out (they are rebuilt from the
manuals). The same run deletes photos that were uploaded but never attached to anything
within 24 hours.

**This is the only copy of the data outside Neon.** It needs the private Blob store,
`CRON_SECRET`, and (to run it by hand) `ADMIN_REVALIDATE_SECRET`.

**You should not have to check it by hand.** With the heartbeat set up
([`operations.md`](operations.md#2--nightly-job-heartbeat)) a failed or missing run emails the
shared address, and a super admin sees a warning on `/admin` when the newest backup is more
than 36 hours old. **To look anyway:** Vercel dashboard → your project → **Cron Jobs**. A green
run means a file was written. **A red run means the backup did not happen** — the route
deliberately fails loudly, because a backup that fails quietly is discovered on the day you
need it. The failure reason is in the run's log.

To run one by hand, or to confirm it works after changing anything:

```
GET https://<your-site>/api/cron/daily
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
```

It answers with the file it wrote, how many rows came from each table, which old files it
deleted, and what the orphaned-photo sweep removed. Anything other than `200` is a real
failure, and the body names which stage broke.

> [!WARNING]
> **The backup contains student names and email addresses** from tickets, corrections,
> projects and the people list. It is written to *private* storage and must stay that way —
> never make the store public, never share a download link, and list it in whatever data
> inventory the university keeps.
>
> It deliberately contains **no sign-in credentials**: sessions and verification tokens are
> skipped and Google's tokens are blanked, so somebody holding a backup file cannot use it
> to sign in as anybody. People, their roles and blocks *are* in it.

**To restore:** download the file from Vercel → Storage → the private Blob store. It holds
the table rows as JSON. There is no automated restore, on purpose. The manual search tables
are not in the file; after loading the rows, rebuild them from the repo root with
`npm run manuals:index -- --force`. Steps: [`operations.md` → Restoring](operations.md#restoring).
**[dev]** for anything beyond reading the file.

---

## 4. Forcing the site to refresh

Edits made in the app appear immediately. For anything else — a change made directly in the
database **[dev]** — use the **Refresh** control in the header (staff only), or:

```
POST https://<your-site>/api/admin/revalidate
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
Body:   {"tag": "catalog"}
```

---

## 5. Monitoring — what to watch

| Where | What | How often |
|---|---|---|
| Uptime monitor on `/api/health` | Emails when the site or database is down | Automatic — [`operations.md`](operations.md#monitoring) |
| Heartbeat monitor | Emails when the nightly backup fails or does not run | Automatic — [`operations.md`](operations.md#monitoring) |
| Vercel → AI Gateway → Budgets | **Spend**, against a limit with an alert | Weekly, at minimum |
| Admin Overview | Need to know, the Shift checklist, items waiting for a decision | Per §3 |
| Vercel logs | `DbUnavailableError` (Postgres unreachable), failed functions | When something looks wrong |
| Vercel → Cron Jobs | The nightly backup ran green | When the heartbeat or `/admin` says otherwise — see §3 |

**The one alert that matters most: the AI Gateway budget.** Everything else is recoverable;
an unbounded bill is not. Setup for every monitor: [`operations.md`](operations.md).

---

## 6. When something breaks

### The site shows a **DEMO DATA** banner, or machines the lab doesn't own

`DATABASE_URL` is missing from that Vercel environment, or was added without a redeploy.
The app serves a two-tool demo catalogue and says so rather than failing. Check the
variable, then redeploy.

### Pages error, or `/api/health` answers 503

Postgres cannot be reached. The site keeps serving what it last cached and shows an error on
anything uncached — it never invents machines.

1. Check the Vercel logs for `DbUnavailableError`.
2. Check the Neon database under Vercel → Storage — a suspended or deleted branch is the
   usual cause. **[dev]**

### A machine is missing from the site

It is unpublished — check **Admin → Inventory**. If it is published, force a refresh (§4).

### Photo uploads say they are unavailable

No Blob store is linked under the names the app reads, or it was linked without a redeploy.
See [`deploy.md`](deploy.md) Part 2, step 2.

### Someone cannot sign in

Only Cornell addresses can sign in (plus anyone named in `AUTH_ALLOWED_EMAILS`); others see
a page saying so. A blocked person is told they are blocked — unblock them on People. If
nobody can sign in, check `AUTH_BASE_URL` and the Google redirect URI match the site's
address exactly.

### The assistant is down or erroring

1. Check the Gateway budget has not been reached (a capped budget looks like an outage).
2. Check the Vercel logs for errors on `/api/chat`, and the AI Gateway's status.

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
git clone https://github.com/philosophercode/makerlab-tools && cd makerlab-tools
npm install
npm run dev          # works with no credentials, using the demo catalogue
npm run test:all     # must pass before merging
```

Read [`docs/constitution.md`](constitution.md) first — it is short and it is the rules.
**Every feature starts with a spec in `docs/specs/` that merges before the code.** The app
is the repository root.

---

## 8. Setting this up for another lab **[dev]**

Nothing about Cornell is hardcoded. Follow [`deploy.md`](deploy.md) Part 2, then:

1. Set the `NEXT_PUBLIC_*` branding variables and `AUTH_ALLOWED_EMAIL_DOMAIN` for your
   institution, and replace the logo in `public/`: a one-colour SVG for `NEXT_PUBLIC_LOGO`
   with a PNG of it beside it under the same name (the QR labels and the link-preview
   card draw the PNG), and the header's wordmark (`NEXT_PUBLIC_WORDMARK`).
2. **Only if migrating an existing Notion catalogue:** run `npm run import:notion` once
   ([`deploy.md`](deploy.md) Stage 2). A new lab skips this and adds equipment through
   intake.

Full variable list with explanations: `.env.example`.

---

## 9. Known limitations — say these out loud at handover

- **Backups are files, not a standby database.** The nightly export (§3) reaches back three
  years, but restoring it is manual developer work, and photos and PDFs live only in Blob.
- **Translations are English-first.** The interface has twelve languages, but strings added
  since the last translation pass fall back to English until the pass after launch. The
  assistant still answers in any language.
- **No usage analytics.** There is no report of which machines get asked about most.
- **One person built this.** That is the risk this document exists to reduce. If something
  here is unclear, that is a bug in the document — fix it while you still have someone to
  ask.

---

## 10. Open items at handover

- [ ] Fill in every owner in §2
- [ ] Set a Gateway budget and alert
- [ ] Set up the uptime and heartbeat monitors ([`operations.md`](operations.md)), alerting a shared address
- [ ] Name a maintenance-ticket owner and cadence (§3)
- [ ] Confirm who can deploy and who administers the Vercel project
- [ ] Confirm with the university that student names and emails in tickets, the backup and
      any Notion mirror are acceptable
