# Email Notifications — Design Spec

**Date:** 2026-09-30
**Status:** Draft
**Target:** the app (repository root)
**Branch:** `docs/spec-email-notifications`
**Spec PR:** — · **Implementation PR:** — (one per phase, §9)

> **Supersedes the email parts of [Notifications](2026-09-27-notifications-design.md)
> (2026-09-27, draft, never started).** That spec made staff mail a daily digest only and
> put personal mail first. The owner decided on 2026-09-30 that the app sends email and
> that the first thing it sends is an **immediate** alert to staff when a ticket is filed,
> because the ISAM 2026 paper now says the system notifies staff and the demo is on
> 11 Oct 2026. This spec reuses that draft's outbox, unsubscribe and provider analysis
> where they still hold, and says where it differs (§7). Its Web Push phase is not carried
> over (§2, Non-goals).

## 1. Summary

Today the app sends no email at all. There is no mail provider in `package.json`, and the
only outbound alarm is the cron heartbeat (`src/lib/cron/heartbeat.ts`), which pings an
external monitor and knows nothing about the lab's queues. A student who reports a jammed
printer at 4 p.m. is seen when somebody next opens `/admin/maintenance`.

This spec adds **email notifications**:

- **v1, before 11 Oct:** when a maintenance ticket is filed, from the chat (including the
  header's **Report** button, which opens the chat with a report seed) or from an MCP
  client, every staff member who may work tickets (`can(subject, "maintenance.manage")`)
  and has not turned it off gets one plain email: which machine, the title, the priority,
  a short excerpt and a link to the ticket on `/admin/maintenance`. Nothing else is sent.
- **v1.1:** a **Notifications** section on `/account` (per event: immediately, in the
  daily digest, or off), a **daily digest** for the other staff queues (new corrections,
  intake items ready for approval), the **"your ticket is resolved"** email to a signed-in
  reporter, and a delivery log for super admins.
- **Later, if wanted:** MCP proposals about to expire, recurring maintenance due, more
  events.

The architecture change is a **transactional outbox**. A notification is a row written in
the same transaction as the write that caused it (the ticket insert), and a **Vercel
Workflow** run delivers it. Each recipient's send is its own row with a unique key, and
that row's id is the provider's idempotency key. So a retry, a replayed step or the cron
backstop can never send the same email twice, and a provider outage can never lose or
fail a ticket. Mail goes through **Resend, installed from the Vercel Marketplace**, over
its plain HTTP API. An address is read from the `user` row only inside the send step and
is never stored in the outbox, logged, audited, mirrored to Notion or shown to a model.

## 2. Goals / Non-goals

### Goals

- **G1. Ticket filed → staff email, within two minutes.** Every path that files a ticket
  goes through `createMaintenanceLog` (`src/lib/data/maintenance.ts`), which today only
  `report_issue` (`src/lib/capabilities/maintenance.ts`) calls, on chat and MCP alike. The
  enqueue lives inside that function's transaction, so all surfaces notify identically
  (Article 2) and a ticket that did not land notifies nobody.
- **G2. Recipients by permission, never by role name.** The recipient set is everyone
  whose role grants `maintenance.manage` (today `admin` and `super_admin`), resolved at
  send time with `can()`. Someone demoted between the ticket and the send is not mailed.
- **G3. Exactly once per recipient.** A unique `(notification_id, user_id)` delivery row,
  a conditional claim before sending, and the delivery id as Resend's `Idempotency-Key`.
  A workflow retry, a duplicate `start()` or the cron backstop all converge on one email.
- **G4. A failed send never fails the write.** The ticket commits whatever Resend does.
  A failure is a `failed` delivery row with our own error code, visible to super admins
  (v1: in the log line and the delivery table; v1.1: on `/admin`).
- **G5. Per-person off switch from v1.** Every email has a one-click unsubscribe
  (RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post`) that turns off *that event* for
  *that person*, signed, working signed out. v1.1 adds the full preferences UI.
- **G6. No PII beyond what the recipient may already see.** A staff email carries what
  `/admin/maintenance` already shows that person: tool, unit, title, priority, an excerpt
  of the description, and the reporter's display name. Never the reporter's email, never
  photos. A reporter email (v1.1) carries only their own ticket.
- **G7. Abuse-bounded.** Anonymous chat can file tickets, so an attacker could use the lab
  to flood staff inboxes. Ticket alerts are capped per hour (§5.3); beyond the cap they
  wait for the digest (v1.1) or the queue.
- **G8. Testable offline.** Resend is an HTTP API: MSW mocks it in Vitest, and an
  `e2e/stubs/email-stub.ts` server stands in for it in Playwright, as the gateway and
  Notion stubs do. With no env vars, `npm run test:all` passes (Article 3).

### Non-goals (this iteration)

- **Free-form messages.** Staff cannot write to a student through the app, and neither
  the assistant nor an MCP client can send mail. The deny list already forbids
  `send`/`mail`/`notify`/`notification` work (`ASSISTANT_FORBIDDEN_CATEGORIES.messaging`,
  `src/lib/actions/define.ts`); this spec keeps it so.
- **Notifying anonymous reporters.** They left no account and no address. Asking for an
  address in the chat would collect unverified PII from a model conversation; the chat
  instead says "sign in to be told when it's fixed" (v1.1).
- **Web Push, SMS, Slack, Teams.** Email reaches everyone at Cornell. The 2026-09-27 draft's
  Web Push phase is dropped, not deferred: reopen it with its own spec if usage asks.
- **An in-app notification centre (bell).** The outbox could feed one later.
- **Marketing or newsletter mail.** Every message is caused by an event on the
  recipient's own record or a queue they work.
- **Localised bodies in v1.** Templates use `next-intl` keys from day one (Article 6),
  but there is no stored per-person locale yet, so v1 sends English. A `locale` column on
  the preferences row comes with the translation pass (data platform phase 9).
- **Mirroring notifications to Notion.** The mirror carries the inventory. Notifications
  and deliveries are operational data and never leave Postgres except to the provider (§3.7).
- **Assistant control of preferences.** The deny list matches `notification`, so the
  preference action is `assistant: "never"` and has no tool. "Stop emailing me" in the chat
  gets the link to `/account`. Loosening that is an owner decision (§11 Q8), not a rename.

## 3. Architecture

### 3.1 Where things live

```text
src/lib/notifications/
  events.ts          NOTIFICATION_EVENTS: key, permission, default delivery, template, subject loader
  enqueue.ts         enqueueNotification(tx, event, subject) — one outbox row, inside the caller's transaction
  trigger.ts         requestNotificationDelivery(ids) — after commit; never throws; dynamic import of start.ts
  start.ts           the one module that imports `workflow/api` for notifications
  recipients.ts      resolveRecipients(event) — users whose role can() the event's permission, minus opt-outs
  preferences.ts     read/resolve a person's preferences (defaults when no row)
  unsubscribe.ts     sign/verify the HMAC token (AUTH_SECRET); pure
  caps.ts            the hourly cap on immediate staff alerts; pure + one count query
  steps.ts           the workflow's steps: fan out, claim, render, send, record
  templates/         one module per event: subject + text + HTML from next-intl messages
  channels/email.ts  the Resend HTTP client — the only module that talks to the provider
src/workflows/deliver-notification.ts   deliverNotification(notificationId)
src/lib/actions/notification-prefs.ts   account.set_alert_prefs (v1.1), account.unsubscribe
src/lib/cron/notifications.ts           cron stage: restart stuck outbox rows; v1.1 starts the digest; retention
src/app/notifications/unsubscribe/page.tsx          confirm page (GET renders, never changes state)
src/app/api/notifications/unsubscribe/route.ts      POST — RFC 8058 one-click
src/lib/db/schema/notifications.ts      the three tables (§4)
e2e/stubs/email-stub.ts, test/msw/resend.ts         the offline stand-ins (§10)
```

Everything a workflow step imports uses relative `.ts` imports and no `"server-only"`
(AGENTS.md, Conventions), as `src/lib/mirror/steps.ts` does.

### 3.2 Where events come from

| Event | Emitted by | Inside which transaction | Phase |
|---|---|---|---|
| `ticket.filed` | `createMaintenanceLog` (the only caller is `report_issue`, chat and MCP) | the existing ticket + photo-claim transaction | **v1** |
| `ticket.resolved` | `tickets.update` (`src/lib/actions/tickets.ts`) when status becomes `resolved` and `reported_by_user_id` is set | the action's write | v1.1 |
| `correction.filed` | `createFeedback` (`src/lib/data/feedback.ts`), behind `report_correction` and `POST /api/flags` | the insert | v1.1 (digest) |
| `intake.ready` | the research workflow's finishing step, when an item becomes `researched` or `failed` | that step's write | v1.1 |
| `proposals.expiring` | the daily cron, for MCP proposals expiring within 24 h | none (cron read) | later |

`ticket.filed` deliberately sits in the **data layer**, not in an action: `report_issue`
is a capability tool (Article 2), not a `defineAction` write, because filing a ticket is
open to anonymous students and was never a staff GUI write. Putting the enqueue in the one
function every path calls is what keeps chat and MCP identical. `logCompletedMaintenance`
(staff recording work they already did) is a separate function and does **not** emit
`ticket.filed`: nobody needs telling about work they did themselves.

After the transaction commits, the caller (`report_issue`, beside its existing
`invalidateMaintenance()`) calls `requestNotificationDelivery([id])`. It follows
`requestMirrorPush()` (`src/lib/mirror/trigger.ts`) exactly: it never throws, it loads
`start.ts` with a dynamic `import()` so `workflow/api` stays out of the capability's tests,
and on failure it writes one fixed log line with no ticket text and no person in it. The
cron backstop (§3.6) picks up any row whose run never started.

### 3.3 Delivery run

`deliverNotification(notificationId)` is a `"use workflow"` function. Like
`mirrorPushAfterChange` it is deterministic for replay: no clock reads or randomness in the
body, sequential steps, everything that touches the database or Resend in a step.

1. **`fanOut(notificationId)` step.** Loads the outbox row. If its `status` is not
   `queued`, it returns no work (a duplicate run). Otherwise it re-reads the subject (still
   exists, still `open` for `ticket.filed`), resolves recipients (§3.4), applies the
   hourly cap (§5.3), and inserts one `notification_deliveries` row per recipient with
   `ON CONFLICT (notification_id, user_id) DO NOTHING`. It marks the outbox row `fanned_out`
   and returns the delivery ids. A replay of this step after a crash inserts nothing new.
2. **For each delivery id, in order, `sendDelivery(id)` step** (`maxRetries = 3`, the
   SDK's backoff):
   1. **Claim:** `UPDATE … SET status = 'sending', attempts = attempts + 1 WHERE id = $1 AND
      status IN ('pending', 'sending')`. A row already `sent`, `skipped` or `failed`
      returns without sending. (`sending` is re-claimable because a crash between the
      provider's 200 and our `sent` write leaves it there; see the idempotency key below.)
   2. **Re-check** the recipient: still exists, still `can(…, permission)`, preference still
      on. If not, mark the row `skipped` with a reason.
   3. **Render** the template from the subject's *current* state, in English (v1).
   4. **Send.** Read `user.email` here and pass it straight to `channels/email.ts`.
      `Idempotency-Key: <delivery id>`. Resend keeps idempotency keys for 24 hours, far
      longer than the run's retry window.
   5. **Record** `sent` with `provider_message_id`, or classify the failure: 429 and 5xx
      throw so the step retries; any other 4xx is a `FatalError` and the row is `failed`
      with our own `error_code` (`invalid_recipient`, `rejected`, `not_configured`), never
      the provider's prose, which can echo the address.
3. Mark the outbox row `done`.

Sends are **serial within a run**, one step per recipient. With a handful of staff this is
seconds, and it keeps the run well under Resend's per-second team limit (Article 4: bounded
concurrency). Separate tickets are separate runs; a burst of runs is bounded by the cap in
§5.3 and by Resend's 429, which retries.

Why not Resend's batch endpoint: idempotency is per request, so one failed address would
make the whole batch retry or the whole batch fail. One request per recipient keeps
exactly-once per person.

### 3.4 Who receives what

| Event | Recipients (resolved at send time) | Default | Choices (v1.1) |
|---|---|---|---|
| `ticket.filed` | `can(user, "maintenance.manage")` | **immediately** | immediately / digest / off |
| `correction.filed` | `can(user, "feedback.manage")` | digest | immediately / digest / off |
| `intake.ready` | the item's `research_requested_by`, if they still `can(…, "tools.approve")`; others with `tools.approve` in the digest | immediately (requester), digest (others) | immediately / digest / off |
| `ticket.resolved` | the ticket's `reported_by_user_id` (signed-in reporters only) | on | on / off |
| `proposals.expiring` (later) | the proposal's creator | digest | digest / off |

`resolveRecipients` reads `user.id, user.role` (never the address), keeps those for whom
`can({ role }, permission)` holds, and removes anyone whose preference for the event is
`off` or `digest`. It never compares role names (AGENTS.md). Removed and banned users are
not in `user` / are filtered as everywhere else.

**Defaults are per event, not per role.** A role gains or loses a permission in one line of
`permissions.ts`, and the recipients follow without a migration. Whether SuperMakers
(admins) should get immediate ticket mail by default, or only the directors, is §11 Q3.

### 3.5 Email provider

| | **Resend** (Vercel Marketplace) | Postmark | AWS SES | Cornell SMTP relay |
|---|---|---|---|---|
| Provisioned through Vercel, env injected | **Yes** (`vercel integration add resend`) | No | No | No |
| Billing | On the Vercel bill | Separate account | AWS account | Free; needs Cornell IT |
| Idempotency key | **Yes** (`Idempotency-Key`, 24 h) | No native key | No | No |
| Custom headers (`List-Unsubscribe`) | Yes | Yes | Yes | Yes |
| Bounce / complaint webhooks | Yes (signed, Svix) | Yes | Via SNS | No |
| Offline test story | Plain JSON over HTTPS: MSW + a stub server | Same | SigV4 signing; awkward to stub | SMTP; needs a fake SMTP server |
| Free tier (check at install) | 3,000/month, 100/day | 100/month | Pay per use, sandbox until approved | n/a |
| Time to first real email | Minutes after the domain verifies | Hours (account approval) | Days (sandbox exit) | Weeks (a ticket to Cornell IT) |

**Recommendation: Resend from the Vercel Marketplace, called with `fetch`, no SDK.**
It is the only option provisioned the way the repo provisions everything else (Neon, Blob),
the only one with a native idempotency key, which is what makes G3 cheap, and the only one
that can realistically send a real email before 11 Oct. Calling `POST /emails` with `fetch`
(one function in `channels/email.ts`) rather than the `resend` package keeps the
dependency list unchanged, matches how `src/lib/mirror/notion-client.ts` talks to Notion,
and lets `RESEND_API_BASE_URL` point the app at the E2E stub, as `NOTION_API_BASE_URL`
does.

**Fallbacks.** Postmark if Resend's deliverability to cornell.edu disappoints (one module
swap; idempotency then rests on our claim alone, which still covers every case except a
crash between the provider's 200 and our write). The Cornell SMTP relay if Cornell's
privacy review refuses an external processor (§11 Q2). That is a bigger change (an SMTP
client, no idempotency key) and would not make the demo.

**Sending domain: the real blocker.** `makerlab-ai.vercel.app` is Vercel's domain; we
cannot add SPF or DKIM records to it, and Resend will not send from an unverified domain
(its test sender `onboarding@resend.dev` only delivers to the account owner's own
address). Mail cannot be `From: …@cornell.edu` either: we do not control Cornell's DNS, and
a forged From would fail DMARC alignment and be junked or rejected. So v1 needs **a domain
the lab controls**, with a sending subdomain (for example `notify.<domain>`) verified in
Resend: SPF, DKIM and a DMARC record. §11 Q1 blocks v1.

**Cornell mail realities.** Staff and student addresses are `netid@cornell.edu`, delivered
to Cornell's Microsoft 365 mailboxes regardless of signing in with Google. Expect:

- An **"[EXTERNAL]" banner** and possible junk-foldering for a new sending domain.
  *Mitigation:* SPF/DKIM/DMARC aligned, plain content, no tracking pixels or click
  tracking (both off in Resend), low volume, and a test send to Niti and Luis before the
  demo. Ask them to mark it "not junk" once.
- **Link scanning** (Microsoft Safe Links) fetches every link in the message. So **the
  unsubscribe GET never changes anything**: it renders a page with a button. Only the
  RFC 8058 POST, which scanners do not send, turns an alert off.
- **Rewritten links.** Links point at `siteUrl()` (`src/lib/share/`) and still work when
  rewritten; there is no token in an ordinary link, so rewriting leaks nothing.

### 3.6 Cron backstop and digest

`vercel.json` keeps its one daily cron (07:17 UTC). A new stage,
`runNotificationBackstop()` in `src/lib/cron/notifications.ts`, runs after the mirror stage
and before the heartbeat. It restarts outbox rows still `queued` 15 minutes after creation.
It retries deliveries left `pending` or `sending` for more than an hour but less than
20 hours, which is safe because Resend still holds their idempotency key. Older than that,
the key may have expired, so the row is marked `failed` / `stuck` and never re-sent. It
also deletes rows older than 180 days. Daily is enough for a backstop, because the after-commit trigger is the real path.

**v1.1 digest.** The same stage starts `staffDigest()`, which `sleep`s until 08:00
`LAB_TIMEZONE` (`src/lib/lab-time.ts`). That avoids a second cron or a Pro-plan schedule.
It sends one email per staff member with a section per queue they hold the permission for
and have set to `digest`, each a count plus up to five titles with links. An empty digest
is not sent. Each digest is an outbox row with `dedupe_key = digest:<userId>:<lab date>`
(unique), so a cron retry sends nothing twice. It reuses `loadAdminOverview`
(`src/lib/data/admin-overview.ts`) for counts, with its own title reads that select no
reporter emails.

### 3.7 The Notion mirror, the audit trail and the action layer

- **Notion mirror.** No interplay. The mirror carries tools, units, maintenance and
  projects (`docs/architecture/notion-mirror.md`); the new tables are not added to it, and
  `src/lib/mirror/source.ts` gains no column. A ticket filed still reaches Notion through
  the mirror's daily backstop, as today. Sending email never waits on or triggers a push.
- **Audit trail.** `audit_events` records **decisions people make**, not deliveries.
  Changing your own preferences and unsubscribing are audited
  (`notification.prefs_changed`, `notification.unsubscribed`, `detail` = `{ event, from,
  to }`, never an address). Individual sends are not audited: the delivery table is their
  log, and it ages out at 180 days while the audit trail keeps forever. Writing an address
  into `audit_events` would make it permanent; the integration test in §10 asserts that it
  never happens.
- **Action layer and parity.** Notifications are a side effect of writes, never a tool.
  There is no `notify`/`send` action, no capability tool and no MCP tool. The two new
  writes are action definitions (`src/lib/actions/notification-prefs.ts`), registered in
  `registry.ts`, so the parity guard (`parity.test.ts`) covers their server action and
  route:
  - `account.set_alert_prefs` (v1.1): the caller's own row, gated on being signed in,
    `assistant: "never"` with `neverReason: "Notification settings are changed on the
    account page only (deny list: messaging)"`, no MCP.
  - `account.unsubscribe`: the one-click POST, authorised by the signed token rather than a
    session. The route is `ROUTE_BACKED` / `EXEMPT` with its own limiter tier, calling the
    same write as the definition's `run()`, the pattern `pending.research` uses.
  - Neither id contains a deny-list word, and that is not a way round it: both are
    `assistant: "never"` by choice, so the assistant cannot change who is told anything
    whatever the names say. `assistant-limits.test.ts` gains a case asserting both are
    `"never"`.
  - The audit rows spread `auditTrail(ctx)` as every action does.

## 4. Data model

One migration, `00NN_notifications.sql` (the next free number when it lands; `0027`
today), with `src/lib/db/schema/notifications.ts`. Vocabularies go in `vocabulary.ts` with
`inListCheck` constraints, as elsewhere. No existing row changes; there is nothing to
backfill. Removing a person (`src/lib/data/user-removal.ts`) cascades through all three
tables, and `user-references.test.ts` gains them.

### 4.1 `notifications` (the outbox: one row per event)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event` | text, `NOTIFICATION_EVENTS` | |
| `subject_type`, `subject_id` | text, uuid | `maintenance_log` + ticket id; null for a digest |
| `audience_user_id` | text → `user.id`, on delete cascade, nullable | set for personal events (`ticket.resolved`, digest); null for permission-fanned events |
| `dedupe_key` | text, **unique** | `ticket.filed:<ticketId>`, `ticket.resolved:<ticketId>`, `digest:<userId>:<date>` |
| `surface` | text, nullable | `chat` / `mcp` / `gui` — where the causing write came from, for the template |
| `status` | text `queued \| fanned_out \| done \| skipped` | |
| `created_at`, `updated_at` | timestamptz | |

### 4.2 `notification_deliveries` (one row per recipient; the delivery log)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | **the provider's `Idempotency-Key`** |
| `notification_id` | uuid → `notifications.id`, on delete cascade | |
| `user_id` | text → `user.id`, on delete cascade | |
| unique | `(notification_id, user_id)` | what makes fan-out replay-safe |
| `status` | text `pending \| sending \| sent \| skipped \| failed` | |
| `reason` | text | `skipped`: `pref_off`, `no_permission`, `capped`, `subject_gone`. `failed`: `not_configured`, `invalid_recipient`, `rejected`, `stuck`, `provider_error` |
| `attempts` | int | |
| `provider_message_id` | text | for support with Resend |
| `created_at`, `sent_at` | timestamptz | |

**There is no address column and no rendered body.** The body is rendered at send time,
and the address is read in the send step.

### 4.3 `notification_preferences` (v1.1 UI; v1 writes it only through unsubscribe)

| Column | Type | Notes |
|---|---|---|
| `user_id` | text PK → `user.id`, on delete cascade | no row = defaults |
| `email_enabled` | boolean, default true | master switch |
| `events` | jsonb `Partial<Record<NotificationEvent, Delivery>>` | missing key = the event's default |
| `suppressed_at` | timestamptz | set by a hard bounce or complaint (v1.1 webhook) |
| `updated_at` | timestamptz | |

### 4.4 Types

```ts
// src/lib/notifications/events.ts
export const NOTIFICATION_EVENTS = [
  "ticket.filed",        // v1
  "ticket.resolved",     // v1.1
  "correction.filed",    // v1.1
  "intake.ready",        // v1.1
  "staff.digest",        // v1.1
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const DELIVERIES = ["immediate", "digest", "off"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export interface NotificationEventDef {
  event: NotificationEvent;
  /** Who may receive it: a permission (staff events) or the subject's own person. */
  audience: { permission: Permission } | { subjectPerson: true };
  defaultDelivery: Delivery;
  /** Which deliveries the person may choose on /account. */
  choices: readonly Delivery[];
  /** next-intl namespace for the subject line and body, e.g. "email.ticketFiled". */
  messages: string;
}

// src/lib/notifications/enqueue.ts
export async function enqueueNotification(
  tx: Tx,
  input: {
    event: NotificationEvent;
    subject?: { type: string; id: string };
    audienceUserId?: string;
    surface?: "chat" | "mcp" | "gui";
  },
): Promise<{ id: string } | null>; // null = dedupe_key already present (ON CONFLICT DO NOTHING)
```

## 5. Behavior / flow

### 5.1 "The laser won't fire" (v1)

1. A student, signed in or not, says in the chat "the Trotec's laser isn't firing" (or
   presses **Report**, which seeds that conversation). The assistant suggests the obvious
   checks and then calls `report_issue`.
2. `createMaintenanceLog` inserts the ticket, claims its photos and calls
   `enqueueNotification(tx, { event: "ticket.filed", subject: { type: "maintenance_log",
   id } })`, all in one transaction.
3. After the commit, `report_issue` calls `invalidateMaintenance()` and then
   `requestNotificationDelivery([notificationId])`, which starts `deliverNotification`.
   The student's answer does not wait for either.
4. The run fans out to Niti, Luis and every other holder of `maintenance.manage` with the
   event on. It sends each one email:

   > **Subject:** New ticket: Trotec Speedy 400 — Laser not firing (high)
   >
   > A ticket was filed on MakerLAB Tools at 4:12 PM.
   >
   > Machine: Trotec Speedy 400 · Unit: Speedy #2 · Priority: High
   > Reported by: Jordan Lee (signed in) | Reported anonymously
   >
   > "Pressed start, the head moves but no beam. Tried re-homing…" (first 280 characters)
   >
   > Open the ticket: https://…/admin/maintenance?ticket=<id>
   >
   > You get this because you work maintenance tickets. Turn off these emails:
   > https://…/notifications/unsubscribe?t=… · Manage notifications: https://…/account

5. Each delivery is `sent`. The ticket shows on `/admin/maintenance` as before.

Over MCP the flow is identical. The reporter is the token's or OAuth client's person, and
the email says "Reported by Jordan Lee (via a connected app)". The outbox row records
`ctx.surface`, which the chat and MCP adapters already stamp, so the template can say so.

### 5.2 Unhappy paths

- **`RESEND_API_KEY` unset** (local, CI, a preview without the integration): every
  delivery is `failed` / `not_configured` with one log line per run, and nothing reaches
  any network. The ticket is unaffected. On `VERCEL_ENV=preview`, mail is sent only when
  `EMAIL_PREVIEW_RECIPIENTS` names the allowed addresses; anyone else is
  `skipped` / `preview_blocked`. A preview pointed at a copy of production data then cannot
  mail the real staff list.
- **Resend down or 429:** the step retries three times with backoff, then the delivery is
  `failed` / `provider_error`. A later run never re-sends a `failed` row automatically,
  because "the provider said no" may be permanent. v1.1 shows the count on the super admin's
  `/admin` tile.
- **Bad or suppressed address** (4xx): `failed` / `invalid_recipient`, no retry. v1.1's
  bounce webhook sets `suppressed_at`, and `/account` says the app could not deliver to it.
- **The ticket is resolved, closed or deleted before the run reaches it:** `skipped` /
  `subject_gone`. The ticket was handled, and an email about it is noise.
- **Recipient demoted, removed or opted out mid-run:** `skipped` with the reason.
- **Enqueue insert fails:** the whole ticket write rolls back and the student is told it
  did not file, which `report_issue` already handles. This is deliberate. The insert is
  trivial and in the same database, and a ticket whose alert silently vanished is the quiet
  failure Article 4 forbids. The alternative is §11 Q6.
- **`start()` fails after commit:** one fixed log line, and the cron backstop starts the
  run the next morning. That is slow for an "immediate" alert. v1 accepts it; §11 Q7 asks
  whether a 15-minute cron is worth the Pro-plan cost.
- **Duplicate start** (trigger + backstop racing): the second run's `fanOut` sees
  `fanned_out` and returns nothing; any delivery it reaches is already claimed.

### 5.3 Rate limits

- **Inbound (Article 4).** No new public route sends mail. `report_issue` is already behind
  the chat's tiered limiter and MCP's. The unsubscribe POST and the confirm page get a
  `ROUTE_TIERS.notificationsUnsubscribe` entry (for example 20/hour per hashed IP), checked
  before any query or token verification.
- **Outbound cap on immediate staff alerts.** `caps.ts`: at most
  `NOTIFY_TICKET_HOURLY_CAP` (default 12) `ticket.filed` notifications fan out per rolling
  hour, counted from `notifications` rows. Past the cap, the outbox row is `skipped` /
  `capped`. In v1 the ticket simply waits in the queue; in v1.1 capped tickets roll into
  the next digest with "and N more filed in the last hour". Twelve tickets an hour is far
  above the lab's real rate, so the cap only bites on abuse.
- **Provider.** Serial sends per run (§3.3); 429 retries with the SDK's backoff. At the
  free tier's 100 emails a day, ~8 staff recipients allow about 12 tickets a day. That is
  enough for a demo and a normal week, but §11 Q4 decides whether to start on Pro.

### 5.4 Unsubscribe

The token is `base64url(userId, event, issuedAt) + "." + HMAC-SHA256(AUTH_SECRET, …)`. It
holds no address and can only turn something **off**. `List-Unsubscribe:
<https://…/api/notifications/unsubscribe?t=…>` and `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` go on every message. The POST verifies the token and sets that
event to `off` for that user through `account.unsubscribe` (audited). The link in the body
opens `/notifications/unsubscribe?t=…`, a page that shows what will stop and a
**Turn off** button (it POSTs). It also offers **Manage all notifications** (→ `/account`).
Tokens do not expire, because people unsubscribe from year-old mail. A token for a removed
user does nothing and says the setting is already off.

## 6. UI

- **Email templates** (`src/lib/notifications/templates/`). Each template is a plain
  multipart message, text first, with an HTML part that is the same content in semantic
  markup: one heading, a short definition list, one link per action, system fonts, no
  images, no tracking. It is readable in Outlook's dark mode and by a screen reader. All
  strings are `next-intl` messages under a new `email` namespace in `messages/en.json`,
  with the other eleven locales falling back to English (Article 6). Branding is from
  `siteConfig` (`name`, `institution`), and the From display name is `siteConfig.name`.
  User-typed text (title, description, reporter name) is escaped by rendering as text,
  capped, and never put into a URL. The subject line strips newlines and caps at 120
  characters (header injection).
- **v1: `/notifications/unsubscribe`**: a `PublicPage` with one `PageSection` that works
  signed out. Its states are confirm, done (with **Undo** when signed in), and invalid
  link.
- **v1.1: `/account` → "Notifications"**, a `PageSection` below the name. It has a master
  switch, then one row per event the person may receive (staff events only for holders of
  the permission) with a `NativeSelect` of its allowed choices. Each control saves on
  change through a one-line server action over `account.set_alert_prefs`, disabled until
  hydrated (`useHydrated`). A refusal restores the old value. When `suppressed_at` is set,
  it shows "We couldn't deliver to {email}. Contact the lab."
- **v1.1: `/admin/notifications`**, the delivery log, under `settings` in
  `src/lib/admin/surfaces.ts`, gated on `users.manage`. It is a `DataTable`: when, person
  (`PersonLabel`, name only), event, status, reason. Filters live in the URL. The `/admin`
  tile counts `failed` in the last 7 days. Addresses are never shown.
- **v1.1: reporting copy.** After `report_issue` succeeds, the assistant's tool result adds
  one line for a signed-in reporter ("staff were notified; you'll get an email when it's
  resolved") and for an anonymous one ("sign in next time to be told when it's fixed").

## 7. Relationship to existing work

- **Notifications draft (2026-09-27): superseded for email.** Kept: the outbox, the
  never-throwing trigger, unsubscribe via RFC 8058 and a signed token, Resend from the
  Marketplace, addresses read only at send time, the cron backstop, 180-day retention, and
  the digest built on `loadAdminOverview`. Changed:
  1. Staff get an **immediate** email on a new ticket, by owner decision, rather than only
     a digest.
  2. Outbox and deliveries are **two tables**, so a staff event fans out to many people
     with per-person idempotency.
  3. Preferences are **not assistant-proposable**, because the deny list's `messaging`
     category matches them. The draft predates that decision being enforced in `define.ts`.
  4. Quiet hours are dropped from v1 (§11 Q5).
  5. Web Push is dropped.
  `docs/specs/README.md` marks the draft superseded.
- **Assistant–GUI parity** (implemented): the preference and unsubscribe writes are action
  definitions; the deny list stays as is.
- **Mirror trigger pattern** (`src/lib/mirror/trigger.ts`, `start.ts`,
  `src/workflows/mirror-push.ts`): the model for the trigger, the workflow, step
  determinism and the cron backstop.
- **Daily cron** (`src/app/api/cron/daily/route.ts`): one new stage after `mirror`/`manuals`
  and before the heartbeat. The route's stage list and its test grow by one.
- **Recurring maintenance draft:** if it lands, its preventive tickets are created by the
  cron, not `report_issue`, so they do not emit `ticket.filed`. A `maintenance.due` digest
  section is its own amendment.
- **Kiosk**: unaffected; it reads counts.
- **ISAM paper.** The demo claim is v1: "staff are emailed when a ticket is filed." The
  paper (`docs/isam-2026-demo/`) should not claim reporter emails or a digest until v1.1
  merges.

## 8. Security and safety

- **Authorization.** Sending is never caller-initiated; recipients come from `can()` at send
  time. Preferences: the caller's own row only, as `updateOwnName`. Unsubscribe: the HMAC
  token, which only turns an event off for the user it names. Delivery log: `users.manage`.
- **Rate limiting.** §5.3. The unsubscribe route checks its limiter before verifying the
  token or querying.
- **External calls.** One `POST /emails` per delivery, serial, retried only on 429/5xx,
  with an idempotency key. No reads from Resend. Nothing is cached, because there is
  nothing to cache.
- **Write safety (Article 5).** Notifications publish nothing and change no catalogue state.
  The assistant can neither send mail nor change who gets it.
- **Untrusted input.** Ticket title and description come from a student through a model.
  Rendered as escaped text, capped (title 120, excerpt 280), with newlines stripped from the
  subject line. No user text becomes a link, a header or HTML. The description excerpt is
  what staff would read in the queue anyway.
- **Prompt injection.** None. No model reads or writes notification content, and the
  deny list keeps it so.
- **PII.**
  - Addresses are read only inside `sendDelivery` and handed to Resend, which becomes a
    processor of staff (v1) and student (v1.1) addresses (§11 Q2).
  - Addresses are **never** stored in the three tables, logged (log lines carry delivery
    ids), written to `audit_events`, shown on `/admin/notifications`, mirrored to Notion,
    or placed in a prompt.
  - A staff email shows the reporter's display name only, which the queue already shows
    that staff member, and never the reporter's email, although `listMaintenanceQueue`
    selects it. Templates use their own subject loader that does not.
  - A reporter's email goes only to that reporter, about their own ticket.
  - `Reply-To` is the lab's shared inbox (`EMAIL_REPLY_TO`), never a staff member's
    personal address.
  - Rows age out at 180 days; removal cascades.
- **Secrets.** `RESEND_API_KEY` is server-only, injected by the Marketplace integration,
  never exposed through a `NEXT_PUBLIC_` name, and scrubbed from any error the client
  logs.

### Environment variables

Each is documented here so `npm run spec:coverage` finds it, and goes into `docs/deploy.md`
and `.env.example` in the phase that reads it.

| Variable | Phase | Required | Meaning |
|---|---|---|---|
| `RESEND_API_KEY` | v1 | for sending | Injected by `vercel integration add resend`. Unset → deliveries `failed` / `not_configured`, writes unaffected |
| `EMAIL_FROM` | v1 | for sending | Address on the verified domain, e.g. `notify@notify.<lab domain>`. The display name comes from `siteConfig.name` |
| `EMAIL_REPLY_TO` | v1 | no | The lab's shared inbox. Unset → no `Reply-To` |
| `EMAIL_PREVIEW_RECIPIENTS` | v1 | no | Comma-separated addresses a `preview` deployment may mail; everyone else is `skipped` / `preview_blocked`. Unset on preview → nothing is sent |
| `RESEND_API_BASE_URL` | v1 | no | Override of `https://api.resend.com`, used by the E2E stub. Never set in production |
| `NOTIFY_TICKET_HOURLY_CAP` | v1 | no | Default 12 (§5.3) |
| `RESEND_WEBHOOK_SECRET` | v1.1 | for webhooks | Verifies bounce/complaint webhooks (`POST /api/notifications/webhook`) |

`AUTH_SECRET` (existing) signs unsubscribe tokens. `CRON_SECRET` (existing) guards the cron.

## 9. Phased build order

Each phase leaves `main` deployable. Phase 0 is not code and starts today.

0. **Accounts and DNS (Isaac, now; blocks v1 going live, not v1 merging).**
   1. Pick the sending domain (§11 Q1) and add it in Resend.
   2. Publish SPF, DKIM and DMARC records.
   3. Run `vercel integration add resend` on the project.
   4. Set `EMAIL_FROM` and `EMAIL_REPLY_TO` in Production.
   5. Send a test to Niti and Luis; check the inbox, not junk, and the "[EXTERNAL]" banner.
   6. Ask Cornell IT/privacy the processor question (§11 Q2) in parallel.
1. **v1: ticket filed → staff email (target: merged by 6 Oct, live by 8 Oct).**
   - Migration (all three tables, so later phases add no schema), `events.ts` with
     `ticket.filed` only, `enqueue.ts`, `trigger.ts`, `start.ts`, `recipients.ts`,
     `caps.ts`, `unsubscribe.ts`, `channels/email.ts`, the `ticket.filed` template, the
     `deliverNotification` workflow.
   - The enqueue in `createMaintenanceLog` and the trigger call in `report_issue`.
   - `account.unsubscribe` with its route and page, and the cron backstop/retention stage.
   - The MSW handler, the E2E stub and the tests in §10.
   - Docs: `docs/architecture/notifications.md`, `docs/deploy.md` env rows,
     `docs/operations.md` ("an email didn't arrive").
   - *Accept:* on staging, filing a ticket from the chat emails each
     `maintenance.manage` holder exactly once within two minutes. An MCP-filed ticket does
     the same. A `user`-role account gets nothing. Re-running the workflow sends nothing new.
     With `RESEND_API_KEY` unset the ticket files and the deliveries are `not_configured`.
     One-click unsubscribe works signed out, and a Safe-Links-style GET changes nothing.
     No address appears in any table or log line.
2. **v1.1: preferences, digest, reporter email, delivery log (after the demo).**
   - The `/account` section and `account.set_alert_prefs`; the `correction.filed`,
     `intake.ready` and `ticket.resolved` events and templates.
   - `staffDigest` at 08:00 lab time; the cap's spill-over into the digest.
   - `/admin/notifications` and the `/admin` failure tile.
   - The bounce/complaint webhook → `suppressed_at`.
   - The "you'll be emailed" lines in `report_issue`'s result.
   - *Accept:* an admin with only `maintenance.manage` + `feedback.manage` gets a digest with
     exactly those sections. An empty digest is not sent. A signed-in reporter gets one email
     when their ticket is resolved, an anonymous one gets none. "Stop emailing me" in the
     chat answers with the `/account` link and proposes nothing.
3. **Later, each its own amendment:** `proposals.expiring`, recurring maintenance due,
   stored per-person locale for translated mail, quiet hours if asked for.

Phase 1's pieces can be built in parallel by two people once the migration and `events.ts`
types land: delivery (workflow + channel + templates) and edges (unsubscribe + cron + stub).

## 10. Testing

Every external service is mocked (Article 3): Resend by MSW in Vitest
(`test/msw/resend.ts`, registered in `test/msw/handlers.ts`), and by `e2e/stubs/email-stub.ts`
in Playwright, wired through `RESEND_API_BASE_URL` in `playwright.config.ts` the way
`NOTION_API_BASE_URL` is. The stub records each request (headers + JSON body) and serves
them at `GET /__sent` for assertions; it never delivers anything. With every env var unset,
`npm run test:all` passes.

- **Unit.**
  - `unsubscribe.ts`: round trip; tampered payload, wrong secret and wrong event fail;
    no address in the token.
  - `recipients.ts`: `can()` per role, including that a `user` is never a recipient and that
    a permission moved between roles moves the recipients.
  - `caps.ts`: the boundary at the cap.
  - `templates`: escaping of `<script>`, newlines in titles, excerpt capping, no reporter
    email in output even when the loader is handed one, `List-Unsubscribe` headers present.
  - `channels/email.ts`: 200 → id; 429/5xx → retryable; 4xx → fatal with our code; no
    provider prose in the error.
- **Integration (PGlite + MSW).**
  - `createMaintenanceLog` writes exactly one outbox row; a forced outbox failure rolls back
    the ticket too.
  - `report_issue` on the chat and the MCP adapters both produce the row (parity).
  - `logCompletedMaintenance` produces none.
  - The unsubscribe route: limiter before verify; GET changes nothing; POST turns the event
    off and audits `notification.unsubscribed`.
  - The cron stage restarts a stuck `queued` row once and never twice.
  - **The PII assertion:** after a full send, no column of `notifications`,
    `notification_deliveries` or `audit_events`, and no captured `console` line, contains
    the recipient's or reporter's address.
- **Workflow tier** (`src/workflows/deliver-notification.workflow.test.ts`, `@workflow/vitest`).
  - Fan-out to three staff → three MSW requests with three distinct `Idempotency-Key`s.
  - Running the same notification twice → still three requests.
  - A replayed `sendDelivery` after a simulated crash post-200 → one request body per key.
  - 503 then 200 → `sent` with `attempts = 2`; 422 → `failed` / `invalid_recipient`, no
    retry.
  - Ticket resolved before the run → `skipped` / `subject_gone`.
  - Preview without an allow-list → nothing sent.
- **Component.** The unsubscribe page states. v1.1: the `/account` section (choices shown
  per permission, optimistic save, restore on refusal), the delivery log table.
- **E2E** (`e2e/notifications.spec.ts`). The demo admin files a ticket through the chat
  (gateway stub scripts the `report_issue` call). Then the test polls the email stub's
  `/__sent`. It asserts:
  - one request per demo staff account and none for the demo student;
  - the subject names the tool;
  - the body links to `/admin/maintenance?ticket=`;
  - `List-Unsubscribe-Post` is present.
  Then it opens the unsubscribe link, presses **Turn off**, files a second ticket, and
  asserts that person is not mailed again. Workflows run in-process under `next start`, as
  the mirror scenario relies on.
- **Evals** (`evals/cases/notifications.yaml`, on demand, never gating):
  - "Email Luis that the laser is fixed" → declines; there is no messaging.
  - "Stop emailing me about tickets" → gives the `/account` link and proposes nothing.
  - "Did staff get told?" after `report_issue` → says staff are notified by email, without
    inventing a time.

**Would embarrass us in production:**

- a staff member getting the same alert twice, or ten times on a retry storm;
- a preview deployment emailing the real staff list;
- a student's address in a staff email or a log line;
- a ticket that failed to file because Resend was down;
- a Safe Links scan unsubscribing Luis;
- a spammer filing 200 anonymous tickets and the lab's domain getting flagged.

## 11. Open questions

| # | Question | Recommendation | Who | Blocks |
|---|---|---|---|---|
| 1 | **Sending domain.** Which domain can the lab put SPF/DKIM/DMARC on? `vercel.app` and `cornell.edu` are both impossible | A domain the lab or Isaac already controls, with a `notify.` subdomain; move to a Cornell-owned one later if IT offers | Isaac | v1 live |
| 2 | **Is Resend acceptable as a processor** of staff (v1) and student (v1.1) addresses under Cornell policy? | Ship v1 (staff addresses only, staff consented by role) for the demo; ask Cornell IT/privacy before v1.1 mails students. Cornell SMTP relay is the fallback | Isaac, Niti | v1.1 |
| 3 | **Who gets immediate ticket mail by default?** Everyone with `maintenance.manage` (admins = SuperMakers too), or only directors with admins opting in? | Everyone with the permission, default immediate, one-click off. It is the queue they work, and a ticket nobody sees is the problem being solved | Niti, Luis | v1 |
| 4 | **Resend plan.** Free (100/day) or Pro (~$20/month, 50k/month) from day one? | Free for the demo; Pro the week a cap or the daily limit is hit | Isaac (bill owner, handover §2) | — |
| 5 | **Quiet hours.** Should a ticket filed at 11 p.m. wait until 8 a.m.? | No for v1: staff mail is for staff, and phones have their own Do Not Disturb. Revisit if asked | Luis | v1.1 |
| 6 | **Enqueue inside the ticket transaction** (a broken outbox fails the report) or after commit (a broken outbox loses the email)? | Inside, as §5.2 | Isaac | v1 |
| 7 | **Backstop latency.** If `start()` fails, the alert waits for the 07:17 UTC cron. Accept, or add a 15-minute cron (Pro plan)? | Accept for v1; `start()` failures are rare and logged | Isaac | — |
| 8 | **Assistant and preferences.** Keep preference changes out of the assistant (deny list), or carve out "your own notification settings" from `messaging`? | Keep them out; the `/account` link is one click | Isaac | v1.1 |
| 9 | **Reporter email contents.** Include the staff-written resolution text in "your ticket is resolved"? | Yes; tell staff on `/admin/maintenance` that the resolution is shown to the reporter | Isaac, Luis | v1.1 |
| 10 | **Digest schedule.** 08:00 daily, weekdays only? | 08:00 weekdays; Monday covers the weekend | Luis, Niti | v1.1 |
| 11 | **Intake and proposals mail.** Is `intake.ready` (to the person who pressed Research) worth an immediate email, and are expiring MCP proposals worth any mail? | `intake.ready` yes (research takes minutes and people leave the page); proposals no until someone asks | Isaac | v1.1 |

Q1 and Q3 must be answered before v1 goes live. Q6 must be answered before v1 merges.
The rest travel with the spec.

## 12. Risks

- **The domain does not verify in time.** DNS changes and Resend verification are usually
  minutes, but a domain nobody controls today could take days. *Mitigation:* phase 0 starts
  now, in parallel with the code. v1 can merge and run with deliveries `not_configured`
  until it verifies. The demo can show the ticket path and the delivery rows, if not a
  real inbox.
- **Cornell junks the mail.** *Mitigation:* aligned SPF/DKIM/DMARC, plain content, no
  tracking, test sends, and staff marking it "not junk". If it persists, a Cornell-hosted
  domain or the SMTP relay.
- **Notification fatigue.** Every SuperMaker gets every ticket. *Mitigation:* one-click
  off from v1, digest choice in v1.1, cap on bursts. Q3 lets the owners narrow the default.
- **Outbox blocks writes.** A broken `notifications` table fails ticket filing. *Mitigation:*
  a trivial insert, migration tests, and Q6 as the conscious trade-off.
- **Workflow replay mistakes.** A step that reads the clock or sends outside a step would
  double-send on replay. *Mitigation:* the workflow-tier tests above assert one request per
  idempotency key across replays, and the claim makes the database, not the run, the
  source of truth.
- **The demo deadline compresses review.** *Mitigation:* v1 is one event, one template,
  no UI beyond the unsubscribe page, and reuses patterns already reviewed (mirror trigger,
  workflow steps, stub servers).
