# Demo Pass — Design Spec

**Date:** 2026-10-07
**Status:** Approved by the owner (Isaac Steinberg) on 2026-10-07 — built on `v5/demo-pass`
**Target:** the app (repository root)
**Branch:** `v5/demo-pass` (on `v5/tool-scoped-citations`)
**Spec PR:** — · **Implementation PR:** — (one PR: the owner asked for spec and build together for the ISAM demo on Sunday 11 October)

## 1. Summary

At the ISAM demo on Sunday 11 October, visitors from other schools should be able to
try the live lab's assistant for about as long as a normal demo. Today they cannot do
much: Google sign-in admits only Cornell accounts and a short allowlist, and an
anonymous visitor gets 8 chat messages an hour, keyed on an IP address the whole
conference Wi-Fi shares.

A **demo pass** fixes that without Google. A visitor fills in a short form at
`/demo` (name, email, institution, three optional questions and an unticked
consent box). The app stores the sign-up, sets a signed, httpOnly cookie tied to
that row, and for the next 14 days the visitor uses the app like a signed-in
student: chat with citations and report a problem, with a higher chat allowance
than an anonymous visitor. Each chat turn's AI cost is charged to the pass, up to
**$0.50** (`DEMO_PASS_BUDGET_USD`). When it is spent, the chat thanks them, gives a
contact line, and carries on at the anonymous limits.

The pass works on the **live lab**, not a sandbox copy (owner decision). So
everything a pass does is marked: its chat turns are a separate `demo` audience in
Usage Insight, and a problem it reports is a ticket flagged **demo** that is left
out of the lab's counts, its public history and the Notion mirror, and is easy to
filter on `/admin/maintenance`. A pass never makes catalogue or admin changes: it
holds no permission at all.

Super admins read the sign-ups on **People → Demo sign-ups** and download them as a
CSV. The sign-ups never reach a model prompt and are never exposed over MCP.

No architecture change: the pass is a cookie the chat route reads beside the session.

## 2. Goals / Non-goals

### Goals

- A visitor with any email address gets a working pass in one short form, linked from
  a clear button on the front page and from the About page.
- A pass holder can chat (citations included) and report a problem; the chat allows
  60 messages an hour per pass, against 8 per IP for an anonymous visitor.
- Every pass turn's cost — the chat model's steps, the manual search's embedding and
  reranking, and Exa web searches — is charged to the pass; the default budget is
  $0.50 and is set by `DEMO_PASS_BUDGET_USD`.
- A spent pass falls back to the anonymous limits; the chat says so kindly, thanks the
  visitor and gives a contact line. A "Demo pass · $0.42 left" line in the chat.
- Sign-ups are bounded: 60 an hour per IP (conference Wi-Fi is one address), a
  honeypot, an email format check, capped field lengths, and one pass per email —
  signing up again returns the same pass.
- Demo traffic stays out of the lab's numbers: a `demo` audience in usage events
  (left out of Insights, the value report and MCP usage counts), and demo tickets
  left out of the open-ticket counts, the kiosk, the tool page's history, the
  assistant's unit history, `list_open_tickets` and the Notion mirror.
- Sign-ups readable only by super admins, on a page and as a CSV; never in a prompt,
  never over MCP, never in `data:push`.

### Non-goals (this iteration)

- **No sandbox.** The owner chose the live lab. A pass reads the real catalogue and
  its reports land in the real queue, flagged.
- **No account.** A pass is not a `user` row, has no role and holds no permission, so
  it cannot submit a project, see the floor map or reach `/admin`. "Like a signed-in
  student" here means the chat and reporting, which is what a demo needs.
- **No generated images.** The app has no image model (retired 2026-09-23).
- **No email sending.** The form collects an address for follow-up; nothing is sent.
- **No automatic deletion** of sign-ups yet (§11, Q1); retention is a documented
  manual step (§8).
- **No Vercel BotID.** The repository does not have it, and installing packages is out
  of scope for this change.

## 3. Architecture

- **Capability:** none new. Nothing here is an agent ability; the sign-up is a form,
  not a tool, and is never offered to a model (`lib/actions/exempt.ts` names the
  route). `report_issue` gains one input it reads from the identity (§5.4).
- **Surfaces:** the chat route reads the pass. MCP never does — `resolveMcpCaller` has
  no cookie path, so an MCP caller cannot hold a pass.
