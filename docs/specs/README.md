# v5 Specification Set — Master Index

> **Status as of 2026-07-30.** The eight specs below are the source of truth for the
> remaining v5 scope. This file tracks what each one specifies and **what is actually built
> against it**, because a spec set with no conformance record is a wish list.
>
> Constitution: [`../constitution.md`](../constitution.md) — seven articles, binding.
> Format for new specs: [`TEMPLATE.md`](TEMPLATE.md).

## How conformance was checked

**Phase-level, by artifact presence and inspection** — for each spec's §9 build order, does
the code it calls for exist and do its tests pass. Verified 2026-07-29 against the
`v5/specs-and-handover` working tree (the batch on top of commit `c3b15a3`), with every gate
run and observed green:

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 3 pre-existing warnings |
| `npm test` | **761 passed** across 51 files |
| `npm run test:e2e` | **33 passed** (chromium) |
| `npm run spec:coverage` | 67 surface items · **0 undocumented** |

The suite was also re-run with a stripped environment (`env -i`) and passes identically,
which is Article 3's own stated check: no credential, no key, no network.

Two mechanisms keep it current: `npm run spec:coverage` (mechanical — every route,
capability tool, script, and env var must appear somewhere in `docs/`) and `/drift`
(semantic — an agent reads specs against code). See [`DRIFT.md`](DRIFT.md).

**What this is not.** It is not a line-by-line conformance proof. A phase marked *built*
means its artifacts exist and are tested, not that every clause of the spec's prose is
satisfied. Where a phase was deliberately skipped, the reason is recorded.

---

## Status

| # | Spec | Phases | Built | State |
|---|---|---|---|---|
| 1 | [Sign-in & Tiered Rate Limiting](2026-07-29-auth-and-rate-limiting-design.md) | 5 | 5 | **Approved** · complete |
| 2 | [Student Projects Gallery](2026-07-29-projects-gallery-design.md) | 5 | 5 | Draft · complete |
| 3 | [Agent Eval Harness](2026-07-29-agent-eval-harness-design.md) | 5 | 5 | Draft · complete |
| 4 | [AI Gateway Migration](2026-07-29-ai-gateway-migration-design.md) | 5 | 2 | Draft · **blocked on credentials** |
| 5 | [Operational Hardening](2026-07-29-operational-hardening-design.md) | 7 | 5 | Draft · phases 2, 6 open |
| 6 | [QR Codes on Machines](2026-07-29-qr-codes-design.md) | 4 | 4 | Draft · complete |
| 7 | [Report a Correction](2026-07-29-report-a-correction-design.md) | 4 | 4 | Draft · complete |
| 8 | [Intake Confidence](2026-07-29-intake-confidence-design.md) | 5 | 5 | Draft · complete |

