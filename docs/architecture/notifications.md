# Email notifications

> Spec: [`docs/specs/2026-09-30-email-notifications-design.md`](../specs/2026-09-30-email-notifications-design.md)
> (approved 2026-10-07; v1 and the recurring-maintenance reminder amendment are built).
> Paths are relative to the repository root.

The app emails staff. Two things, nothing else:

- **A ticket was filed.** A ticket filed from the chat, the report form (the header's
  **Report** button and a unit's QR label open the chat with the report started) or an MCP
  client emails everyone whose role `can()` `maintenance.manage`: the machine, the unit, the
  title, the priority, the reporter's display name, an excerpt, and a link to the ticket on
  `/admin/maintenance#ticket-<id>`.
- **A recurring task came due.** At 08:00 lab time on the day a task comes due, the same
  people get one email naming it (the day's newly due tasks together), with a link to the
  Shift checklist (`/admin/maintenance#due-tasks`). Each task is emailed once per due date,
  never again while it stays overdue. Nothing newly due, nothing sent.

Both carry the official logo (`siteConfig.logoPng`) on a white band and a one-click
unsubscribe. Neither the assistant nor an MCP client can send mail or change who gets it
(deny list: `messaging`).

## The pieces

| File | What it does |
|---|---|
| `src/lib/db/schema/notifications.ts`, migration `0030` | `notifications` (the outbox: one row per event, unique `dedupe_key`), `notification_deliveries` (one row per recipient; its id is the provider's `Idempotency-Key`; unique `(notification_id, user_id)`), `notification_preferences` (per person; no row = defaults), `maintenance_reminder_items` (which task and due date a reminder named; primary key `(schedule_id, due_on)`). **No address and no rendered body in any of them.** Removing a person cascades |
| `src/lib/notifications/events.ts` | `NOTIFICATION_EVENT_DEFS`: each event's permission and default |
| `src/lib/notifications/enqueue.ts` | `enqueueNotification(tx, …)`: one outbox row inside the caller's transaction, `ON CONFLICT DO NOTHING` |
| `src/lib/notifications/recipients.ts` | `resolveRecipients` (roles that `can()` the permission, not banned, preference `immediate`) and `checkRecipient` (the send-time re-check). Reads `id` and `role`, never the address |
| `src/lib/notifications/deliver.ts` | The work: `fanOutNotification`, `sendDelivery` (claim, re-check, render, read the address, send, record), `finishNotification`, and `deliverInline` for when no workflow is started |
| `src/lib/notifications/steps.ts`, `src/workflows/notifications.ts` | `deliverNotification(id)` and `maintenanceReminder()`: thin `"use step"`s over `deliver.ts` and `reminder.ts`; sequential, deterministic for replay |
| `src/lib/notifications/trigger.ts`, `after-response.ts`, `start.ts` | `requestNotificationDelivery(ids)` after the ticket commits; never throws. Configured: starts a run (`start.ts`, the one `workflow/api` import). Not configured: runs `deliverInline` in process |
| `src/lib/notifications/channels/email.ts` | The Resend client, the only module that talks to the provider: `POST /emails` with `fetch`, no SDK |
| `src/lib/notifications/templates/` | `ticket-filed.ts`, `maintenance-due.ts`, the shared `html.ts` (escape, caps, layout with the logo) and `copy.ts` (the English words) |
| `src/lib/notifications/subjects.ts` | What a template is rendered from, read at send time; never selects an email |
| `src/lib/notifications/unsubscribe.ts`, `unsubscribe-write.ts`, `unsubscribe-limit.ts` | The HMAC token (`AUTH_SECRET`), the write (audited `notification.unsubscribed`), the limiter |
| `src/app/api/notifications/unsubscribe/route.ts` | `POST` only: RFC 8058 one-click, and the confirm page's form |
| `src/app/notifications/unsubscribe/page.tsx`, `src/components/notifications/UnsubscribeView.tsx` | The confirm page; opening it never changes anything. Public, in all 12 locales (`unsubscribe` namespace) |
| `src/lib/notifications/reminder.ts`, `src/lib/cron/notifications.ts` | The maintenance reminder (tasks newly due, each once per due date) and the cron stage (backstop, retention, reminder start) |

## A ticket, end to end

1. `report_issue` (chat and MCP alike) calls `createMaintenanceLog`, which inserts the ticket,
   claims its photos and writes the `ticket.filed` outbox row **in one transaction**. A
   ticket that did not land notifies nobody; an outbox insert that fails rolls the ticket
   back, which `report_issue` reports as "not filed". `logCompletedMaintenance` (work staff
   already did) writes no row.
2. After the commit, `report_issue` calls `requestNotificationDeliveryAfterResponse`. Inside a
   request that runs after the answer is sent (`after()`); the student never waits for it.
3. With email configured a `deliverNotification` run starts:
   - **fan out**: if the ticket is no longer open, the row is `skipped` / `subject_gone`; past
     the hourly cap it is `skipped` / `capped`; otherwise one delivery row per recipient and
     the row is `fanned_out`.
   - **send**, one step per recipient: claim the row (`pending` or `sending` → `sending`,
     attempts + 1), re-check the person and the ticket, render from the ticket's current
     state, read the address, send with `Idempotency-Key: <delivery id>`, record `sent` or a
     reason. 429, 409, 5xx and network errors retry with the SDK's backoff; the fourth
     attempt records `failed` / `provider_error`. Any other 4xx is `failed` at once with our
     own code. The provider's words never reach a row or a log line.
   - **finish**: the row is `done`, and one log line with counts.
4. With email not configured, the same functions run in process and every delivery is
   `failed` / `not_configured`. Nothing reaches the network; tests and local development need
   no key (Article 3).

A retry, a replayed step, a duplicate run or the cron backstop cannot send twice: delivery
rows are unique per person, sends claim their row first, and Resend answers a repeated
idempotency key (kept 24 hours) with the first result.

## The maintenance reminder

A recurring task is emailed when it comes due, **once per due date**: never again while it stays
overdue, and again when its next due date arrives after **Done**. The one daily cron (07:17 UTC)
ends with `runNotificationStage()`. With email configured it starts `maintenanceReminder()`,
which computes today's lab date and the wait until 08:00 in `LAB_TIMEZONE` (`labInstant`) in a
step, sleeps, then (`enqueueMaintenanceReminder`) lists the active tasks due by today that no
reminder has named for their current due date (`listNewlyDue`), and, if there are any, writes one
`maintenance.due:<lab date>` outbox row and a `maintenance_reminder_items` row per task
(`schedule_id`, `due_on`) in one transaction, then delivers it the same way. The email is
rendered from those items, leaving out any task checked off since. A second start the same day
finds nothing new. Without email configured, the stage records the reminder at once as
`not_configured`.

## The cron stage

`src/lib/cron/notifications.ts`, after the manual archive stage:

- deliveries still `pending`/`sending` after 20 hours become `failed` / `stuck` and are never
  re-sent (the idempotency key may have expired);
- outbox rows `queued` for 15 minutes, or with sends left over an hour, are restarted
  **once** (`restarted_at`);
- outbox rows older than 180 days are deleted with their deliveries;
- reminder items whose task has moved past their due date (the cycle is over) are deleted;
- the reminder is started. A start that fails fails the stage, like the mirror's.

## Unsubscribe

Every email carries `List-Unsubscribe: <…/api/notifications/unsubscribe?t=…>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and a "Turn off" link to
`/notifications/unsubscribe?t=…`. The token is `v1.<payload>.<HMAC-SHA256>` over the user id,
the event and the time, keyed by `AUTH_SECRET`. It holds no address and can only turn that
event off for that person. Link scanners (Microsoft Safe Links) fetch every link, so the page
**GET** only shows a Turn off button; only the POST changes anything. Both are behind
`ROUTE_TIERS.notificationsUnsubscribe` (20 an hour per hashed IP), checked before the token.
The route is not an action-layer wrapper because it works signed out (parity `EXEMPT`,
"Account gate"). In v1 nothing in the app turns an email back on: someone with database access
removes the event's key from the person's `notification_preferences.events`. The `/account`
preferences section that does it is v1.1.

## Privacy

- Addresses are read only inside `sendDelivery` and handed to Resend. They are never stored
  in the three tables, logged, audited, mirrored to Notion or put in a prompt.
- A staff email shows the reporter's display name ("signed in", "via a connected app", "name
  not verified", or "Reported anonymously"), never their address or photos.
- On `VERCEL_ENV=preview` only `EMAIL_PREVIEW_RECIPIENTS` are mailed; everyone else is
  `skipped` / `preview_blocked`.
- Ticket text is escaped, capped (title 120, excerpt 280) and kept out of headers and links;
  the subject line loses its newlines.

## Configuration

`RESEND_API_KEY` and `EMAIL_FROM` turn sending on; `EMAIL_REPLY_TO`,
`EMAIL_PREVIEW_RECIPIENTS`, `NOTIFY_TICKET_HOURLY_CAP` (default 12) and `RESEND_API_BASE_URL`
(tests only) are optional. `AUTH_SECRET` signs unsubscribe links; without it nothing is sent.
Setup: [`deploy.md`](../deploy.md) step 4. When a send goes wrong:
[`operations.md` → An email didn't arrive](../operations.md#an-email-didnt-arrive).

## Tests

- Unit: `unsubscribe.test.ts`, `templates/templates.test.ts`, `channels/email.test.ts`
  (MSW), `reminder.test.ts`, `lab-time.test.ts`.
- Integration (PGlite + the MSW Resend fake, `test/msw/resend.ts`): `deliver.test.ts`
  (recipients, exactly once, retries, preview, cap, the PII assertion, the reminder),
  `src/lib/cron/notifications.test.ts`, the unsubscribe route test, and `report_issue` on the
  chat and MCP surfaces in `src/lib/capabilities/maintenance.test.ts`.
- Workflow tier: `src/workflows/notifications.workflow.test.ts` (`@workflow/vitest`).
- Component: `UnsubscribeView.test.tsx`; the ticket anchor in `MaintenanceQueue.test.tsx`.

The fake treats a repeated idempotency key as the same email, as Resend does, so "one email
per person" is asserted across retries and replays. There is no default Resend handler in
`test/msw/handlers.ts` on purpose: a test that sends without installing the fake fails on
MSW's unhandled request.