- **Where the pass lives in a request.** `resolveIdentity` is unchanged: a pass holder
  is `anonymous`. The chat route calls `resolveDemoPass(req)` for an anonymous caller,
  and puts what it found on the identity it hands down:

  ```ts
  // Identity (lib/auth/identity.ts), new optional field
  demoPass?: { id: string; exhausted: boolean } | null;
  ```

  With an unspent pass the identity's `rateLimitKey` becomes `demo:<passId>`, so the
  limiter counts the pass, not the shared IP, and `checkRateLimit("chat")` applies
  `DEMO_PASS_CHAT_TIER`. A spent pass keeps the IP key and the anonymous tier.
- **Modules** (`src/lib/demo-pass/`): `config` (env), `signup` (validation),
  `token` (sign and verify the cookie value), `cookie` (read and set), `resolve`
  (cookie → pass state), `turn-cost` (what a turn cost). The data access is
  `src/lib/data/demo-signups.ts`. A turn's side costs (the manual search) are logged
  on its `TurnState` by `src/lib/chat/turn-spend.ts`, like `turn-log.ts`.
- **Data:** migration `0032_demo_pass` (written as `0028`, renumbered when stacked) — the `demo_signups` table,
  `maintenance_logs.demo`, and `demo` in `usage_events_audience_check`. The Notion
  mirror does not carry sign-ups and skips demo tickets.

## 4. Data model

```ts
// src/lib/db/schema/demo-signups.ts
demo_signups (
  id               uuid primary key,
  name             text not null,           -- ≤ 100
  email            text not null unique,    -- lower-cased, ≤ 254
  institution      text not null,           -- ≤ 150
  role             text,                    -- DEMO_SIGNUP_ROLES or null
  runs_makerspace  boolean,                 -- null = not answered
  use_case         text,                    -- ≤ 500
  consent_to_contact boolean not null default false,
  pass_expires_at  timestamptz not null,    -- created_at + 14 days
  spent_usd        numeric(12,6) not null default 0,   -- the ledger
  charged_turns    integer not null default 0,
  last_used_at     timestamptz,
  created_at, updated_at                    -- updated_at by trigger
)
DEMO_SIGNUP_ROLES = ["student", "staff_technician", "faculty", "lab_manager", "other"]

maintenance_logs.demo   boolean not null default false   -- existing rows: false
USAGE_AUDIENCE          ["anonymous", "member", "staff", "demo"]
```

- The budget is **not stored per pass**: it is read from `DEMO_PASS_BUDGET_USD` at
  each turn, so the owner can raise or lower it during the conference without
  touching rows. Remaining = budget − `spent_usd`, never below zero.
- `spent_usd` only grows, by one atomic `update … set spent_usd = spent_usd + $1`.
- No foreign key ties a ticket or a usage event to a sign-up: a demo ticket is
  flagged, not attributed, so no table that names a person points at this one.

## 5. Behavior / flow

### 5.1 Signing up

1. The visitor opens `/demo` from the front page's **Sign up to try the full demo**
   or the About page. With `DEMO_PASS=off` the page says sign-ups are closed and both
   buttons are gone.
2. `POST /api/demo-pass` with the form as JSON. In order: the limiter
   (`demoSignup`, 60 an hour per hashed IP, before anything else); a body cap
   (8 KB); the honeypot (`website` filled → `200 { ok: true, status: "received" }`,
   nothing stored, no cookie); validation (`lib/demo-pass/signup.ts` — required
   fields, email format, lengths, the role vocabulary) → `400 { code: "invalid",
   fields }`. With no `AUTH_SECRET` nothing can be signed: `503 { code:
   "unavailable" }`.
3. `findOrCreateDemoSignup`: insert, or on the email's unique key read the existing
   row and change nothing.
   - **New:** `201 { status: "created", pass }` and the cookie.
   - **Existing and still valid:** `200 { status: "existing", pass }` and a fresh
     cookie for the same row — the same pass and the same ledger on this device.
   - **Existing and expired:** `200 { status: "expired", pass: null }`, no cookie. One
     pass per email (§11, Q2).
4. The page shows the thank-you: the pass's end date and budget, **Ask the
   assistant**, and **Browse the tools**.

### 5.2 The cookie

