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
**Notion** — seven databases that staff edit directly. The website reads from Notion and
adds an AI assistant on top.

**Editing the catalogue means editing Notion.** There is no admin login and no dashboard,
by design. If a machine's description is wrong, you fix it in Notion, and the website
catches up within minutes.

Three moving parts, and it is worth knowing which is which when something is wrong:

| Part | What it is | Who provides it |
|---|---|---|
| **The website** | The app itself | Hosted on Vercel |
| **The data** | Seven databases | Notion workspace |
| **The assistant** | The AI | Anthropic API (Claude) |

---

## 2. Accounts and keys — fill this in at handover

**This section is the handover.** Until it is filled in with real names, the system has no
owner.

| Thing | Where | Who owns it | Notes |
|---|---|---|---|
| Vercel project | vercel.com | ⬜ **TBD** | Hosting, deploys, env vars, logs |
| Notion workspace | notion.so | ⬜ **TBD** | The seven databases |
| Notion integration token | Notion settings | ⬜ **TBD** | `NOTION_API_KEY` |
| `AI_GATEWAY_API_KEY` | Vercel → AI Gateway | ⬜ **TBD** | **The intended production path.** Model spend on the hosting invoice, with a platform spend limit |
| Anthropic API key | console.anthropic.com | ⬜ **TBD** | **Fallback.** Costs money per use. Keep it — it is the lever back if the gateway fails |
| GitHub repository | github.com | ⬜ **TBD** | The code |
| Domain / DNS | ⬜ | ⬜ **TBD** | |
| `ADMIN_REVALIDATE_SECRET` | Vercel env vars | ⬜ **TBD** | Forces the site to refresh |
| Vercel Blob store | Vercel → Storage | ⬜ **TBD** | Holds the nightly Notion backup. Sets `BLOB_READ_WRITE_TOKEN`. **Contains student PII — keep private** |
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

1. In Notion, add a row to the **Tools** database.
2. Fill in at least: name, description, category, location.
3. Add units in the **Units** database, linked to the tool — one row per physical machine,
   with serial and status.
4. Add manuals or SOPs to **Resources**, linked to the tool.
5. Tick **published**. Until you do, it will not appear on the site.
6. Wait a few minutes, or force a refresh (§4).

**The assistant picks it up automatically.** No deploy, no developer.

### Mark a machine out of service