**35 of 40 phases built.** The 5 open ones sit on two specs, and **not one of them is blocked
on code**: Gateway 3–5 need a key and a Vercel project; Ops 2 and 6 are dashboard
configuration a person does. Six of the eight specs are complete. Everything remaining is in
[Blocking questions](#blocking-questions-for-a-person).

*(Ops was recorded as 6 built on 2026-07-29 and corrected to 5 in the same day's audit: its
phases 1, 3, 4, 5, and 7 have artifacts in code, and 7 − 2 open is 5. The row and its "phases
2, 6 open" note disagreed with each other.)*

### Drift check, 2026-07-30

A semantic pass (`/drift`) after the build, plus actually running the app. `spec:coverage`
was clean at 67 items / 0 undocumented; the findings below were all invisible to it,
because none of them add or remove surface.

| Finding | Bucket | Outcome |
|---|---|---|
| Ops phase 1's **degraded banner** was never built, though the phase was recorded as complete | NOT-BUILT | **Closed** — `DemoDataBanner`, 12 locales, 10 tests |
| Ops §3.4 **lazy manual attachment** — code attaches once to the first message with `cacheControl` instead | SPEC-STALE | Amended; the code's approach is better |
| Intake §3.3 **progressive cards** — emitted per item, but only after the whole batch researches | DIVERGENT | Amended, **open as a decision** |

The banner is the one worth learning from: **no test and no mechanical check could have
caught it.** A missing banner adds no surface and breaks nothing. It took opening the page
and noticing the catalogue claimed two machines with nothing saying they were invented.

Also here: [`2026-05-29-v5-test-suite-design.md`](2026-05-29-v5-test-suite-design.md)
(implemented) and [`2026-06-01-chat-inventory-intake-design.md`](2026-06-01-chat-inventory-intake-design.md)
(implemented; extended by #8).

---

## Constitution audit

Checked article by article against the diff on 2026-07-29, not assumed from the specs.

| Article | Finding |
|---|---|
| 2 — capability registry | Held. `report_correction` and the `POST /api/flags` form share one code path in `capabilities/flags.ts`; routes translate, they do not decide. |
| 3 — tests at every layer, no network | Held, after one gap was closed. 761 unit/integration + 33 E2E, green with `env -i`. No test resolves a real host: the only absolute URLs in tests are `*.test`, `example.*`, and Notion URLs used as *data*, never fetched. **The audit found `src/lib/blob.ts` shipped untested** — the backup route mocks the seam, so nothing asserted the seam's own behaviour. `src/lib/blob.test.ts` (8 tests) now pins the `access: "private"` invariant, the no-random-suffix rule the prune step depends on, and the bounded `list` pagination. |
| 4 — good client | Held. **All 10 API routes rate-limit before any outbound work**, including the new `/api/admin/backup`; the auth handler limits by IP precisely because the caller has no session yet. Intake fan-out is bounded at `RESEARCH_CONCURRENCY = 4` with `allSettled` semantics, so one unidentifiable item cannot fail the batch. |
| 5 — writes are drafts | Held, and directly tested. `createTool`, `createResource`, and `createProject` each hard-code `published: false`. `POST /api/projects` ignores `published: true` from the body **and** from a signed-in client — both are named tests. |
| 6 — no hardcoded branding | Held. All 12 locale files carry **identical key sets (232 keys each)** — verified by path, not by count. 21 keys take placeholders and **every one is passed at its call site**, including the two dynamic sites (`IdentificationCard` forwards `line.values` and `action.labelValues`). This is the bug class that bit this branch before; it is clean now. |
| 7 — Notion is the source of truth | Held. The backup route reads raw Notion pages and adds no editing surface. |

### The security property of this batch

**A client cannot assert its own identity.** Checked directly rather than inferred:

- `reporter_email` is written from `ctx.identity?.email` / `identity.email` only. It is on no
  input schema, and `report_issue`'s `reported_by` is overridden by the session when present.
- `author_email` is written from `identity.email` only. `ProjectPayload` deliberately has no
  such field, and `ProjectWriteFields` documents it as write-only and server-resolved.
- Both are covered by tests that pass the field in the request body and assert it is ignored —
  including the harder case where a *session exists and the body claims something else*.

Anonymous stays a first-class path in all of it: no session simply means no email recorded,
and the submission still succeeds.

---

## Open gaps, and why

### Genuine gaps — specified, agreed, not yet built

~~**Projects phase 3 — `author_email`.**~~ **Built 2026-07-29.** `POST /api/projects`
resolves the identity it already had and writes `author_email` from the session and nowhere
else; the submit form pre-fills the byline from `GET /api/identity` and makes it read-only.
Anonymous submission is untouched, which is the point (spec §5). See that spec's Amendments.

~~**Ops phase 5 — backup route and cron.**~~ **Built 2026-07-29.** `GET /api/admin/backup`
dumps every configured Notion database to one private Vercel Blob file per day
(`backups/YYYY-MM-DD.json`), pruning past 30 days in the same job, on a nightly Vercel Cron.
Every failure path returns non-200 so a broken backup shows up in the cron log rather than
on the day it is needed. **It is inert until a person links a Blob store and sets
`CRON_SECRET`** — see `handover.md` §3. See that spec's Amendments.

**Ops phases 2 and 6** — uptime monitor and Notion automation webhook. Both are
configuration a person does, not code.

~~**Ops phase 7 — staff refresh button.**~~ **Built 2026-07-29.** A `staff`/`admin`-only
Refresh control in the header calls `POST /api/admin/revalidate`, which now authorises a
staff session as well as the `x-admin-secret` header. Server-side authorisation is the
control; hiding the button is presentation. See that spec's Amendments.

### Deliberately deferred

**Gateway phases 3–5** — needs an `AI_GATEWAY_API_KEY` and a Vercel project nobody has
configured. Phase 1 (the `src/lib/model.ts` seam) is built and is the part worth having
regardless: it makes the next model upgrade a one-line change. Phase 2 is now built too —
`@ai-sdk/gateway` is a dependency and the gateway branch calls it — but **the branch has
never run against a live gateway**, so treat "built" here as "written and unit-tested", not
"working". Phase 2's own instruction to verify locally with a key is the part that could not
be done; see the spec's as-built amendment, which also records that the gateway model id in
§3 was wrong.

~~**Intake confidence phases 4–5**~~ **Built 2026-07-29.** Confidence now changes what the
agent does. A low grade proposes **no listing at all** — no card is rendered, and the agent
asks for the one thing that would resolve it; a medium grade leads the card with the
ambiguity and makes resolving it the primary action; high is unchanged. `research_tool`
takes an array and fans out all-settled at a concurrency of 4, so one unidentifiable item
never fails the other seven. **The write model is untouched** — `create_tool` still needs an
explicit human confirmation and still writes `published: false`; confidence never
authorises a write. See that spec's Amendments, which also record that `propose_listing`
now emits its own cards (the adapter only ever rendered the first of a batch) and that
card action labels moved onto `next-intl` keys.

### Known coverage gap, spanning specs

~~**No E2E specs for the five new user-facing paths.**~~ **Largely closed 2026-07-29.** This
was the largest outstanding testing gap; four of the five paths now have E2E specs, and the
suite grew from 17 tests to 33:

| Path | Spec | Tests |
|---|---|---|
| Project submission & gallery | `v5/e2e/projects.spec.ts` | 7 |
| Report a correction | `v5/e2e/corrections.spec.ts` | 3 |
| QR arrival | `v5/e2e/qr-arrival.spec.ts` | 3 |
| Sign-in / sign-out | `v5/e2e/auth.spec.ts` | 3 |

**What is still uncovered, and why.** Project *detail* and "Built with this" — and they
cannot be covered at this layer as things stand. E2E boots with `NOTION_*` unset, so the
published set is empty by construction and there is no project to open. Sign-in is covered
only as far as a *stubbed* session cookie reaches: the Google round-trip is never exercised,
because that would be a network call and Article 3 forbids one. Both limits are deliberate
and are recorded in the relevant specs' Amendments.

---

## Build order

Merge order mattered and is recorded for anyone reconstructing this:
`chat-inventory-intake` → `projects-gallery` → specs 1, 3, 5–8 in parallel → auth.

Most specs depend on the capability registry, which arrived with `chat-inventory-intake`.
Auth touches every API route and was run alone for that reason.

## Blocking questions for a person

These gate work and none of them are code:

1. **Google OAuth client** — ID, secret, redirect URI. Gates auth in any real environment.
2. **`AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS`** — the two lists *are* the entire role
   assignment mechanism. There is no user database.
3. **Notion: Projects database** with a `published` checkbox — the Article 5 moderation gate —
   and an `author_email` **Email** property. Without that column the submission still
   succeeds (the route retries without it and logs loudly), but no verified author is
   recorded.
4. **Notion: Flags `status` select needs a `"New"` option.** Notion rejects unknown select
   options on write, so corrections fail silently without it.
5. **Is student email in Notion acceptable to the university?** Affects tickets, projects,
   and corrections alike.
6. **Photo consent** for student work in a public gallery.
7. **ISAM rate-limit bypass** — conference wifi NATs every visitor behind one IP, which
   would exhaust the anonymous per-IP allowance within minutes. `RATE_LIMIT_ANON_CHAT`
   exists for this. **Hard deadline.**
8. **Who owns the Vercel project, the API keys, and the bill.**
9. **Vercel Blob store + `CRON_SECRET`** — the backup route is built and does nothing until
   both exist. A backup nobody enabled is indistinguishable from the gap it was meant to
   close, so this is a task, not a nicety. The store holds student PII and must stay private.