`makerlab.demo_pass` = `v1.<passId>.<expiresAtSeconds>.<signature>`, the signature an
HMAC-SHA256 of the rest under a key derived from `AUTH_SECRET` (label
`makerlab-demo-pass`, so it signs nothing else). httpOnly, `SameSite=Lax`, `Path=/`,
`Secure` whenever the request is https (every deployment), `Max-Age` the seconds left
until the row's `pass_expires_at`. Not the retired `makerlab.identity` cookie and not
its module: the cookie only *names* a row, and the row decides — expiry is read from
the database on every turn, so a pass can be ended by changing the row.

`resolveDemoPass` returns nothing for a missing, malformed, tampered or expired cookie,
for a row that is gone or past `pass_expires_at`, and whenever `DEMO_PASS=off`. It
reads only the ledger columns, never the name, email or institution.

### 5.3 A chat turn with a pass

1. `resolveIdentity`, then (anonymous only) `resolveDemoPass`.
2. Unspent pass → identity `{ rateLimitKey: "demo:<id>", demoPass: { id, exhausted:
   false } }`; spent → `{ demoPass: { id, exhausted: true } }` with the IP key. Signed
   in → the pass is ignored.
3. The limiter: 60 an hour per unspent pass; the anonymous tier for a spent one.
   Refused with a spent pass → `429 { code: "rate_limited_demo_pass" }`, which the chat
   draws as the thank-you and contact line (no Cornell sign-in offered).
