# Usage Insight: What the Lab Asks About, and What It Cannot Answer — Design Spec

**Date:** 2026-09-27
**Status:** Phases 1–2 built, with the Unanswered queue's two decisions (amendment 2026-09-28); phases 3–4 open
**Target:** `v5/`
**Branch:** `docs/feature-specs` · implementation `v5/usage-insight`
**Spec PR:** — · **Implementation PR:** "v5 usage insights" (phases 1–2)

## 1. Summary

The handover lists one gap by name: "**No usage analytics.** There is no report of which
machines get asked about most" (`docs/handover.md` §9). Staff can't see which tools
students look at, which manuals the assistant actually quotes, or when the lab is busiest.
They also can't see the questions the assistant could not answer, and those are the most
useful signal of all.

This spec adds **Usage Insight**, which has three parts:

- **A first-party event table in Postgres.** The chat route, the MCP route and a small
  page-view beacon write to it.
- **A daily rollup.** Raw events are deleted after 30 days, and the counts behind them
  are kept.
- **An admin page, `/admin/insights`.** It shows the most-asked-about tools, per-tool page
  views and QR scans, manual citations, the busiest times, and an **Unanswered** queue.
  Staff turn that queue into curation: add a manual, file a correction, queue a refresh,
  or dismiss.

It is **privacy-preserving by construction**. No event carries a user id, session id,
chat id or IP address. The one piece of student text it keeps is the question behind an
unanswered turn. That text is scrubbed, capped, visible only to admins, deleted after 90
days, and never backed up or mirrored.

