# Operational Hardening — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
**Target:** `v5/`
**Branch:** `v5/ops-hardening`

## 1. Summary

Everything in this spec exists for one reason: **someone other than the author has to run
this, and right now the system cannot tell them when it is broken.**

Three specific failures are currently silent. The catalogue can fall back to built-in demo
data and serve fictional equipment while looking perfectly healthy. The site can be down
and nobody knows until a student mentions it. And there is no backup of the Notion data at
all — one deleted database and ~100 machines of accumulated staff work is gone.

This adds a **health endpoint** that detects the fallback, an **uptime check** watching it,
a **daily backup** of every Notion database, and — separately but related — a **caching
change** that cuts Notion API traffic by roughly 99% and makes the app more resilient as a
side effect.

**Nothing here adds infrastructure to operate.** No database, no container, no service to
patch. Everything runs on the Vercel deployment that already exists, which is the whole
point: the more moving parts the handover has, the less likely it survives.

## 2. Goals / Non-goals

### Goals

- The mock-catalogue fallback becomes an alert instead of a mystery.
- Someone gets notified when the site goes down, without watching a dashboard.
- Notion data is recoverable if a database is deleted or the integration is revoked.
- Notion is read on the order of once a day rather than once a minute.
- Repeated model context is cached rather than re-sent every turn.
- Staff can force a refresh without a developer or a terminal.
- Zero new services to operate.

### Non-goals (this iteration)

- **No self-hosting story.** v5 targets Vercel deliberately; portability is Blueprint's
  concern. Adding a Docker path here would trade the thing that makes v5 maintainable —
  nobody administers a server — for a property v5 does not need.
- **No metrics or analytics.** Notion cannot aggregate, so usage analytics are not
  buildable here at any reasonable cost. This is a known limitation, not an oversight.
- **No paging / on-call.** An email is the right escalation for a lab tool.
- **No automated restore.** The backup produces files a human can read and re-import.
  Automated restore into Notion is substantially more work than the failure justifies.

## 3. Architecture

Four independent pieces. Any can ship alone.

```
src/app/api/health/route.ts     # NEW — is the data real?
src/app/api/admin/backup/route.ts  # NEW — daily Notion export (cron)
src/lib/cache.ts                # NEW — cacheLife profile, one place
src/lib/catalog.ts              # CHANGED — use the profile; report source
vercel.json                     # CHANGED — cron schedule
```

### 3.1 Health endpoint

`GET /api/health` — public, unauthenticated, so any uptime service can watch it.

```json
{
  "status": "ok",
  "notion": "ok",
  "catalog": "live",
  "toolCount": 103,
  "checkedAt": "2026-07-29T14:02:11Z"
}
```

| Field | Values |
|---|---|
| `status` | `ok` \| `degraded` |
| `notion` | `ok` \| `unreachable` \| `unconfigured` |
| `catalog` | `live` \| `mock` |

**HTTP 200 when `ok`, HTTP 503 when `degraded`.** This matters more than the body: uptime
monitors alert on status codes, so returning 200 with `"status": "degraded"` would be
invisible — exactly the failure mode being fixed.

Implementation: check every required `NOTION_*` variable is present, then make one
**uncached, minimal** Notion query (page size 1) against the Tools database. Env missing →
`unconfigured`. Query throws → `unreachable`. Either → 503.

Cached for **30 seconds** and rate-limited, so a monitor polling every minute costs roughly
one Notion call per 30s, and the endpoint cannot be used to hammer Notion.

**Deliberately does not verify Claude.** A model outage does not make the catalogue wrong,
and folding it in would make the alert fire for something students can route around.

### 3.2 Caching — the change you actually notice

Today `catalog.ts` calls `cacheLife("minutes")`, Next's built-in profile, which revalidates
about **once a minute**. For a catalogue edited a few times a week, that is roughly 1,400
unnecessary Notion round-trips a day.

Replace it with one named profile:

```ts
// src/lib/cache.ts — the only place cache timing is decided
export const CATALOG_CACHE = {
  stale: 60 * 60,        //  1 h  — browser may serve stale
  revalidate: 60 * 60 * 24,  // 24 h — background refresh
  expire: 60 * 60 * 24 * 7,  //  7 d — hard ceiling
} as const;
```

Freshness comes from **invalidation, not polling** — three paths, in increasing
convenience:

1. **Staff button.** Once sign-in ships, a "Refresh catalogue" control visible to `staff`
   calls the existing revalidate endpoint. Today that endpoint needs a custom header and an
   HTTP client, which in practice means it never gets used. A button is the difference
   between a feature existing and a feature being used.