4. The stream's first part is `data-demo-pass` `{ remainingUsd, budgetUsd, exhausted,
   contactEmail }` (transient), which the chat shows as the indicator and, when
   exhausted, as the notice.
5. `onFinish` (awaited by the SDK before the stream closes): for an unspent pass,
   `turnCostUsd(steps, sideCosts)` is charged with `chargeDemoPass(id, usd)`. Never
   throws; a failed write is one log line. A spent pass is not charged: its turns run
   as an anonymous visitor's.
6. After the turn the chat asks `GET /api/demo-pass` for the new balance.

**What a turn costs** (`lib/demo-pass/turn-cost.ts`): each step's Gateway-reported
cost (`providerMetadata.gateway.cost`); for a step that reports none, an estimate from
its tokens at a deliberately high rate ($3 per million input, $15 per million output),
so an unreported cost never makes the pass cheaper; plus each Exa search's reported
`costDollars.total` ($0.007 when it reports none, the measured price); plus the
manual search's embedding and reranking cost, logged on the turn.

**Overshoot.** The check is before the turn and the charge after it, so the last turn
can take a pass past its budget by one turn's cost, and parallel tabs by a few. Turns
are bounded (history budget, 10 steps, tool caps) and the Gateway's spend limit is the
ceiling above all of it.

### 5.4 Reporting a problem with a pass

`report_issue` reads `ctx.identity.demoPass`. A pass's ticket is written with
`demo = true`, no reporter email or user id (a pass has neither — the sign-up's
details are never copied onto the ticket), and the name only if the visitor typed one
in the conversation, as for any anonymous report. The tool result tells the model the
ticket is a demo ticket and staff are not alerted, so it can say so. The anonymous
ticket limit (5 an hour) is keyed on the pass, not the shared IP.

Demo tickets are left out of `countOpenTickets` (the kiosk and the `/admin` tile and
its sparkline), the inventory's open-ticket flags, the tool page's maintenance history,
`get_unit_details` / `get_maintenance_history`, `list_open_tickets`, the value
report's ticket figures and the Notion mirror. Nothing notifies staff of any ticket
today (the notifications spec is a draft); when it lands it skips `demo` rows.
On `/admin/maintenance` they carry a **Demo** badge, a **Filed by** facet (The lab /
Demo pass) and their own count in the facts line; the open, in-progress and urgent
figures there are the lab's.

### 5.5 Usage Insight

A pass's turns (spent or not) record `audience = 'demo'`. `usageSource` leaves `demo`
out always — Insights, the value report and `get_usage_summary` count the lab only —
and the Insights facts line says so. A demo turn's unanswered question is counted but
not added to the Unanswered queue.

### 5.6 Super admins

`/admin/users/demo-signups` (`users.manage`, super admins only, under People): every
sign-up, newest first — when, name, email, institution, role, makerspace, use, consent,
pass state, spent of budget, turns. **Download CSV** →
`GET /api/admin/demo-signups/export` (`users.manage`; 401/403; 10 a minute;
`no-store`; formula-safe CSV via `lib/export/csv.ts`), recorded as
`demo_signups.exported` in the audit trail. People's header links to the page with the
count.

## 6. UI

- **Front page:** a slim callout above the gallery — one sentence and **Sign up to try
  the full demo** (`DemoSignupCallout`). Server-rendered, no JavaScript; gone with
  `DEMO_PASS=off`.
- **About:** a "Try the full demo" section with the same button.
- **`/demo`:** `PublicPage` narrow; labelled fields with hints, required marked in
  words, errors per field announced (`aria-invalid`, `aria-describedby`), a summary
  error in a `role="alert"` region, a native `<select>` for role, two radio buttons
  for the makerspace question, an unticked checkbox for consent, the honeypot off
  screen (`aria-hidden`, `tabindex=-1`, `autocomplete=off`). States: idle, submitting,
  field errors, rate-limited, unavailable, thank-you (new / returning / expired).
  One column on a phone.
- **Chat:** under the sheet's title, `Demo pass · $0.42 left` (or `Demo pass · used
  up`). When spent: a notice — thanks, "you can keep asking at the visitor limit",
  and the contact line (`DEMO_PASS_CONTACT_EMAIL` as a mailto, else the About page's
  contacts).
- **Admin:** the sign-ups table (phone: one row per sign-up), the CSV button, the
  People header link, and the maintenance queue's Demo badge and filter.
- **Strings:** the public ones (`demoPass.*`, the callout, the About section, the
  chat's indicator and notice) in all 12 locales; admin strings in English, the other
  locales falling back (Article 6).

## 7. Relationship to existing work

- Builds on the sign-in and rate-limit spec (2026-07-29): the anonymous tier and its
  ISAM question (`RATE_LIMIT_ANON_CHAT`) are unchanged; the pass is a second way past
  the shared-IP problem.
- Usage Insight (2026-09-27): adds the `demo` audience.
- Branches on top of `v5/tool-scoped-citations` add a calmer home page and a quick
  report form. The home-page change here is one component and one line in
  `app/page.tsx`; on the calm home it is the component's `inline` look, one small line
  between the smart search and the categories (`HomeShell`'s `demoCallout`), and the
  boxed look sits above the full list on `/tools`. **The quick report form passes
  `demo` when it files a ticket for a pass holder**: it resolves the pass the way the
  chat does (`resolveDemoPass`) and hands `demo: true` to `createMaintenanceLog`.

## 8. Security and safety

- **Authorization.** A pass is `anonymous` to `can()`: it holds no permission, so no
  catalogue, intake, queue, people or admin action is reachable, in the GUI, the chat
  or MCP. The admin page and the CSV check `users.manage` themselves.
- **Rate limiting.** `demoSignup` 60/hour per hashed IP (or user); `demoPassStatus`
  120/minute; chat 60/hour per pass; the export 10/minute; all before any read.
- **Forgery.** The cookie is HMAC-signed and verified in constant time before any
  database read; the row is the authority on expiry. No `AUTH_SECRET`, no passes.
- **Same email, same pass.** Anyone who types a visitor's address gets that visitor's
  pass on their device (owner's choice). At stake is at most the pass's remaining
  budget; nothing about the visitor is shown back.
- **Untrusted input.** Every field is length-capped and trimmed; the role is a
  vocabulary; the body is capped at 8 KB. Sign-up text is shown only to super admins,
  as React text (escaped), and in the CSV with formulas defused.
- **PII.** Stored: name, email, institution, optional role, makerspace answer and
  use, consent. Never in a model prompt — the chat reads only the ledger columns, and
  a pass's identity carries no name or email. Never over MCP — no capability reads the
  table (a test enforces it). Never in logs (log lines name the pass id at most).
  Never in the Notion mirror or `data:push` (`DEPLOYMENT_BOUND`: a push must neither
  copy local test sign-ups up nor wipe the hosted ones).
- **Retention.** Sign-ups are kept for **12 months** from sign-up for follow-up, then
  deleted; anyone may ask to be removed sooner through the contact line. In v1
  deletion is a maintainer's task on request (no automatic prune — §11, Q1). The
  nightly backup includes the table, so a deleted sign-up lives on in older backups
  until their tiered retention ends (up to 3 years), as every other person record
  does. The CSV, once downloaded, is the downloader's to protect and delete.
- **Consent.** Unticked by default; only `consent_to_contact = true` rows may be
  emailed about MakerLAB AI. The CSV carries the column.

## 9. Phased build order

One PR for the demo deadline, built in this order:

1. Migration `0032_demo_pass` (written as `0028`), schema, `data/demo-signups.ts`, vocabulary.
2. Sign-up: `lib/demo-pass/*`, `POST`/`GET /api/demo-pass`, `/demo`, the front-page
   and About buttons.
3. Chat: the pass in the route, the tier, the ledger, the indicator and notice.
4. Demo marking: usage audience, the ticket flag and its exclusions, the queue filter.
5. People → Demo sign-ups and the CSV.

## 10. Testing

- **Unit:** sign-up validation (required, email, lengths, role, honeypot); token
  sign/verify (tampered, wrong secret, expired, malformed); turn cost (reported,
  estimated, Exa, side costs); config parsing (`DEMO_PASS_BUDGET_USD` bad values fall
  back to 0.50).
- **Integration (PGlite):** `POST /api/demo-pass` — created, existing (same id, ledger
  kept), expired, honeypot (nothing stored), invalid (400 with fields), the 61st
  sign-up from one IP refused, no `AUTH_SECRET` → 503; `GET` status; the chat route —
  a pass gets more than 8 messages from a shared IP, each turn is charged, a spent pass
  falls back to the anonymous ceiling and is refused with `rate_limited_demo_pass`, an
  expired pass is anonymous, and **no sign-up field reaches the model prompt**;
  `report_issue` with a pass writes `demo = true` and no email; demo tickets are left
  out of counts, histories and the mirror source; demo usage is left out of Insights;
  the export route (401, 403, CSV for a super admin, audited).
- **MCP:** no capability source reads `demo_signups`, and no MCP tool's output for a
  super admin contains a sign-up's email.
- **Component:** the form's errors and thank-you states; the chat's indicator and
  spent notice; `parseCeiling`.
- **Embarrassing in production:** a pass that never runs out; a visitor's email in a
  prompt or over MCP; a demo ticket on the kiosk; local test sign-ups pushed to the
  hosted database; the front-page button still showing after `DEMO_PASS=off`.

**As built:** `lib/demo-pass/{signup,token,turn-cost,config,state}.test.ts`,
`lib/data/demo-signups.test.ts`, `lib/db/schema/demo-pass-migration.test.ts`,
`app/api/demo-pass/route.test.ts`, `app/api/chat/demo-pass.route.test.ts` (real
limiter; the model reports a Gateway cost per step, so the ledger is checked to the
cent), `app/api/mcp/demo-pass-privacy.route.test.ts`,
`app/api/admin/demo-signups/export/route.test.ts`, `lib/export/demo-signups-csv.test.ts`,
`components/demo/{DemoSignupForm,DemoSignupCallout}.test.tsx`,
`components/admin/DemoSignupsTable.test.tsx`, and additions to the maintenance, mirror
source, usage, backup policy, `data:push` plan, About, `MaintenanceQueue` and
`ChatFab` suites. No E2E scenario yet; the PR's screenshots were taken against
`next dev` in demo mode.

## 11. Open questions

1. **Automatic deletion.** Should the nightly cron delete sign-ups 12 months after
   sign-up (one statement, beside the usage prune)? Recommended. *Owner, after the
   demo.*
2. **Renewal.** An expired pass is not renewed by signing up again. Should a super
   admin be able to extend one, or should a new sign-up after expiry get a fresh
   budget? *Owner, after the demo.*
3. **Contact address.** `DEMO_PASS_CONTACT_EMAIL` is unset by default, so the contact
   line points to the About page's lab contacts. Which address should visitors see?
   *Owner, before Sunday.*
4. **The kill switch.** `DEMO_PASS=off` after the conference, or keep the pass as a
   standing way for visitors to try the assistant? *Owner.*
5. **Updating a sign-up.** Should signing up again update a visitor's details (for
   example, to withdraw consent)? Today the first sign-up stands and a withdrawal goes
   through the contact line. *Owner.*
6. **The quick report form** — done when stacked: `POST /api/report` resolves the pass
   beside the session (`resolveDemoPass`, `identityWithDemoPass`) and files a pass
   holder's report with `demo: true`, as `report_issue` does
   (`app/api/report/route.test.ts`). A demo ticket queues no `ticket.filed` email.
7. **Migration number.** Renumbered to `0032` when stacked after the manual eval
   questions (`0028`), on shift (`0029`), email notifications (`0030`) and chat
   illustrations (`0031`).
