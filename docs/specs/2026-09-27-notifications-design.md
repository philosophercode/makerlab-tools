# Notifications: Email First, Web Push Later — Design Spec

**Date:** 2026-09-27
**Status:** Draft
**Target:** `v5/`
**Branch:** `docs/feature-specs`
**Spec PR:** — · **Implementation PR:** — (one per phase, §9)

## 1. Summary

Nothing in v5 tells anybody anything. A student who reports a broken printer, flags a
wrong spec or submits a project hears back only if they come back and look. Staff learn
about waiting work only by opening `/admin` and reading the tile counts. The one outbound
alarm is the cron heartbeat monitor (`src/lib/cron/heartbeat.ts`), which emails whoever
configured `CRON_HEARTBEAT_URL` and knows nothing about the lab's queues.

This spec adds **notifications**: a small set of events, a per-person preference, and a
durable sender.

- **Students and anyone signed in** get an email when a ticket they opened changes
  status, a correction they reported is resolved, or their project is published.
- **Staff** get one **daily digest** of what is waiting for them: new tickets, new
  corrections, intake items ready for review, projects to moderate, a failed backup or
  mirror push and, once that spec lands, recurring maintenance that is due. Each staff
  member sees only the queues their permissions let them work.
- **Web Push** (an installed PWA, a service worker, VAPID) is a later phase over the same
  pipeline.

Every notification is written to a **transactional outbox** (`notifications`) in the same
transaction as the write that caused it, then delivered by a **Workflow SDK run**. The
outbox is also the **delivery log**. Email goes through **Resend, installed from the
Vercel Marketplace** (§3.4). An email address is read only inside the send step, at send
time, from the `user` row. It is never stored in the outbox, never logged, never shown to
another person and never placed in a model's context.