2. **Notion automation → webhook.** A Notion database automation POSTs to the revalidate
   endpoint whenever a row changes, so the site refreshes itself the moment staff edit.
   **Verify this is available on the workspace's Notion plan before relying on it** —
   automations are plan-gated. This is the ideal path; treat it as a bonus, not the
   mechanism.
3. **The 24-hour background refresh**, as the floor.

**Two consequences worth stating plainly.** Longer caching means a Notion outage is
*less* visible, because stale data keeps serving — which is why §3.1 probes Notion
directly rather than inferring health from the catalogue. And it makes the mock-fallback
failure *less likely*, since far fewer live fetches means far fewer chances to throw.

### 3.3 Backup

`GET /api/admin/backup`, triggered by Vercel Cron daily, secret-protected exactly like the
revalidate endpoint.

Reads all seven Notion databases and writes one timestamped JSON file to **Vercel Blob
(private)**: `backups/2026-07-29.json`. Retains 30 days; older files are pruned by the same
job.

Vercel Blob because it adds no new account — the goal is fewest moving parts. A private
GitHub repository is the documented alternative and has one real advantage: commits give
you a diff of what changed in the catalogue over time, which is occasionally useful for
answering "when did this get wrong?"

**Contains student names and emails** from Maintenance_Logs. Private storage only, and it
belongs in whatever data inventory the university keeps.

### 3.4 Model-side efficiency — prompt caching and lazy context

Notion is not the only metered service. Every chat turn re-sends the system prompt, the
catalogue index, and — on a tool page — that machine's full manual, which can run to tens of
thousands of tokens. Across a ten-turn conversation the same content is paid for ten times.

**Prompt caching.** Mark the stable prefix — system prompt, capability instructions,
catalogue index, attached documents — with Anthropic's `cache_control`. It is identical
turn to turn within a conversation, so subsequent turns read it from cache at a fraction of
the input cost and lower latency. This is the single largest cost reduction available and
it changes no behaviour.