Change the unit's **status** in the Units database to `Under Maintenance` or `Out of
Service`. The site shows it as offline, and the assistant stops recommending it.

### Handle a maintenance ticket

Tickets from the assistant land in **Maintenance_Logs**, with photos if the student attached
any. Work them in Notion: set `status` to `In Progress`, then `Resolved`, and fill in
`resolution`.

Nothing in the app enforces this. **A ticket queue nobody reads is worse than no ticket
queue** — students stop reporting after a couple of unanswered reports. Decide who checks
it and how often, and write that down here:

> **Ticket owner:** ⬜ **TBD** · **Checked:** ⬜ **TBD**

### Fix something the assistant got wrong

Almost always a data problem, not an AI problem. The assistant answers from Notion, so a
wrong answer usually means a wrong or empty field. Fix the record; the answer changes.

If it is wrong *and* the Notion record is right, that is a real bug — see §6.

### Change branding, colours, or the assistant's name

Environment variables in Vercel, no code change: `NEXT_PUBLIC_SITE_NAME`,
`NEXT_PUBLIC_INSTITUTION`, `NEXT_PUBLIC_TAGLINE`, `NEXT_PUBLIC_LOGO`,
`NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_DARK`,
`NEXT_PUBLIC_CHAT_ASSISTANT_NAME`, and `AUDIENCE`. Full explanations in
`v5/.env.example`. Redeploy after changing them.

### Check the nightly backup is still running

**Every night at 07:17 UTC (about 03:17 New York) the site backs up Notion.** Vercel Cron
calls `/api/admin/backup`, which reads every Notion database and writes one file to private
Vercel Blob storage as `backups/YYYY-MM-DD.json`. Files older than **30 days** are deleted
by the same job, so the store holds roughly a month at any time.

**This is the only copy of the Notion data outside Notion.** Before it existed, one deleted
database meant ~100 machines of staff work was gone for good.

Three settings in Vercel make it work, and it does nothing without all three:

| Setting | Where | What it is |
|---|---|---|
| A **Blob store** linked to the project | Vercel → Storage | Sets `BLOB_READ_WRITE_TOKEN` automatically |
| `CRON_SECRET` | Vercel env vars | Vercel sends it so the route knows the nightly call is genuine |
| `ADMIN_REVALIDATE_SECRET` | Vercel env vars | Lets a person trigger a backup by hand (same secret as §4) |

**How to check it, once a month:** Vercel dashboard → your project → **Cron Jobs**. A green
run means a file was written. **A red run means the backup did not happen** — the route
deliberately fails loudly rather than reporting success, because a backup that fails quietly
is discovered on the day you need it. The failure reason is in the run's log.

To run one by hand, or to confirm it works after changing anything:

```
GET https://<your-site>/api/admin/backup
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
```

It answers with the file it wrote, how many rows came from each database, and which old
files it deleted. Anything other than `200` is a real failure.

> [!WARNING]
> **The backup contains student names and email addresses** from Maintenance_Logs. It is
> written to *private* blob storage and must stay that way — never make the store public,
> never share a download link, and list it in whatever data inventory the university keeps.

**To restore:** download the file from Vercel → Storage → Blob, and re-import the affected
database. The file holds the raw Notion rows, so a person can read it and rebuild from it.
There is no automated restore, on purpose — it is far more work than the failure justifies.
**[dev]** for anything beyond reading the file.

---

## 4. Forcing the site to refresh

The site caches Notion data for a few minutes. To make a change appear immediately:

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
| Vercel logs | `Falling back to mock catalog` | Whenever the catalogue looks odd |
| Vercel → Cron Jobs | The nightly backup ran green | Monthly — see §3 |
| Notion: Maintenance_Logs | Open tickets | Per §3 |

**The one alert that matters: an Anthropic spend threshold.** Everything else is
recoverable; an unbounded bill is not.

---

## 6. When something breaks

### The site shows machines the lab doesn't own

**Most likely cause, and it is not obvious.** The app falls back to a built-in demo
catalogue whenever it cannot reach Notion — a missing or misspelled environment variable, an
expired integration token, or a database that stopped being shared with the integration.

The site does **not** show an error. It looks perfectly healthy while serving fictional
equipment.

1. Check the Vercel logs for `Falling back to mock catalog`.
2. Check every `NOTION_DB_*` variable and `NOTION_API_KEY` in Vercel.
3. In Notion, confirm each database is still shared with the integration.

### A machine is missing from the site

Check `published` is ticked in Notion. Then force a refresh (§4).

### A field is empty on the site but filled in Notion

Someone probably renamed the property in Notion. The app matches property names and cannot
follow a rename. Compare against `v5/.env.example` and the other rows. **[dev]** if unclear.

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

Nothing about Cornell is hardcoded.

1. Duplicate the seven Notion databases into the new workspace.
2. Create a Notion integration and share all seven databases with it.
3. Deploy the repo to Vercel.
4. Set `NOTION_API_KEY`, the seven `NOTION_DB_*` IDs, and `ANTHROPIC_API_KEY`.
5. Override the `NEXT_PUBLIC_*` branding variables.
6. Replace the logo in `v5/public/`.

Full variable list with explanations: `v5/.env.example`.

---

## 9. Known limitations — say these out loud at handover

- **No sign-in yet.** The assistant is open to anyone with the URL. Specced, not built.
- **The fallback is silent** (§6). Fix specced in the operational-hardening spec.
- **No analytics.** Notion cannot aggregate, so there is no way to see which machines get
  asked about most. This is the main reason a successor project exists.
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