Every new write is an action in `src/lib/actions/`, so it also works from the assistant
through a confirmation card (assistant GUI-parity spec, PR #91). There is no architecture
change. This adds one table group, one cron step, one route and one admin surface.

## 2. Goals / Non-goals

### Goals

- **Answer the handover's question.** For any 7-, 30- or 90-day window, an admin sees the
  tools ranked by how often they were asked about, with page views, QR scans and manual
  citations beside each one.
- **Unanswered questions become work.** Each is shown once with its occurrence count,
  however many times it was asked. From the row, one click (or one card) does one of the
  following:
  - opens the tool's resources to add a manual;
  - files a correction (`feedback`);
  - queues a refresh (`refresh.queue`);
  - dismisses it.
- **Busiest times.** A 7 × 24 grid in lab time (`labTimezone()`, default
  `America/New_York`) of chat turns and page views.
- **No per-person data.** Nothing in the design can answer "what did Casey ask". This is a
  property of the schema, not a filter on the page.
- **Recording never costs a student anything.** A failed insert never fails, delays or
  changes a chat turn or a page load.
- **Staff activity is separable.** Every event carries a coarse audience (`anonymous`,
  `member` or `staff`), and staff are excluded by default, so testing doesn't inflate the
  counts.

### Non-goals (this iteration)

- **Per-student history or "who used what".** Usage logging of machine time is a separate
  idea (kiosk mode, the owner's list). This spec counts interest, not use.
- **Storing conversations.** Chat stays unpersisted, as today.
- **Traffic sources, referrers, devices, funnels.** Vercel Web Analytics does this with no
  code if the owner wants it (§13 Q1). None of it drives curation.
- **Emailed or pushed weekly digests.** These wait for the notifications spec, and would
  read the same rollups.
- **Model-graded topic clustering of questions.** Gaps are grouped by normalised text and
  tool, not by an LLM. This keeps cost at zero and keeps student text away from a second
  model call.

## 3. Architecture

### 3.1 First-party events, not Vercel Web Analytics

| | First-party `usage_events` | Vercel Web Analytics / Observability |
|---|---|---|
| Sees tool calls, manual citations, gaps | **Yes.** These are server-side facts inside the chat turn | No. It sees page loads, and custom events are client-side and plan-limited |
| Joins to `tools`, `manual_documents`, `feedback` | Yes, by FK | No. Exported names only |
| Retention and deletion under our control | Yes (§8) | Vendor's |
| Feeds curation actions | Yes | No |
| Cost | Rows in Neon, which we already pay for | Plan-dependent |

**Decision:** first-party for everything this spec needs. Web Analytics may be switched on
separately for traffic (§13 Q1). It is additive and not relied on.

### 3.2 Where things live

```text
src/lib/db/schema/usage.ts         usage_events, usage_rollups, usage_gaps
src/lib/db/migrations/00NN_usage_insight.sql   next free number at implementation
src/lib/usage/
  events.ts        UsageEvent type, KINDS, AUDIENCE from identity.role
  from-turn.ts     pure: a finished turn's steps + final text → UsageEvent[]
  scrub.ts         pure: emails, phone numbers, NetID-shaped tokens, URLs → "[…]"; cap 300 chars
  gap-key.ts       pure: normalise question + tool → grouping key
  record.ts        recordUsage(events): one batched insert, via after(); swallow + console.warn
  rollup.ts        runUsageRollup(): raw → hourly rollups; prune raw > 30 d, gaps > 90 d
  queries.ts       loaders for /admin/insights and the usage_summary tool
src/lib/actions/insights.ts        insights.dismiss_gap, insights.file_correction (parity spec §3.2)
src/lib/capabilities/insights.ts   usage_summary read tool (+ record_gap, §5.2)
src/app/api/usage/route.ts         POST page-view beacon
src/app/admin/insights/page.tsx    the page (§6)
src/components/usage/ToolViewBeacon.tsx   client island on /tools/[id]
```

### 3.3 Surfaces

- **Chat.** `streamText`'s `onFinish` in `src/app/api/chat/route.ts` hands the turn's steps
  to `fromTurn()`. The route already records per-turn state (`turn-sources.ts`,
  `recordSearchResults`), and this follows the same pattern.
- **MCP.** `/api/mcp` records one `mcp_call` per tool call: the tool name, plus the tool id
  when the call resolved one. A client's token id is **not** recorded.
- **Page views.** Tool pages are `"use cache"` + `cacheTag("catalog")`, so the server does
  not run per view. A client island posts `{ toolId, source }` with `navigator.sendBeacon`
  once per tool per tab session, deduplicated in `sessionStorage`. `source` is `qr` when the
  URL carries `?src=qr` (the QR codes spec), and `direct` otherwise.
- **Notion mirror.** Carries none of it (Article 7).

## 4. Data model

One migration, `00NN_usage_insight.sql`. It needs no backfill: the history starts on the
deploy day, and the page says so.

```ts
export const USAGE_KINDS = [
  "tool_view",      // a tool page seen (beacon)
  "chat_turn",      // one assistant turn
  "tool_asked",     // a tool the turn was about: focused tool, get_tool_details, search_manual scope
  "manual_cited",   // a passage search_manual returned AND the final text cited
  "gap",            // the turn could not answer (§5.2)
  "mcp_call",       // one MCP tool call
] as const;
export const USAGE_AUDIENCE = ["anonymous", "member", "staff"] as const; // user → member; admin, super_admin → staff
export const USAGE_SURFACE = ["web", "chat", "mcp"] as const;
export const GAP_KINDS = ["not_in_catalog", "no_manual_passage", "no_search_results", "model_declared"] as const;
export const GAP_STATUS = ["open", "dismissed", "filed"] as const;
```

**`usage_events`** holds raw events and is kept for 30 days.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity | |
| `occurred_at` | `timestamptz not null default now()` | indexed |
| `kind` | `text not null` | CHECK in `USAGE_KINDS` |
| `surface` | `text not null` | CHECK |
| `audience` | `text not null` | CHECK. **The only thing recorded about the person** |
| `tool_id` | `uuid null` → `tools.id` on delete set null | |
| `manual_document_id` | `uuid null` → `manual_documents.id` on delete set null | |
| `page` | `int null` | the cited page |
| `source` | `text null` | `qr` \| `direct` (views), the gap kind (gaps), the tool name (MCP) |
| `locale` | `text null` | from the chat body |
| `gap_id` | `uuid null` → `usage_gaps.id` on delete set null | |

**`usage_rollups`** holds hourly counts. It is kept indefinitely and contains no personal
data.

The key is `(hour_start, kind, surface, audience, tool_id, manual_document_id, source)`, and
`count int not null`. `hour_start` is UTC. The page converts it to lab time, so DST is
handled once, in `queries.ts`. Nullable key columns use `NULLS NOT DISTINCT` on the unique
index, which Postgres 15+ supports on Neon and PGlite.

**`usage_gaps`** is the Unanswered queue. It is kept for 90 days after `last_seen`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `key` | `text unique not null` | `gap-key.ts`: normalised scrubbed question + tool id |
| `kind` | `text not null` | CHECK in `GAP_KINDS` |
| `tool_id` | `uuid null` → `tools.id` set null | |
| `question` | `text not null` | scrubbed, ≤ 300 chars, **the first occurrence's wording** |
| `occurrences` | `int not null default 1` | |
| `first_seen`, `last_seen` | `timestamptz` | |
| `status` | `text not null default 'open'` | CHECK in `GAP_STATUS` |
| `feedback_id` | `uuid null` → `feedback.id` set null | set by `insights.file_correction` |
| `decided_by`, `decided_at` | `helpers.ts` user FK, `timestamptz` | the admin who acted, not the student |

When the same key repeats, `occurrences` increments and `last_seen` moves. A dismissed gap
that recurs 3 more times reopens.

**Backup and mirror.** `backup-policy.ts` holds back `usage_events` and `usage_gaps`. The
nightly export reaches back three years (handover §3), which would silently break the
30- and 90-day promises. `usage_rollups` is backed up.

## 5. Behavior / flow

### 5.1 A chat turn

1. The turn runs exactly as today.
2. `onFinish` runs `fromTurn(steps, text, ctx)`. It is pure and produces:
   - `chat_turn`;
   - `tool_asked` for each distinct tool id: `focusedToolId`, `get_tool_details` found,
     and `search_manual`'s scope tool;
   - `manual_cited` for each passage whose citation appears in the final text, using the
     same matching as `manual-citations.ts` `citedPassages`, moved to a shared pure module;
   - `gap` when §5.2 says so.
3. `recordUsage()` is scheduled with `after()`: one insert for the events, and one upsert
   per gap. If it fails, it writes `console.warn("[usage] …")` and returns. The student's
   stream is already closed.

### 5.2 What counts as "could not answer"

Deterministic signals, from tool results the route already sees:

| Gap kind | Signal |
|---|---|
| `not_in_catalog` | `get_tool_details` → `{ found: false }`, with no other tool resolved in the turn |
| `no_manual_passage` | `search_manual` → `status: "no_results"` and nothing cited |
| `no_search_results` | `search_tools` returned zero results and no tool was resolved |
| `model_declared` | the model called `record_gap` (below) |

**`record_gap`** is a chat-only capability tool with no side effects the student sees. Its
description: "Call once when you could not answer from the catalogue or manuals. Say why in
one of: not_in_catalog, no_manual, unclear. Do not call it for off-topic chat." It covers
the honest-absence answers that never touched a tool (the `waterjet-absent` eval case).

The stored question is the turn's **last user message**. It goes through `scrub.ts`, and
the first occurrence's wording is kept. The model's answer is not stored.

### 5.3 Page view

`ToolViewBeacon` → `POST /api/usage` `{ toolId, source }`. The route checks, in order:

1. The `usage` rate tier: 60/min, keyed on `identity.rateLimitKey`, which is used and then
   discarded.
2. It returns `204` and records nothing if any of these hold:
   - `Sec-GPC: 1` or `DNT: 1`;
   - a bot user agent;
   - `USAGE_INSIGHT=off`.
3. `toolId` must be a published tool's uuid.
4. It inserts one `tool_view`.

The route always answers `204`, so it tells a client nothing.

### 5.4 Daily cron

`/api/cron/daily` gains a step after cleanup, `runUsageRollup()`:

- it upserts hourly counts for every complete hour not yet rolled up, which makes it
  idempotent;
- it deletes `usage_events` older than 30 days;
- it deletes `usage_gaps` whose `last_seen` is older than 90 days.

The work is bounded: batches of 10k rows, capped by the route's `maxDuration`, and the
next run resumes. A failure is reported in the heartbeat, as the other steps are.

### 5.5 Unhappy paths

| Case | Behaviour |
|---|---|
| Postgres slow or down during a turn | The turn is unaffected. Events are lost and a warning is logged. Counts are approximate by design, and the page says so |
| A tool is deleted | FKs set null. Rollups keep counting under "Deleted tool" |
| The beacon is blocked by an extension | Views are undercounted. Acceptable; not worked around |
| The model over-calls `record_gap` | The gap-precision eval (§10.1) catches it before merge. Staff can dismiss |
| A question contains a name the scrubber misses | Admin-only, 90 days, excluded from backup. §13 Q2 decides whether to keep text at all |

## 6. UI

**Admin placement.** Add a new entry to `ADMIN_SURFACES` (`src/lib/admin/surfaces.ts`):

```ts
{ key: "insights", href: "/admin/insights", group: "keepFresh", permission: "insights.view", icon: ChartColumn, count: "insights" }
```

It sits in **Keep fresh**, beside Inventory, Refresh and Research, because its job is
curation. The tile's count is the number of open gaps. Because the list is shared, the
home tiles, the section bar and ⌘K all pick it up.

**`/admin/insights`** is a server component with client islands only for the controls. It
has these parts:

- **Header controls:** a period selector (7 / 30 / 90 days) and an "Include staff" toggle,
  off by default.
- **Summary tiles:** chat turns, tool page views, QR scans, answered-rate (1 − gap turns /
  chat turns), and MCP calls.
- **Most asked about:** a table of tool, asked, views, QR, citations and gaps, sortable,
  with each tool linking to its page. It has a **Never asked about** tab listing published
  tools with zero `tool_asked` and zero `tool_view` in the period.
- **Unanswered:** the gap queue. Each row shows the question (fenced display, no HTML),
  the tool, a kind badge, occurrences and last seen. The row actions are:
  - **Add a manual** links to the tool's editor resources section;
  - **File a correction** runs `insights.file_correction`;
  - **Queue refresh** runs the existing `refresh.queue`;
  - **Dismiss** runs `insights.dismiss_gap`.

  Multi-select and bulk dismiss publish their selection to `PageSelectionProvider` (parity
  spec §3.6).
- **Manuals cited:** manual, tool, citations, and the top 3 pages.
- **Busiest times:** a 7 × 24 heatmap in lab time. It has a table fallback for screen
  readers, and its colours come from CSS variables.

**States.** Before any data exists, the page shows "Counting since <deploy date>". Loading
uses the admin `loading.tsx` pattern, and a query error shows the admin error row. On
mobile the tables become stacked cards and the heatmap scrolls inside its own box, never
the page.

**Tool editor panel.** One line: "Asked about 14 times · 52 views · 9 QR scans in the last
30 days". It is shown to `insights.view` holders only.

**Strings.** All new strings go under `admin.insights.*`, in English, and the other 11
locales fall back until the translation pass (Article 6).

## 7. Relationship to existing work

- **Assistant GUI-parity (PR #91).** `insights.dismiss_gap` and `insights.file_correction`
  are `ActionDefinition`s. Their risk is `operational`, `assistant: "propose"` and
  `mcp: "never"`: gap text is student-written and should not leave the app through a token.
  Queue refresh reuses `refresh.queue`, adding no new write. Phase 3 depends on parity
  phase 1. Phases 1–2 do not.
- **Report a correction** (2026-07-29). `file_correction` writes a normal `feedback` row
  with `tool_id`, `issue_description` = the scrubbed question, `reporter_*` null, and status
  `new`, so it lands on `/admin/corrections` unchanged.
- **Honest absence.** The eval cases in `evals/cases/honest-absence.yaml` are the positive
  set for `record_gap`.
- **QR codes** (2026-07-29) deferred "an analytics dashboard". This is it, and `?src=qr` is
  already preserved through redirects on `/tools/[id]`.
- **Operational hardening** (2026-07-29) listed "no metrics or analytics" as a gap. This
  closes the usage half. Error metrics stay with operations.
- **Other ideas the owner raised** (not decided): kiosk-mode usage logging, recurring
  maintenance and notifications. A digest would reuse `queries.ts`. Usage logging would be
  its own table keyed to units, not this one.

## 8. Security and safety

- **Authorization.** A new permission, `insights: ["view"]`, is added to `statement` and
  granted to `admin` and `super_admin` (§13 Q3). The page, the surface, the editor line and
  `usage_summary` all check it with `can()`. The two actions check `insights.view` through
  `performAction()`.
- **Rate limiting.** `ROUTE_TIERS.usage = { limit: 60, windowMs: 60_000 }` on the beacon,
  checked before any query. Recording from chat and MCP happens inside routes that are
  already limited. `usage_summary` shares the chat tier.
- **External calls.** None. There is no new vendor and no model call except `record_gap`'s
  schema, which is about 100 tokens in the cached system block.
- **Write safety.** Recording is not user-facing content. The two curation writes are
  actions confirmed by a person (parity spec §3.5). `file_correction` creates a `new`
  correction, which is a draft by definition (Article 5).
- **Untrusted input.** The gap question is student text:
  - it is scrubbed and capped;
  - it is rendered as text, never HTML;
  - it is fenced with `fenceUntrusted` in `usage_summary`, and reading it **taints the
    turn** (parity spec §8.4), so a question saying "remove Casey" can't produce a people
    card.
- **PII**, stated plainly:
  - **Stored:** a coarse audience bucket; the scrubbed text of unanswered questions, kept
    90 days; and counts.
  - **Never stored:** user id, email, name, IP (not even hashed), session, chat id, token
    id, user agent, or the assistant's answers.
  - **No join path to a person exists.**
  - Staff decisions on gaps record the staff member (`decided_by`), as other admin queues
    do.
  - The handover open item "confirm with the university that student names and emails…
    are acceptable" gains this table. The public About page gets one sentence: "We count
    which tools and manuals are asked about, never who asked" (§13 Q6).

## 9. Phased build order

Phases 1 and 2 need nothing from the parity spec. Phase 3 needs parity phase 1, and phase 4
needs parity phase 2.

| # | Phase | Delivers | Acceptance |
|---|---|---|---|
| **1** | **Record** | Schema + migration; `events`, `from-turn`, `scrub`, `gap-key`, `record`; chat `onFinish` wiring (deterministic gap kinds only); MCP `mcp_call`; `/api/usage` + `ToolViewBeacon`; `runUsageRollup` in the daily cron; `backup-policy.ts` exclusions; `USAGE_INSIGHT` env | A seeded chat turn about the Form 4 that cites page 12 writes `chat_turn`, `tool_asked` and `manual_cited` (page 12). A thrown insert leaves the chat response byte-identical. `Sec-GPC` records nothing. After the cron, raw rows older than 30 days are gone and the rollups hold the counts. The backup file has no `usage_events` or `usage_gaps` |
| **2** | **See** | `insights.view` permission; the `insights` surface + count loader; `/admin/insights` read-only (tiles, Most asked about, Never asked about, Manuals cited, Busiest times); the editor line; strings | An admin sees the demo seed's synthetic week. A student and anonymous get 404/redirect as other admin pages do. The staff toggle changes the counts. The heatmap puts a 21:30 ET event in the 21:00 cell across the DST boundary |
| **3** | **Act on gaps** | `usage_gaps` UI; `insights.dismiss_gap`, `insights.file_correction` in `src/lib/actions/`; Queue refresh via `refresh.queue`; bulk dismiss; `record_gap` capability + prompt line | Filing a gap creates a `feedback` row visible on `/admin/corrections` and marks the gap `filed`. A dismissed gap that recurs 3× reopens. The parity guard test sees both new actions registered |
| **4** | **Ask** | `usage_summary` read tool (`insights.view`, fenced gap text, taints the turn); admin starter chips ("Top unanswered this month", "Tools nobody asked about"); MCP: aggregates only, no gap text | "What did students ask about most this month?" answers from `usage_summary` with numbers matching the page. "Dismiss the waterjet ones" proposes one `dismiss_gap` batch card. An MCP token's `usage_summary` returns no `question` fields |

## 10. Testing

Per `TESTING.md`. There are no network calls, and `streamText` is stubbed (Article 3).

- **Unit**
  - `fromTurn`: each gap kind; no gap when a tool resolved; a deduplicated `tool_asked`;
    `manual_cited` only for passages actually cited.
  - `scrub`: emails, `+1 (607) …` numbers, NetIDs (`abc123`), URLs with query strings,
    300-char cap, Unicode.
  - `gap-key`: case, whitespace and punctuation fold together; different tools stay
    separate.
  - `rollup`: idempotent re-run; partial hour skipped; DST fall-back hour counted once in
    lab time.
  - Audience mapping per role.
- **Integration (PGlite, real routes)**
  - `/api/chat` with a stubbed stream writes the expected rows, and an injected DB failure
    still streams normally.
  - `/api/usage`:
    - the tier, with the 61st request → 429;
    - GPC, DNT, bot UA;
    - unpublished tool → ignored.
  - `/api/mcp` records the tool name and no token id.
  - Cron prune boundaries: 29 and 31 days; 89 and 91 days.
  - Each action run two ways (server action; propose + confirm), with equal rows.
  - Backup excludes the two tables.
- **Component:** the Insights page in its empty, loaded and error states; the heatmap's
  table fallback; row actions disabled while pending.
- **E2E:** view a tool page, ask the chat an unanswerable question, sign in as the seed
  admin → the view and the gap appear → File a correction → it is on `/admin/corrections`.

**Cases that would embarrass us in production:**

- a student's email or phone number shown on Insights;
- any column that lets someone reconstruct one person's questions;
- analytics breaking or slowing the chat;
- staff testing dominating "most asked about";
- a three-year-old backup still holding "deleted after 90 days" question text.

### 10.1 Evals (`evals/cases/usage-gaps.yaml`)

The harness gains a `called_tool` / `not_called_tool` assertion if one is missing.

| Case | Expect |
|---|---|
| The three `honest-absence.yaml` prompts | `record_gap` called once |
| `answerable-trotec-power` ("What power is the Trotec?") | `record_gap` **not** called |
| `answerable-with-manual` (a question the seeded manual answers) | not called; a passage cited |
| `off-topic-hello` ("hi!") | not called |
| `admin-top-unanswered` (as admin) | `usage_summary` called; no claim of a count it did not return |

The target is ≥ 90% recall on the absence set and ≤ 5% false positives on the answerable
set, recorded in the phase 3 amendment.

## 11. Cost

- **Model:** about 100 cached prompt tokens per turn for `record_gap`, plus a tool call on
  gap turns only. `usage_summary` is an ordinary read.
- **Postgres:** one batched insert per chat turn and one per tool view. At the lab's
  scale, raw rows stay in the low hundreds of thousands under the 30-day window, and
  rollups grow by a few thousand rows a month. This is well inside the current Neon plan.
- **Vercel:** one extra function invocation per unique tool view per tab. The cron adds
  seconds.

## 12. Risks

- **Undercounting** (blockers, GPC, failed inserts). This is acceptable because the page
  is for curation priorities, not billing. It is labelled "approximate".
- **`record_gap` changes answer behaviour.** A new tool can nudge the model toward
  refusing. The honest-absence and grounding evals must stay green, and the tool is
  removable without a schema change.
- **Scrubber misses PII.** Mitigated by admin-only access, 90 days, no backup, and Q2's
  option to store no text.
- **Cache-hit tool pages hide views from the server.** This is the reason for the beacon,
  and it is covered by an E2E.

## 13. Open questions

| # | Question | Recommendation | Who |
|---|---|---|---|
| 1 | **First-party vs Vercel Web Analytics.** | First-party for everything here (§3.1). Optionally switch on Vercel Web Analytics for referrers and devices, and nothing depends on it | Isaac |
| 2 | **Keep the text of unanswered questions at all?** | Yes: scrubbed, 300 chars, admin-only, 90 days, never backed up. Without text, the queue is just counts per tool and loses most of its curation value | Isaac, with the university (handover §10) |
| 3 | **Who sees Insights.** A new `insights.view` for admins (SuperMakers) and directors, or directors only? | Both roles. SuperMakers do the curation | Isaac |
| 4 | **Retention figures.** Raw 30 days, gaps 90 days, hourly rollups indefinitely? | As stated. Rollups carry no personal data | Isaac |
| 5 | **The model-declared signal.** Add `record_gap`, or rely on deterministic signals only? | Add it, gated on the §10.1 thresholds. Without it the waterjet-style absences are invisible | Isaac |
| 6 | **Tell students.** One line on About and in the chat's footer note? | Yes, on About. The chat footer is already crowded | Isaac + Luis |
| 7 | **Exclude staff by default?** | Yes, with a toggle | Luis + Niti (they use the page) |

None of these blocks phase 1 except Q2, which decides whether `usage_gaps.question` exists,
and Q4, which sets the prune constants. Q3 blocks phase 2, and Q5 blocks phase 3's
`record_gap`.

## Amendments

### 2026-09-28 — phases 1 and 2 as built, with the owner's defaults

The owner approved building usage insight ("anonymous data on what tools people ask about and what
kinds of questions, on the admin page") and set these defaults, which answer §13 as follows:

| § 13 | Answer |
|---|---|
| Q1 | First-party only. Nothing depends on Vercel Web Analytics. |
| Q2 | Keep the text of unanswered questions, **30 days** (not 90), then only counts. |
| Q3 | `insights.view` for `admin` and `super_admin`. |
| Q4 | Raw events 30 days, then hourly rollups kept indefinitely; gap text 30 days after last asked. |
| Q5 | Not yet: `record_gap` waits for phase 3 and its evals. A phrase heuristic stands in (below). |
| Q6 | Yes, one sentence on About ("How it works"). |
| Q7 | Staff excluded by default, with a toggle. |

**Built** (branch `v5/usage-insight`; migration `0022_usage_insight`):

- **Schema** (`src/lib/db/schema/usage.ts`): `usage_events`, `usage_rollups`, `usage_gaps` as §4,
  with these changes:
  - `USAGE_KINDS` adds **`kiosk_view`** (`source` `screen` for the status screen loading, `qr` for
    an arrival from its QR code). The owner asked for kiosk views.
  - `usage_events.question_kind` (and the same column in the rollup key): **`operate` / `debug` /
    `create` / `other`**, set on `chat_turn` by a keyword heuristic
    (`lib/usage/question-kind.ts`). No model call. The owner asked for "what kinds of questions";
    the heuristic is free and keeps student text away from a second model.
  - `usage_rollups` key adds `page` (for "top 3 pages") and `question_kind`. Its `tool_id` and
    `manual_document_id` are **not** foreign keys: `on delete set null` would fold a deleted tool's
    rows into the null key and collide on the `NULLS NOT DISTINCT` index.
  - `GAP_KINDS` replaces `model_declared` with **`honest_absence`**: the answer itself says the
    catalogue or manual does not cover it (`lib/usage/absence.ts`, a narrow English phrase list,
    only when nothing was cited). `record_gap` (phase 3) is the precise version.
  - `usage_gaps.question` keeps the **latest** occurrence's wording, not the first, and the row is
    deleted 30 days after `last_seen`, so no stored question text is ever older than 30 days.
    `dismissed_at_occurrences` records when it was dismissed; three more askings reopen it.
- **Recording**: `lib/usage/` — `events.ts` (audience from role), `from-turn.ts`, `scrub.ts`
  (emails, URLs, phone numbers, NetID-shaped tokens of 2–3 letters and **2–5** digits, so `CO2`
  and `MK4` survive; 300 characters by code point), `gap-key.ts`, `record.ts` (never throws;
  `USAGE_INSIGHT=off` records nothing), `schedule.ts` (`after()`), `turn-log.ts` (the passages
  `search_manual` returned, keyed on the turn's `TurnState`, which carries the document id and page a
  link does not), `chat-turn.ts` (the route's `onFinish`), `mcp-call.ts` (the MCP adapter's new
  `afterCall` hook), `beacon.ts`, `rollup.ts`, `queries.ts`, `demo-usage.ts`.
- **Beacon**: `POST /api/usage` and `components/usage/UsageBeacon.tsx`, on `/tools/[id]` and, for
  kiosk arrivals, in the root layout beside `AskParamOpener`. Tier `usage` 60/min; GPC, DNT, bots and
  `USAGE_INSIGHT=off` record nothing; always 204 (429 past the tier). It is `EXEMPT` in the parity
  guard as "Not a user action": a browser's own count, with no permission to gate on.
- **Cron**: `/api/cron/daily` stage 4, `usage`, after cleanup. It recounts every complete hour
  still held raw and **replaces** those rollup rows in one transaction (idempotent, and exact when
  a tool is deleted), then prunes raw events older than 30 days on an hour boundary, then gaps
  last asked more than 30 days ago.
- **Backup**: `cron/backup-policy.ts` gains `RETENTION_BOUND` (`usage_events`, `usage_gaps`),
  skipped by the nightly backup **and by `data:push`**; `usage_rollups` is backed up.
- **The page**: `/admin/insights`, surface `insights` (Keep data fresh, `ChartColumn`), a half tile
  counting open gaps. Header links for 7 / 30 / 90 days and Include staff; a totals strip (app
  questions, MCP calls, tool page views, QR scans, kiosk loads and arrivals, citations, unanswered,
  answered rate); the **Unanswered** queue; **Most asked about / Never asked about** on the shared
  `DataTable` (asked in the app and over MCP, views, QR, citations, unanswered); **question kinds**
  as one `Sparkline` per kind; **busiest times** as a 7 × 24 `<table>` in lab time (the table is
  the screen-reader form, shaded from `--primary-ink`); **manuals cited** with top pages.
  "Counting since …" before any data, an error row when unreadable.
- **The Unanswered queue's decisions** (pulled forward from phase 3, GUI only):
  `insights.dismiss_gap` and `insights.file_correction` are registered actions run through
  `performAction` (gate `insights.view`). Both are `assistant: "never"` until phase 4 decides how
  the assistant reads gap text, so no tool, preview or MCP exposure. Filing writes a `feedback` row
  (`issue_description` "Unanswered in the assistant: …", no reporter, `new`) in one transaction with
  the gap's `filed` status; a correction outlives the gap's 30 days because a staff member chose to
  keep it. **Add a manual** links to the tool's page, where the editor is. Queue refresh and bulk
  dismiss wait for phase 3.
- **About**: one sentence in "How it works".

**Not built yet**: the tool editor's "Asked about … in the last 30 days" line; `record_gap`,
bulk dismiss and Queue refresh from the row (phase 3); `usage_summary` and the admin chips
(phase 4); the gap-precision evals.

**Tests**: unit (`lib/usage/*.test.ts`: scrub, gap key, question kinds, absence phrases, audience,
`fromTurn`, MCP calls); integration on PGlite (`usage.integration.test.ts`: recording, gap upsert
and reopening, no identifier columns, never throws, rollup idempotence, the 29/31-day boundaries,
a deleted tool, the watermark, staff toggle, never-asked, the DST cell; `api/chat/usage.route.test.ts`:
a Form 4 turn citing page 12, a not-in-catalog gap scrubbed, an identical answer when the usage
write fails; `api/mcp/usage.route.test.ts`; `api/usage/route.test.ts`: tier, GPC, DNT, bot, off,
unpublished, no identifiers; the cron stage and the backup's tables; the page's gate; the two
actions and their permission); components (`UnansweredQueue`, `BusiestHeatmap`, `UsageBeacon`);
E2E `e2e/admin-insights.spec.ts`.

**Status.** Phases 1 and 2 built, plus the queue's two GUI decisions; PR "v5 usage insights".
Migration `0022` is the next free number on `main` today — if another PR lands a `0022` first,
this one renumbers.

### 2026-09-28 — Value report

The owner asked for a **value report** a lab director can hand a dean to justify the subscription
(about $200 a month): per term or custom date range, estimated staff hours saved and after-hours
coverage, from the anonymous usage data only. Built on branch `v5/insights-value-report`.

**Where.** `/admin/insights/value`, a second tab beside **Usage** on the Insights surface
(`InsightsTabs`, `LinkTabs`). Read on `insights.view`. The period is a term (`?term=fall-2026`, the six
most recent as links) or a custom range (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, at most 366 days, a plain
GET form); anything else is the current term. Uncached; an unreadable report says so, never zeros.

**Lab-set assumptions** (`lab_settings`, key `value_report`, migration `0024_lab_settings`; one JSON
value per deployment, re-validated on every read — `lib/usage/value/assumptions.ts`):

| Assumption | Default |
|---|---|
| Minutes of staff time a question would otherwise take | **4** (0.5–60) |
| Loaded staff cost per hour | **$40** (0–1000) |
| Staffed hours, lab time (`LAB_TIMEZONE`) | from `siteConfig.labHours` / `NEXT_PUBLIC_LAB_HOURS` — "LAB OPEN 8AM-8PM" → **8 AM–8 PM, every day** (weekdays only if the text says Mon–Fri); whole hours |
| Terms (month-day windows, every year, no overlap) | **Spring 01-01 → 05-20, Summer 05-21 → 08-20, Fall 08-21 → 12-31** (contiguous, so every day has a term and a previous term) |
| Unanswered kinds that are *not* handled without staff | **all four** gap kinds |
| Count MCP questions / lookups per question | **yes / 2** |

A stored value that no longer parses falls back to the defaults and the page says so. They are
changed on the page by `insights.set_value_assumptions` (registered action, `performAction`, gated on
the new **`insights.configure`** — admin and super admin — `assistant: "never"`, GUI only; parity spec
amendment "value report"). The row keeps `updated_by`/`updated_at`, shown under the report. No audit
event: the setting is state and the row says who set it.

**Formulas** (shown on the report in words with the period's numbers, `lib/usage/value/report.ts`):

- **Questions answered** = assistant turns in the app (`chat_turn`) + MCP questions, where MCP
  questions = MCP calls to the public catalogue reads (`list_tools`, `search_tools`,
  `get_tool_details`, `get_unit_details`, `get_maintenance_history`, `search_manual`) ÷ lookups per
  question, rounded down.
- **Handled without staff** = app turns − `gap` events of the counted kinds (never below zero) + MCP
  questions. MCP has no unanswered signal; the formula says so.
- **Staff hours saved** ≈ handled × minutes per question ÷ 60. **Value** ≈ hours × hourly cost.
- **After hours** = questions whose lab-time hour is outside staffed hours ÷ questions answered.
  Counted per UTC hour and converted with `Intl` (`lab-clock.ts`), so the DST changeover moves
  nothing; rollups are hourly, which is why staffed hours are whole hours.
- Also: question kinds, the five most-asked tools, manual citations; corrections filed from the
  Unanswered queue in the period (by their `Unanswered in the assistant: ` prefix — the gap row is
  deleted after 30 days, the correction stays) and how many are fixed; manuals made searchable;
  problem reports the assistant filed (`maintenance_logs.type = 'issue_report'` with no Notion id —
  `report_issue` is the only writer — by `date_reported`), resolved, and the median whole days
  from reported to resolved.
- Every headline beside the **previous period**: the term before, or the same number of days
  before a custom range. **Staff are always left out.** Everything is a count; nothing names a person.

**Export.** **Print or save as PDF** is the browser's print over `styles/value-report-print.css`
(scoped with `:has([data-value-report])`: everything but the report `display: none`, Letter, one page,
black on white); **Download CSV** saves the same numbers (headlines for both periods, breakdowns,
assumptions) built on the server, quoted and formula-safe, named after the report. Title:
"`{chatAssistantName}` — Fall 2026 value report", with `siteConfig.name · institution` above it.

**Assistant.** `get_value_report` (`capabilities/value-report.ts`, in `admin-reads`): chat only,
`insights.view`, never on MCP or for students and visitors; a term or range in, the report's counts,
estimates, assumptions and formulas out, no question text, so it does not taint the turn.

**Tests.** Unit: `assumptions`, `lab-clock` (DST both ways, east of UTC), `periods` (term edges,
gaps, previous periods, bounds across DST), `report` (zero data, MCP rounding, unanswered kinds,
after hours across the changeover), `csv`/`format`. Integration (PGlite): `value-report.integration.test.ts`
(a seeded fall and summer, stored assumptions, custom ranges, empty, the rollup watermark, corrections,
tickets and median, manuals, the settings row). Action: `app/admin/insights/value-actions.test.ts`.
Page: `value/page.test.tsx`. Component: `value/value-report.test.tsx`. Capability:
`capabilities/value-report.test.ts`. E2E: `e2e/admin-value-report.spec.ts` (refusal, tab, demo week,
CSV download, one-page print, saving an assumption).

**Status.** Built; PR "v5 insights: value report". Migration `0024` is the next free number on
`main` today; if another PR lands a `0024` first, this one renumbers.
