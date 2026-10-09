# Operations — monitoring, backups, restore

> What to switch on once the site is live, so that a failure reaches a person instead of
> waiting to be noticed. Setting the site up: [`deploy.md`](deploy.md). Day-to-day running:
> [`handover.md`](handover.md). Design and reasons: the
> [operational hardening spec](specs/2026-07-29-operational-hardening-design.md).

Everything here is free or nearly so, and none of it is a service to run. Send every alert to
a **shared lab address**, never one person's inbox.

---

## Monitoring

Five steps, in order of value. The first three take about fifteen minutes together.

| # | What | Where | Alert on |
|---|---|---|---|
| 1 | Uptime check on `/api/health` | UptimeRobot (free) or Better Stack (free) | HTTP status ≠ 200 |
| 2 | Nightly job heartbeat | Healthchecks.io (free) | A `/fail` ping, or no ping in 25 hours |
| 3 | AI Gateway budget | Vercel → AI Gateway | Spend reaching the monthly budget |
| 4 | Vercel usage and spend | Vercel → Settings → Billing / Usage | Approaching a plan limit or the spend amount |
| 5 | Log drain *(optional)* | Vercel → Log Drains, or a Marketplace integration | — |

### 1 · Uptime check on `/api/health`

Create an **HTTP(S) monitor** for `https://<your-site>/api/health`:

- **Interval:** 5 minutes (UptimeRobot's free floor; Better Stack's free tier allows 3).
- **Alert on the status code, not the body.** The endpoint answers **200** when the
  database is reachable and **503** when it is not — the 503 is the whole contract. A keyword
  check on the body would miss it.
- **Confirm after 2 failures** (or "incident after 2 checks") so a single slow cold start does
  not page anybody.
- **Recipients:** the shared lab address.

The endpoint is public, unauthenticated, cached for about 30 seconds and rate-limited to 30 a
minute per IP, so a monitor polling every few minutes costs nothing. It does not check the
model provider on purpose: a model outage does not make the catalogue wrong.

### 2 · Nightly job heartbeat

The nightly job (`/api/cron/daily`, 07:17 UTC) already fails loudly: any stage that breaks
makes the run non-200 and logs `[cron] <stage> failed`. But **Vercel tells nobody** — a red
run sits in Project → Cron Jobs until someone looks. A heartbeat monitor closes that gap, and
also catches a job that never ran at all (a cron that was unregistered looks exactly like one
that is working).