Order matters: cacheable content must come **first** in the prompt, with the volatile part
(the user's message, recent turns) after it. If the manual is appended after the
conversation history, nothing caches. Composing the prompt in the wrong order is the way
this silently fails to work — worth an explicit assertion in a test.

**Lazy manual attachment.** Today a tool page attaches that machine's PDFs on every turn.
Most turns do not need them — "where is it?" and "do I need training?" are answered from
the catalogue record alone. Attach documents when the conversation is actually about
procedure or troubleshooting, either by letting the model request them through a tool or by
attaching on first need and relying on the cache thereafter.

**Both are Article 4 obligations**, not optimisations to do later: they are the difference
between a bill that scales with conversations and one that scales with turns.

### 3.5 Error visibility

**Start with Vercel's built-in observability — no new account.** Combined with the health
check, that covers the failures that actually happen: a bad deploy, a broken route, an
expired token.

Sentry (`@sentry/nextjs`, free tier) is the documented upgrade if debugging proves painful,
and is deliberately *not* the default. It is one more account, one more key, and one more
thing to explain at handover — and the constraint here is simplicity, not completeness.

## 4. Data model

None. Backups are files; health is computed.

## 5. Behavior / flow

**Healthy:** `/api/health` → 200. Monitor is quiet.

**Misconfigured deploy** (the important one): a `NOTION_DB_*` variable is dropped. Today the
site silently serves demo equipment. After this: `/api/health` returns 503 with
`"notion": "unconfigured"`, the uptime monitor emails within minutes, and the handover guide
names the exact cause.

**Notion outage:** health returns 503 `"unreachable"`; the catalogue keeps serving cached
data. The site stays useful while someone is told something is wrong — which is the correct
behaviour, and only possible because §3.2 caches for a day.

**Staff edit a machine:** they tick `published`, then either click Refresh (post-auth), or
the Notion automation fires, or it appears within 24 hours.

**Backup runs:** daily at a quiet hour; failures surface in Vercel's cron log. A silently
failing backup is worse than none, so the job returns a non-200 on failure rather than
swallowing it.

## 6. UI

- **Refresh catalogue** — a staff-only control. Blocked on the auth spec; ship the rest
  first.
- **Degraded banner** — when the catalogue is running on mock data, an unmistakable banner
  says so. Article 4's "fail toward stale, not toward wrong" requires this, and it is the
  visible half of §3.1.

## 7. Relationship to existing work

- **`/api/admin/revalidate` already exists** and works; §3.2 changes what calls it, not the
  endpoint.
- The **Refresh button** depends on the auth spec (`staff` role).
- Independent of projects, intake, evals, and the Gateway migration. Can ship first, and
  probably should — it makes everything after it debuggable.

## 8. Security and safety

- **`/api/health` is public** and deliberately leaks almost nothing: status, whether Notion
  is reachable, and a tool count that is already public. **No error strings, no env var
  names, no Notion IDs** — a health endpoint that reports `NOTION_DB_TOOLS is missing` tells
  an attacker your configuration.
- **`/api/admin/backup`** uses `ADMIN_REVALIDATE_SECRET` (or its own). Vercel Cron requests
  are verified via `CRON_SECRET`.
- **Backups contain PII** — private blob storage, 30-day retention, never public.
- Health is rate-limited despite being cheap; it touches Notion.

## 9. Phased build order

1. **Health endpoint** + the degraded banner. Highest value, no dependencies.
2. **Uptime monitor** pointed at it, with an email destination that is not one person.
3. **Caching profile** (`src/lib/cache.ts`), `catalog.ts` switched over.
4. **Prompt caching** + lazy manual attachment (§3.4).
5. **Backup route** + cron + retention.
6. **Notion automation → webhook**, if the plan supports it.
7. **Refresh button** — after auth.

Steps 1–2 are the ones worth doing this week; they are small and they convert the worst
silent failure in the system into an email.

## 10. Testing

- **Unit** — health status derivation across all inputs: env complete/incomplete, query
  succeeds/throws. Cache profile constants are asserted so nobody silently returns to
  minute-level polling. Backup serialization shape.
- **Integration** — `/api/health` returns 200/`ok` with Notion mocked healthy; **503/
  `unconfigured`** with env stubbed empty; **503/`unreachable`** when the mock throws.
  Response body contains no env var names or raw error text. `/api/admin/backup` rejects a
  missing or wrong secret.
- **Component** — the degraded banner renders when the catalogue is mock, and does not when
  it is live.
- **E2E** — `/api/health` responds on a running server.

**Cases that would embarrass us**
- Health returning 200 while serving mock data — the exact bug this spec exists to kill.
- Health leaking an env var name or a Notion error verbatim.
- A backup job silently failing for weeks and being discovered when it is needed.
- Cache invalidation not actually invalidating, so staff edits never appear and everyone
  concludes the site is broken.

## 11. Open questions

1. **Which uptime service?** Any free tier works — Better Stack, UptimeRobot, or Vercel's
   own monitoring. **Recommend whichever the person who will receive the emails already
   uses.** The tool matters far less than the address it mails.
2. **Where do alerts go?** Must not be one individual. A shared lab address or a Slack
   channel. *Blocks step 2, and it is a decision, not a task.*
3. **Does the Notion plan support automations with webhooks?** Determines whether §3.2's
   ideal path is available. *Not blocking; the 24-hour refresh is the fallback.*
4. **Is 24 hours the right floor?** It suits a catalogue edited weekly. If the lab starts
   editing daily and the refresh button goes unused, shorten to 6 hours — still 240× less
   traffic than today.

## Amendments

### 2026-07-29 — `/api/admin/revalidate` accepts a staff session (as-built)

**What changed.** §7 said the Refresh button "changes what calls it, not the endpoint."
It changed the endpoint. `POST /api/admin/revalidate` now authorises **either** a
signed-in `staff`/`admin` session (via `resolveIdentity`) **or** the existing
`x-admin-secret` header, and it is rate-limited (30/min, keyed per identity) before it
invalidates anything.

**Why.** A browser cannot hold `ADMIN_REVALIDATE_SECRET`, so a button that authenticated
only by shared secret would have had to either ship the secret to the client or proxy
through a second route that decides the same question twice. Neither is better than
teaching the one endpoint about the one auth mechanism the app already has. The header
path is untouched, because the callers that have no session — a Notion automation
webhook, cron, `curl` during an incident — are exactly the ones §3.2 path 2 depends on.

The rate limit is Article 4: invalidation is cheap here and expensive on the next
request, which re-reads all of Notion.

**Scope.** §3.2 path 1 and §9 phase 7. Server-side authorisation is the control; the
component renders `null` below `staff` purely to spare everyone else a button they
cannot use, and the route re-resolves identity regardless.

**Also as-built:**
- **Admins see it too.** §3.2 says "visible to `staff`". `isAtLeast(role, "staff")` includes
  `admin`, which is the only reading that does not lock the operator out of the operator's
  own control.
- **It lives in the header** (`PrimaryNav`), not on a page: the catalogue is what every page
  shows, and `PrimaryNav` has already resolved the identity, so the control costs no second
  `/api/identity` call.
- **Feedback is a persistent live region**, not a toast — refreshing / refreshed / failed
  stays on screen until the next attempt. Same reasoning as `FlagButton`'s in-place
  confirmation: a toast is gone before it is read.
- **Strings** live in a new `catalogRefresh` namespace across all 12 `messages/*.json`, with
  `{institution}` supplied at the call site from `siteConfig` (Article 6).

**Status.** Accepted — the code is right and §7's prediction about the endpoint was wrong.

### 2026-07-29 — backup route, as built (phase 5)

**What changed.** Three departures from §3.3, all small.

**1. It backs up eight databases, not seven.** §3.3 says "all seven Notion databases".
The route enumerates its targets from `notion.ts`'s `getNotionEnvContract()` and appends
`NOTION_DB_PROJECTS` when that variable is set.

*Why.* Two reasons, and the second is the important one. Student project submissions are
staff-moderated work that is lost exactly the way everything else is, so excluding them
from the only backup would be an odd place to draw a line. More to the point, deriving the
list from the env contract rather than hard-coding it means **the ninth database gets
backed up the day it is added**, instead of being silently missed until someone needs it —
which is precisely the class of failure this spec exists to end. A second hard-coded list
of databases would have been a new thing to keep in sync, and things that must be kept in
sync do not stay in sync.

**2. `vercel.json` is `v5/vercel.json`.** §3's file listing is relative to `v5/`, and the
Vercel project's Root Directory is `v5/` (the repo root holds the retired v4 app). The
schedule is `17 7 * * *` — 07:17 UTC, roughly 03:17 in New York. **If the Vercel project's
Root Directory is ever set to the repo root, the `crons` block has to move to the root
`vercel.json` or the job simply never fires.** Noted here because a cron that was never
registered looks identical to a cron that is working.

**3. A prune failure returns 500 with `written: true`.** §5 says the job returns non-200 on
failure, and it does. But the two failures are not equally bad: if the dump was written and
only the 30-day cleanup threw, today's data is safe and the operator should know that from
the cron log rather than assuming the worst. The status code still says "look at this".

**Also as-built:**
- **Raw Notion pages are stored**, not the records `notion.ts` maps. That mapping is lossy
  on purpose — it keeps the properties the site renders — and a backup exists to restore
  what Notion had rather than what the site showed.
- **A partial dump is never written.** Any database failing aborts the whole job with a 500.
  A file that is missing a database while looking complete is worse than no file, because
  the restore succeeds and is wrong.
- **`src/lib/blob.ts` is a three-verb seam** (`put` / `list` / `del`) over `@vercel/blob`,
  with `access: "private"` hard-coded and no parameter to override it. §3.3 and §8 both say
  private-only; making it un-expressible is stronger than documenting it. The seam is also
  what lets the route be tested without a blob token.
- **Rate-limited at 10/hour** after the secret check (Article 4). The route is secret-gated,
  so this is the second line: a leaked secret in a loop would otherwise be one full Notion
  dump per request.
- **Pagination is bounded** at 100 pages per database and **the prune never deletes a
  pathname it does not recognise** — both are "fail toward stale, not toward wrong".

**Status.** Accepted — §3.3's intent is met; the deviations are narrower than the prose,
except the eighth database, which is broader and deliberately so.

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited.

### 2026-07-30 — phase 1's banner arrived late (drift, now closed)

**What happened.** Phase 1 is "health endpoint **+ the degraded banner**." The health
endpoint shipped; the banner did not, and the master index recorded the phase as built on
the strength of the endpoint alone. It was caught by running the app and looking at it —
the page said "2 TOOLS IN INVENTORY" with nothing indicating those two machines were
invented.

**Resolution.** `src/components/DemoDataBanner.tsx`, mounted in the root layout, with
strings in all 12 locales. **Status: closed.** Phase 1 is now genuinely complete.

**Worth keeping.** Neither the test suite nor `spec:coverage` could have caught this — a
missing banner adds no surface and breaks no test. Only opening the page did. That is the
argument for `/drift` being a *semantic* check and for actually running the app.

### 2026-07-30 — §3.4 lazy manual attachment: superseded by a better approach (as-built)

**What §3.4 asked for.** Attach a machine's manuals "when the conversation is actually
about procedure or troubleshooting," because "a ten-turn conversation pays for the same
manual ten times."

**What the code does instead.** `attachManualsToFirstUserMessage` attaches manuals once, to
the **first** user message, marked `cacheControl: { type: "ephemeral" }` — so they sit in
the cacheable prefix and later turns read them from cache.

**Why this is better and the spec is stale.** It solves the same cost problem with no
conditional logic and no judgement call about whether a turn "is about procedure" — a
judgement that would sometimes be wrong, and wrong in the direction of the assistant not
having the manual when it needed it. The spec's framing was the weaker idea.

**Status.** Accepted. §3.4's prompt-caching half is built as written; the lazy-attachment
half is superseded, not skipped.