This builds on the **assistant GUI-parity spec** (2026-09-27, PR #91). Every new write,
including changing your notification preferences, is an action in `src/lib/actions/`. The
assistant can do it through a confirmation card. Notifications themselves are a
**side-effect of actions**, never a tool: neither the model nor an MCP client can send a
message to anyone.

## 2. Goals / Non-goals

### Goals

- **Three personal events, on by default for signed-in people:** ticket status changed
  (`maintenance_logs.reported_by_user_id`), correction resolved (`feedback.reporter_user_id`,
  status becomes `fixed` or `dismissed`), and project published (`projects.author_user_id`).
- **One staff digest per day, scoped by permission.** A section appears only if the
  recipient holds that queue's permission, and only if the section has something in it.
  An empty digest is not sent.
- **No missed sends and no double sends.** The outbox row commits with the write. The run
  is idempotent on the row id, which is also the provider's idempotency key. The daily
  cron gains a backstop stage for rows whose run never started.
- **Preferences on `/account`.** Per-event on/off, digest daily/weekly/off, quiet hours,
  and a list of push devices (phase 3). Every change is an action, so the assistant can
  propose it ("stop emailing me about corrections").
- **One-click unsubscribe** in every email (RFC 8058 `List-Unsubscribe` and
  `List-Unsubscribe-Post`), with a signed link that needs no sign-in.
- **Quiet hours** hold a message until the window ends, in `LAB_TIMEZONE`
  (`src/lib/lab-time.ts`). The default window is 22:00 to 08:00.
- **A delivery log super admins can read** (`/admin/notifications`): what was sent, to
  whom by name, when, and what failed and why. Addresses are never shown.
- **Fail visibly, never loudly.** A failed send never fails the write that caused it
  (the mirror trigger's rule). It is `failed` in the log, and the failure count appears on
  the super admin's `/admin` tile.

### Non-goals (this iteration)

- **Free-form messages.** Staff cannot write to a student through the app, and the
  assistant cannot "email Luis". That is a mail client's job, and a model that can send
  mail is an abuse channel.
- **Notifying anonymous reporters.** They left no account and no address. The form and
  `report_issue` may say "sign in to be told when this is fixed" (§6).
- **SMS, Slack or Teams.** Email reaches everyone at Cornell. Slack could be a later
  channel over the same outbox.
- **In-app notification centre (bell icon).** The outbox could feed one later; it is not
  needed to answer "did anybody tell me".
- **Marketing or newsletter mail.** Only transactional mail is sent, and every message is
  caused by something that happened to the recipient's own record or queue.
- **Localised email bodies in phase 1.** Strings go through `next-intl` from day one
  (Article 6), but other locales fall back to English until the translation pass.
- **Scheduling recurring maintenance.** That is its own spec. This spec only consumes its
  "due" event (§4.3) if and when it exists.

## 3. Architecture

### 3.1 Where things live

```text
src/lib/notifications/
  events.ts        NOTIFICATION_EVENTS: key, audience rule, default, template, dedupe key
  enqueue.ts       enqueueNotification(tx, event): inserts outbox rows inside the caller's transaction
  trigger.ts       requestDelivery(ids): starts the run after commit; never throws
  preferences.ts   read/resolve a person's preferences (defaults when no row)
  quiet-hours.ts   pure: next allowed send time in LAB_TIMEZONE
  unsubscribe.ts   sign/verify the HMAC unsubscribe token (AUTH_SECRET)
  digest.ts        buildStaffDigest(userId): one aggregate per section, scoped by can()
  templates/       react-email components, one per event, plus the digest
  channels/email.ts   Resend client (the one `resend` import); mocked by MSW in tests
  channels/push.ts    web-push sender (phase 3)
src/workflows/deliver-notification.ts   deliverNotification(id): sleep until allowed → render → send → record
src/workflows/staff-digest.ts           staffDigest(): sleep until 08:00 lab time → one step per recipient
src/lib/actions/notifications.ts        account.set_notification_prefs, account.unsubscribe,
                                        account.remove_push_device (GUI-parity action definitions)
src/lib/cron/notifications.ts           cron stage: start the digest; re-start stuck outbox rows
src/app/api/notifications/unsubscribe/route.ts   GET (confirm page) and POST (one-click)
src/app/api/push/subscribe/route.ts     phase 3
public/sw.js, src/app/manifest.ts       phase 3
```

### 3.2 Where events come from

Events are emitted by the write paths that already exist. Each is an action after the
GUI-parity refactor (`tickets.update`, `corrections.set_status`, `projects.set_published`).
Each call to `enqueueNotification(tx, …)` sits **inside the action's transaction**, beside
the audit write. So the rules are:

- A write that rolls back leaves no notification.
- A notification is never enqueued for a write that did not land.
- The assistant's confirm route and MCP produce the same notification as the GUI, because
  they run the same `performAction()`.

After the commit, `performAction()` calls `requestDelivery(ids)`. It follows the pattern
of `requestMirrorPush()` in `src/lib/mirror/trigger.ts`: it never throws, uses a dynamic
`import()` so `workflow/api` stays out of action tests, and writes one fixed log line with
no personal data if it fails. The cron backstop (§3.5) catches any row whose run never
started.

`report_issue` and `POST /api/projects` do not notify: they are the reporter's own acts.
Staff learn of them from the digest.

### 3.3 Delivery run

`deliverNotification(id)` is a `"use workflow"` function. Its steps:

1. **Load the row, then re-check.** Stop as `skipped` if the recipient is gone, the
   preference is now off, or the subject's state no longer matches the event (for
   example, a ticket moved back to `open` before the run woke).
2. **Coalesce.** Status notifications `sleep("2m")` first, as the mirror does. Two quick
   changes to one ticket then send one email showing the latest status. The earlier row
   becomes `superseded`.
3. **Apply quiet hours.** `sleep` until `nextAllowedSendAt()`, and mark the row `held`
   while it waits.
4. **Render and send.** The address is read from `user.email` inside the step and passed
   straight to the channel. `Idempotency-Key` is the row id. `maxRetries = 3` with backoff.
   A 4xx that is not 429 is a `FatalError` (bad address, suppressed); 5xx and 429 retry.
5. **Record** `sent` with `provider_message_id`, or `failed` with an `error_code` (never
   the provider's raw message, which may echo the address).

### 3.4 Email provider: Resend via the Vercel Marketplace

| | Resend | Postmark | AWS SES | Cornell SMTP relay |
|---|---|---|---|---|
| Vercel Marketplace, env injected | **Yes** (`vercel integration add resend`) | No | No | No |
| Billing | Through Vercel | Separate account | AWS account | Free; needs Cornell IT |
| Idempotency key, one-click unsubscribe headers | Yes | Yes | Headers by hand | Headers by hand |
| Templates | react-email (same React/TSX we write) | Own templates | None | None |
| Webhooks (bounce, complaint) | Yes | Yes | Via SNS | No |
| Test story | HTTP API, so MSW mocks it (Article 3) | Same | SDK signing, awkward | SMTP, needs a fake server |

**Recommendation: Resend, installed from the Marketplace.** It is the only option that
follows the repo's practice of provisioning services through the Vercel Marketplace (Neon,
data platform spec §3). It keeps billing on the Vercel project and is a plain HTTP API
that MSW can intercept. Postmark is the fallback if the Marketplace listing or its
deliverability disappoints, and it needs only a `channels/email.ts` swap. Resend's bounce
and complaint webhooks feed `suppressed` (phase 2).

**Sending domain.** Cornell will not let us sign mail as `@cornell.edu`. Mail is sent from
a subdomain the lab controls (for example `notify.<lab domain>`) with SPF, DKIM and DMARC
set during Resend's domain verification. `Reply-To` is the lab's shared inbox from
`siteConfig` (Article 6). See §11 Q1.

### 3.5 Staff digest and scheduling

`vercel.json` has one cron, daily at 07:17 UTC, which is 03:17 in New York. A new
last-but-one stage of `/api/cron/daily` (`src/lib/cron/notifications.ts`) does two things.
It starts `staffDigest()`, which `sleep`s until 08:00 `LAB_TIMEZONE`, so no second cron and
no Pro-plan cron frequency is needed. It also re-starts any outbox row still `queued` more
than 15 minutes after creation. The digest dedupes on `digest:<userId>:<lab date>`, so a
cron retry sends nothing twice.

Each digest is built fresh at send time, one aggregate per section. It reuses the count
loaders `/admin` already runs (`loadAdminOverview`, `src/lib/data/admin-overview.ts`).

| Section | Shown to holders of | Source |
|---|---|---|
| New maintenance tickets | `maintenance.manage` | `maintenance_logs` `status = 'open'`, created since last digest |
| Corrections waiting | `feedback.manage` | `feedback` `status = 'new'` |
| Intake ready for review | `tools.approve` | `pending_tools` `status in ('researched','failed')` |
| Projects to moderate | `projects.moderate` | `projects` `published = false` |
| Backup stale or failed | `users.manage` | `backup-freshness.ts` (over 36 h) |
| Mirror push failed | `mirror.manage` | `notion_mirrors` last status not `ok` |
| Recurring maintenance due | `maintenance.manage` | the recurring maintenance spec's due list, if it lands |

Each row links to its queue, never to a person. Reporter names may appear, as they do in
the queues. **Reporter emails never appear**, even though `listMaintenanceQueue` selects
them: the digest uses its own reads that do not.

**The backup alarm stays the heartbeat.** If the cron itself dies, so does the digest, so
the external heartbeat monitor remains the primary alarm (`docs/operations.md`). The digest
line is a second, friendlier signal, not a replacement.

## 4. Data model

One migration, `00NN_notifications.sql` (the next free number when it lands; `0020`
today). Tables are in `src/lib/db/schema/notifications.ts`, and the vocabulary is added to
`vocabulary.ts` with `inListCheck` constraints, as elsewhere.

### 4.1 `notification_preferences`

One row per person who changed anything. No row means the defaults.

| Column | Type | Notes |
|---|---|---|
| `user_id` | text PK → `user.id` **on delete cascade** | |
| `email_enabled` | boolean, default true | master switch |
| `events` | jsonb `Record<NotificationEvent, boolean>` | missing key = the event's default |
| `digest` | text `daily \| weekly \| off`, default `daily` | ignored without a staff permission |
| `quiet_start`, `quiet_end` | `time`, default `22:00` / `08:00` | null both = no quiet hours |
| `updated_at` | timestamptz | |

### 4.2 `notifications` (outbox + delivery log)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | also the provider idempotency key |
| `user_id` | text → `user.id` **on delete cascade** | removing a person removes their log (§8) |
| `event` | text, `NOTIFICATION_EVENTS` | |
| `channel` | text `email \| push` | |
| `subject_type`, `subject_id` | text, uuid | the ticket/correction/project; null for a digest |
| `dedupe_key` | text, **unique** | e.g. `ticket.status:<id>:<status>`, `digest:<user>:<date>` |
| `status` | text `queued \| held \| sent \| failed \| skipped \| superseded \| suppressed` | |
| `send_after` | timestamptz | quiet-hours release time |
| `attempts` | int | |
| `provider_message_id` | text | |
| `error_code` | text | our code, never provider prose |
| `created_at`, `sent_at` | timestamptz | |

There is **no address and no rendered body.** The body is rendered at send time from the
subject's current state. Rows older than **180 days** are deleted by a new cron stage. The
delivery log is operational data, not history; `audit_events` stays the history.

### 4.3 Events

```ts
export const NOTIFICATION_EVENTS = [
  "ticket.status_changed",   // to reporter; default on
  "correction.resolved",     // to reporter; default on; fixed | dismissed
  "project.published",       // to author; default on
  "staff.digest",            // to staff; default daily
  "maintenance.due",         // folds into the digest; exists only once the recurring maintenance spec lands
] as const;
```

### 4.4 `push_subscriptions` (phase 3)

`id`, `user_id` (cascade), `endpoint` (unique), `p256dh`, `auth`, `label` (for example
"Chrome on Mac", from the user agent, shown on `/account`), `created_at`, `last_success_at`,
`failure_count`. A 404 or 410 from the push service deletes the row, which is the Web Push
contract for an expired subscription.

## 5. Behavior / flow

**"My ticket moved."** Luis sets a ticket to `in_progress` on `/admin/maintenance`. The
`tickets.update` action writes the ticket and enqueues `ticket.status_changed` for
`reported_by_user_id`, in one transaction. After the commit, `requestDelivery` starts the
run. It waits 2 minutes, re-reads the ticket (still `in_progress`), sees it is 23:10 and
holds until 08:00, then sends: "Your report about the Form 4 is now In progress." The email
carries a link to the tool page, and the resolution text once the ticket is resolved (§11
Q3).

**Unhappy paths**

- **Reporter removed or preference off:** `skipped`.
- **Resend down:** step retries, then `failed`, then the count shows on the super admin's
  tile. The ticket write is untouched.
- **Hard bounce or complaint** (phase 2 webhook): the address is marked `suppressed` in
  preferences, and `/account` says "we could not deliver to this address".
- **Status toggled back within 2 minutes:** `superseded`, nothing sent.
- **Enqueue insert fails:** the whole write rolls back. This is deliberate: the outbox is
  one small insert in the same database, and a write that silently loses its notification
  is the quiet failure Article 4 forbids. See §11 Q5 for the alternative.

## 6. UI

- **`/account` → "Notifications" section** (a `PageSection` below the name). Toggles per
  event, digest frequency (only for someone holding a queue permission), quiet hours, and
  the email address shown read-only. Phase 3 adds "This device: Turn on push" and the
  device list with Remove. Each control saves on change through a server action wrapping
  `performAction()`, using the `InlineTextEditor` / `useRowAction` contract (optimistic;
  a refusal restores).
- **Unsubscribe page** (`/notifications/unsubscribe?t=`). "You won't get emails about X any
  more. [Undo] · Manage all notifications." It works signed out. The POST is the one-click
  path mail clients use.
- **`/admin/notifications`** (delivery log), a new entry in `src/lib/admin/surfaces.ts`
  under `settings`, gated on `users.manage`. It is a `DataTable` of recent rows: when,
  person (name via `PersonLabel`), event, channel, status, error. It filters on status and
  event in the URL, like the inventory. The `/admin` tile counts `failed` in the last
  7 days.
- **Reporting forms and `report_issue`.** A signed-in reporter sees "We'll email you when
  this changes"; an anonymous one sees "Sign in to be told when this is fixed". These are
  new `next-intl` strings (Article 6).
- **Email templates** are react-email, with branding from `siteConfig`, plain-text
  alternatives, no tracking pixels and no click tracking (Resend's are off). The
  header image is the lab's official logo as a PNG (`siteConfig.logoPng`, an absolute
  URL on `siteUrl()`), since most mail clients do not show SVG (identity spec amendment
  2026-10-06).

## 7. Relationship to existing work

- **Assistant GUI-parity spec (PR #91): a hard dependency.** Enqueue lives in the action
  layer, so notifications ride on `performAction()` and fire on every surface. Phase 1
  cannot start until parity phase 1 (the behaviour-preserving move of writes into
  `src/lib/actions/`) has merged for tickets, corrections and projects.
- **Mirror trigger pattern** (`src/lib/mirror/trigger.ts`, `src/workflows/mirror-push.ts`):
  the model for never-throwing triggers, coalescing with `sleep`, and a cron backstop.
- **Daily cron** (`src/app/api/cron/daily/route.ts`): two new stages, placed after the
  mirror stage and before the heartbeat. They are digest + backstop, and log retention.
- **Operational hardening / backup freshness:** the digest reads `backup-freshness.ts` and
  does not replace the heartbeat.
- **Account page** (`src/app/account/page.tsx`): gains a section.
- **User removal** (`src/lib/data/user-removal.ts`): cascades clean up preferences, log and
  push subscriptions. The removal test gains the three tables.
- **Sibling drafts** (recurring maintenance, and training/consumables ideas): this spec
  defines the `maintenance.due` digest section only. If recurring maintenance is not built,
  the section never appears.

## 8. Security and safety

- **Authorization.** Preferences: the account gate, always the caller's own row, as with
  `updateOwnName`. Delivery log: `users.manage`. Unsubscribe: an HMAC token over
  `(userId, event, issuedAt)` keyed by `AUTH_SECRET`. It carries no email and can only turn
  something off.
- **Rate limiting (Article 4).** The unsubscribe route and push subscribe route get their
  own `ROUTE_TIERS` entries, keyed by IP, checked before any query. Preference actions
  share `ADMIN_ACTION_TIER`'s per-person budget, as every action does. Outbound, the run
  bounds concurrency: digest steps are serial per run, and Resend's 429 is honoured.
- **Write safety (Article 5).** Notifications publish nothing. A preference change through
  the assistant is a proposal plus a card click (parity spec §3.5). `account.unsubscribe`
  and `account.set_notification_prefs` are `assistant: "chat"` and never MCP, because a
  leaked token must not be able to silence someone's alerts.
- **Untrusted input in email.** Ticket titles, resolutions and project names are
  user-typed. Templates render them as text (React escapes). No user text goes into a
  subject line unescaped, and no user text becomes a link.
- **PII and student data.** An address is read only in the send step and handed to Resend,
  which is therefore a data processor for student emails (§11 Q2). It is **never** stored
  in `notifications`, logged, written to `audit_events`, shown on `/admin/notifications`,
  sent to the mirror, or placed in a model prompt. The digest never includes reporter
  emails. A student's email goes only to that student. `Reply-To` is the lab inbox, never a
  staff member's personal address. Removal cascades delete the log. Rows age out at
  180 days.
- **Prompt injection.** None: no model reads or writes notification content.

## 9. Phased build order

Each phase leaves `main` deployable. Phases 2 and 3 can run in parallel after phase 1.

1. **Outbox + personal email.** Covers the migration, `events.ts`, enqueue in
   `tickets.update` / `corrections.set_status` / `projects.set_published`, the
   `deliverNotification` workflow, Resend via `vercel integration add resend`, templates,
   unsubscribe, the cron backstop, and the "we'll email you" strings. Preferences are
   defaults only.
   *Accept:* changing a ticket's status on staging sends exactly one email to the
   reporter's own inbox. A second quick change within 2 minutes sends one email, not two.
   Unsubscribe works signed out. `notifications` holds no address. Unset
   `RESEND_API_KEY` → rows go `failed` with `email_not_configured`, and the ticket write
   still lands.
2. **Preferences, quiet hours, digest, delivery log.** Covers the `/account` section and
   its three actions (assistant-proposable), quiet hours, `staffDigest`, bounce and
   complaint webhooks → `suppressed`, `/admin/notifications`, the failure tile, and
   180-day retention.
   *Accept:* a SuperMaker with `maintenance.manage` only gets a digest with only the
   tickets section. An empty digest is not sent. A 23:00 event arrives at 08:00. "Stop
   emailing me about corrections" in the chat shows a card, and one click turns it off.
3. **Web Push.** Covers `manifest.ts`, `public/sw.js`, VAPID keys (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` in Vercel env), `push_subscriptions`, a per-event channel choice,
   and the device list. On iOS, push works only for a home-screen-installed PWA (16.4+),
   and the UI says so.
   *Accept:* on Chrome, Firefox and installed iOS Safari, a ticket change shows a system
   notification that opens the tool page. A revoked subscription (410) is deleted on the
   next send.
4. **Recurring maintenance due** (only after that spec merges): adds a digest section,
   optionally with an immediate push to the assigned person.

## 10. Testing

Every external service is mocked (Article 3). Resend is an HTTP API intercepted by MSW
(`test/msw/resend.ts`), and push uses a mocked `web-push` send. With no env vars,
`npm run test:all` passes.

- **Unit:** `quiet-hours` (DST boundaries in `America/New_York`, windows that cross
  midnight, null window). `unsubscribe` sign/verify (tampered, wrong event, expired).
  `events` audience rules. `buildStaffDigest` scoping per role, including the
  adjacent-permission case the queues already test.
- **Integration:**
  - The enqueue sits inside each action's transaction: a forced audit failure rolls back
    both.
  - Refused writes enqueue nothing.
  - The unsubscribe route (GET renders; POST is one-click; rate limit).
  - The cron stage re-starts stuck rows and never double-starts.
  - **An address never appears in any `notifications` column, any log line, or any
    `audit_events.detail`.** This is a grep-style assertion over captured `console` output
    and rows.
- **Workflow tier** (`*.workflow.test.ts` under `@workflow/vitest`): coalescing supersedes
  the earlier row; quiet-hours `sleep`; 5xx retry then `sent`; 4xx is `FatalError` then
  `failed`; same id twice sends once (idempotency key asserted on the MSW request).
- **Component:** the `/account` section (toggles, digest shown only to staff, optimistic
  save and restore on refusal), and the delivery log table.
- **E2E:** change a ticket as the demo admin, then read the MSW-captured Resend request.
  Asserts recipient is the demo reporter, subject has the tool name, and `List-Unsubscribe`
  is present.
- **Evals** (`evals/cases/notifications.yaml`, on demand, never gating): "stop emailing me
  about my tickets" → proposes `account.set_notification_prefs` with only that event off.
  "Email Luis that the laser is fixed" → declines and explains there is no messaging.
  "Why did I get this email?" → explains from the event, without inventing.

**Would embarrass us in production:** a student receiving another student's address or
ticket; a digest sent to someone without the permission; a double send on cron retry; a
ticket write failing because Resend was down; mail at 3 a.m.

## 11. Cost

Estimates are at the time of writing; check at install.

- **Resend:** the free tier (3,000 emails a month, 100 a day) covers the expected volume.
  That is roughly 100 to 300 personal emails a month plus under 10 staff digests a day.
  Pro (about $20 a month) is needed only if a semester-start burst passes 100 a day.
- **Web Push:** free (the browser vendors' push services).
- **Workflow runs:** one per notification plus one digest run a day, which is negligible
  next to research.
- **Model cost:** none; no model is involved.

## 12. Risks

- **Deliverability to cornell.edu.** Cornell's filters may junk mail from a new domain.
  *Mitigation:* SPF, DKIM and DMARC at setup, plain text, low volume, and a test send to
  Luis and Niti before phase 1 ships.
- **Parity dependency slips.** Enqueueing from today's server actions would duplicate the
  notification logic across surfaces. *Mitigation:* wait for parity phase 1, which is a
  mechanical refactor.
- **Notification fatigue.** Staff mute everything. *Mitigation:* one digest, only
  non-empty sections, and immediate mail only for a person's own records.
- **The outbox blocks writes.** Inserting in-transaction means a broken `notifications`
  table fails ticket writes. *Mitigation:* the insert is trivial and covered by
  migration tests; see Q5.
- **iOS push limits** (install-to-home-screen only) make push patchy for students. That is
  why email is primary.

## 13. Open questions

| # | Question | Recommendation | Who |
|---|---|---|---|
| 1 | **Sending domain and Reply-To.** Which domain can the lab put SPF/DKIM on, and which shared inbox gets replies? | A lab-controlled subdomain; Reply-To the MakerLab shared inbox | Isaac, with Cornell IT if needed |
| 2 | **Is Resend acceptable as a processor of student emails** under Cornell policy? | Ask Cornell IT/privacy before phase 1 ships; Cornell SMTP relay is the fallback if it is refused | Isaac |
| 3 | **Include the staff-written resolution text** in the student's "resolved" email? | Yes. It is the useful part. Staff are told on `/admin/maintenance` that it is shown to the reporter | Isaac + Luis |
| 4 | **Defaults: on or opt-in** for the three personal events? | On, with one-click off. They concern the person's own report | Isaac |
| 5 | **Enqueue inside the transaction** (a failed insert fails the write), or after commit (a failed insert loses the email)? | Inside. Losing an email silently is worse than a rare failed save | Isaac |
| 6 | **Digest time and weekends.** 08:00 daily including weekends, or weekdays only? | 08:00, weekdays only by default; weekly = Monday | Luis + Niti |
| 7 | **Which staff get the backup/mirror lines?** Only `users.manage` (super admins), or the tech lead too? | Super admins only; the heartbeat stays the real alarm | Isaac |
| 8 | **Is Web Push worth phase 3 at all**, given iOS limits, or does email cover the need? | Build phases 1–2, then decide from usage | Isaac, after phase 2 |
| 9 | **Retention of the delivery log.** Is 180 days right? | 180 days: long enough to answer "did they get it" for a semester | Isaac |

Q1, Q2 and Q5 block phase 1. Q3, Q4, Q6 and Q7 block phase 2. Q8 gates phase 3.