1. On [Healthchecks.io](https://healthchecks.io) (free, 20 checks), add a check with
   **Schedule:** cron `17 7 * * *`, time zone **UTC**, **Grace time:** 1 hour. Better Stack's
   free heartbeat works the same way (period 1 day, grace 1 hour).
2. Copy its ping URL into Vercel as **`CRON_HEARTBEAT_URL`** (Production only; preview
   deployments do not run cron). It must be `https`. Treat it as a secret: anyone holding it
   can mark the job healthy.
3. Redeploy, then trigger the job once by hand (below) and watch the check turn green.

Each run that passes the secret check pings `<url>` on success and `<url>/fail` on any
failure, including "no Blob store linked". A heartbeat that cannot be delivered is logged and
never fails the job. The code is `src/lib/cron/heartbeat.ts`.

**Also on `/admin`:** a super admin on the live database sees a warning on the admin home when
the newest backup is more than 36 hours old, when there is none, when no Blob store is linked,
or when the store could not be read (`src/lib/cron/backup-freshness.ts`). It judges by the
backup files themselves, so a run that reported success without writing still shows.

To run the job by hand:

```
GET https://<your-site>/api/cron/daily
Header: x-admin-secret: <ADMIN_REVALIDATE_SECRET>
```

### 3 · AI Gateway budget

Inference is the one cost that scales with use and the one that can run away. Vercel
dashboard → **AI Gateway** → set a **monthly budget** with an email alert. Keep **auto
top-up off**, or capped: with it off, spend can never exceed the credit balance, and an
exhausted balance shows as assistant errors (the troubleshooting table in `deploy.md` says to
check this first). Every model call the app makes — chat, research, embeddings, evals — goes
through the Gateway, so this one limit covers all of them.

### 4 · Vercel usage and spend

- **Pro:** Team → Settings → **Billing → Spend Management**. Set a spend amount; Vercel emails
  as it is approached. Leave "pause projects" off unless an outage is preferable to the bill.
- **Hobby:** there is no overage bill — limits are hard and the project stops serving when
  one is hit. Look at **Usage** monthly; Blob operations and function duration are the ones
  this app could plausibly approach (the nightly job, manual archiving and research runs).

### 5 · Log drain (optional)

Vercel keeps runtime logs only briefly, which is enough to read a failed cron run the same
day and not enough for "when did this start?". If that question comes up more than once,
add a log drain (Pro) or a Marketplace logging integration and send it the `[cron]`,
`[admin]` and `DbUnavailableError` lines (backup failures log as `[cron] backup failed:`). Sentry is the documented next step after that
(ops spec §3.5) and is deliberately not the default: one more account to hand over.

---

## An email didn't arrive

Staff email ([`architecture/notifications.md`](architecture/notifications.md)) records every
send in Postgres: `notifications` (one row per event) and `notification_deliveries` (one row
per person, with a status and our own reason code). Neither holds an address. To see what
happened to a ticket's email, find its outbox row by the ticket id (`subject_id`) and read
its deliveries' `status` and `reason`:

| What you see | Meaning | What to do |
|---|---|---|
| No outbox row | The ticket was logged as completed work, not reported | Nothing: completed work is never emailed |
| Outbox `queued` for more than 15 minutes | The delivery run never started | The nightly cron restarts it once; check the logs for `[notifications] could not start` |
| Outbox `skipped` / `capped` | More than `NOTIFY_TICKET_HOURLY_CAP` tickets in an hour | The ticket is in the queue; raise the cap if this was real traffic |
| Outbox `skipped` / `subject_gone` | The ticket was resolved or closed before the email went | Nothing |
| Delivery `failed` / `not_configured` | `RESEND_API_KEY`, `EMAIL_FROM` or `AUTH_SECRET` is unset | Set them and redeploy |
| Delivery `failed` / `rejected` | Resend refused the key or the sender: often an unverified domain | Check the domain and key in Resend |
| Delivery `failed` / `invalid_recipient` | Resend refused that address | Check the person's address on People |
| Delivery `failed` / `provider_error` | Resend failed four times in a row | Check Resend's status; a later ticket sends normally |
| Delivery `failed` / `stuck` | A send did not finish within 20 hours | Never re-sent automatically, so nobody gets a duplicate |
| Delivery `skipped` / `pref_off` | The person turned this email off | They can ask a director to turn it back on |
| Delivery `skipped` / `preview_blocked` | A preview deployment, and the person is not in `EMAIL_PREVIEW_RECIPIENTS` | Expected on previews |
| Delivery `sent` | Resend accepted it (`provider_message_id` is its id) | Look in junk; Cornell may need the sender marked "not junk" once |

A failed send never fails the ticket: the student is told it was filed either way. The 08:00
maintenance reminder is the same kind of row, keyed `maintenance.due:<lab date>`; no row for a day
means no recurring task came due that day (a task that stays overdue is emailed once, on its due
date, not every day). Which task and due date each reminder named is in
`maintenance_reminder_items`.

---

## Backups

### What the nightly file holds

One JSON file a night in the **private** Blob store, `backups/YYYY-MM-DD.json`: every
Postgres table, discovered from the schema so a new table is included without anyone
remembering. Three kinds of thing are left out on purpose
(`src/lib/cron/backup-policy.ts`):

- **Credentials.** `session`, `verification` and `oauth_access_token` are skipped; the tokens
  on `account`, the client secret on `oauth_application` and the Notion token on
  `notion_mirrors` are blanked. A backup must not double as a way to sign in.
- **Manual search data.** `manual_pages` (page text) and `manual_chunks` (passages and their
  embeddings) are most of the bytes and are rebuilt from the stored PDFs. `manual_documents`
  is kept.
- **Files.** Photos and manual PDFs live in Blob, not in the file.

The file contains student names and email addresses, and quarterly copies keep them for up
to three years — including rows the app itself has since deleted, such as discarded intake
items. It stays private and belongs in the university's data inventory with that retention.

### Retention

The same job prunes, by the date in each file's name (`src/lib/cron/backup-retention.ts`):

| Age | Kept |
|---|---|
| Under 7 days | Every night |
| 7 days to 1 month | The newest of each ISO week |
| 1 month to 1 year | The newest of each calendar month |
| 1 to 3 years | The newest of each quarter |
| Over 3 years | Nothing |

About 30–35 files at steady state. Two files on the same day keep the newer; a pathname that
is not a backup is never deleted.

### Restoring

There is no automated restore. **[dev]**

1. Download the file from Vercel → Storage → the private Blob store → `backups/`.
2. Load its `tables` into an empty, migrated database (`npm run db:migrate` first), parents
   before children. `rowCount` beside each table says what to expect.
3. **Rebuild manual search**, from the repo root:

   ```bash
   npm run manuals:index -- --force
   ```

   `--force` is required: the restored `manual_documents` rows already carry the current
   extractor and chunker versions, so without it the script finds nothing to do. It re-reads
   every stored PDF (free) and re-embeds the passages through the AI Gateway (a few cents for
   the whole library), so it needs `DATABASE_URL`, Blob access and Gateway auth — see
   `deploy.md` Stages 2d–2e.
4. Everyone signs in again (sessions are not backed up), and each connected MCP app and
   Notion mirror asks for its token again.

## One-off data cleanups

### Inventory cleanup 2026-09-28 (`npm run inventory:cleanup`)

A reviewed data bundle in `data/inventory-cleanup-2026-09-28/` — manual PDF links for tools
that had none, display-name and unit-label fixes, SEO-spam tags removed, starter questions for
tools with none, tracking parameters off resource links. `report.md` there lists every change.
From the repo root, with the dev server stopped (the local database is single-process):

```bash
PGLITE_DATA_DIR=.pglite-data npm run inventory:cleanup -- --dry-run   # what would change
PGLITE_DATA_DIR=.pglite-data npm run inventory:cleanup -- --apply
npm run manuals:index                                                  # after the archive copies the new PDFs
```

Hosted: `DATABASE_URL` instead of `PGLITE_DATA_DIR`; `--revalidate <site>` drops the catalogue
cache (`ADMIN_REVALIDATE_SECRET`). Writes go through the data layer (`updateTool`, and
tool-touching transactions for units and resources, as the editor does); every change is
conditional on the value it replaces, so a second run writes nothing. Low-confidence manual
links are skipped unless `--include-low`.
