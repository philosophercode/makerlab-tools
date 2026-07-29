# v5 Specification Set — Master Index

> **Status as of 2026-07-29.** The eight specs below are the source of truth for the
> remaining v5 scope. This file tracks what each one specifies and **what is actually built
> against it**, because a spec set with no conformance record is a wish list.
>
> Constitution: [`../constitution.md`](../constitution.md) — seven articles, binding.
> Format for new specs: [`TEMPLATE.md`](TEMPLATE.md).

## How conformance was checked

**Phase-level, by artifact presence and inspection** — for each spec's §9 build order, does
the code it calls for exist and do its tests pass. Verified 2026-07-29 against commit
`cf46fc2`, with `npm run test:all` exiting 0 (661 unit/integration across 47 files, 17 E2E).

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
| 1 | [Sign-in & Tiered Rate Limiting](2026-07-29-auth-and-rate-limiting-design.md) | 5 | 4 | **Approved** · phase 5 open |
| 2 | [Student Projects Gallery](2026-07-29-projects-gallery-design.md) | 5 | 4 | Draft · phase 3 open |
| 3 | [Agent Eval Harness](2026-07-29-agent-eval-harness-design.md) | 5 | 5 | Draft · complete |
| 4 | [AI Gateway Migration](2026-07-29-ai-gateway-migration-design.md) | 5 | 1 | Draft · **blocked on credentials** |
| 5 | [Operational Hardening](2026-07-29-operational-hardening-design.md) | 7 | 4 | Draft · phases 2, 5–7 open |
| 6 | [QR Codes on Machines](2026-07-29-qr-codes-design.md) | 4 | 4 | Draft · complete |
| 7 | [Report a Correction](2026-07-29-report-a-correction-design.md) | 4 | 4 | Draft · complete |
| 8 | [Intake Confidence](2026-07-29-intake-confidence-design.md) | 5 | 3 | Draft · phases 4–5 deferred |

Also here: [`2026-05-29-v5-test-suite-design.md`](2026-05-29-v5-test-suite-design.md)
(implemented) and [`2026-06-01-chat-inventory-intake-design.md`](2026-06-01-chat-inventory-intake-design.md)
(implemented; extended by #8).

---

## Open gaps, and why

### Genuine gaps — specified, agreed, not yet built

**Auth phase 5 — identity into `CapabilityCtx`.** `CapabilityCtx` has no `identity` field,
so `report_issue` still takes a model-supplied `reported_by` string. **Tickets therefore
still carry names a student typed into chat rather than the verified session**, which is one
of the reasons sign-in was specified at all. Small change; real consequence.

**Projects phase 3 — `author_email`.** Nothing in `src/` references it. Project submissions
record an unverified author for the same reason. Depends on the same `CapabilityCtx` work.

**Ops phase 5 — backup route and cron.** `src/app/api/admin/backup/route.ts` does not exist.
**There is currently no backup of the Notion data at all** — one deleted database and ~100
machines of accumulated staff work is gone. The highest-consequence gap on this list.

**Ops phases 2, 6, 7** — uptime monitor, Notion automation webhook, staff refresh button.
Phases 2 and 6 are configuration a person does, not code. Phase 7 is code and is now
unblocked, since auth has landed.

### Deliberately deferred

**Gateway phases 2–5** — needs an `AI_GATEWAY_API_KEY` and a Vercel project nobody has
configured. Phase 1 (the `src/lib/model.ts` seam) is built and is the part worth having
regardless: it makes the next model upgrade a one-line change.

**Intake confidence phases 4–5** — behaviour gating and parallel fan-out. Both change what
the agent *does* rather than what it reports, and were held for separate review.

### Known coverage gap, spanning specs

**No E2E specs for the five new user-facing paths**: project submission, projects gallery
and detail, report-a-correction, QR arrival, and sign-in/sign-out. Unit and component
coverage is thorough; the constitution names E2E as its own layer. This is the largest
outstanding testing gap.

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
3. **Notion: Projects database** with a `published` checkbox — the Article 5 moderation gate.
4. **Notion: Flags `status` select needs a `"New"` option.** Notion rejects unknown select
   options on write, so corrections fail silently without it.
5. **Is student email in Notion acceptable to the university?** Affects tickets, projects,
   and corrections alike.
6. **Photo consent** for student work in a public gallery.
7. **ISAM rate-limit bypass** — conference wifi NATs every visitor behind one IP, which
   would exhaust the anonymous per-IP allowance within minutes. `RATE_LIMIT_ANON_CHAT`
   exists for this. **Hard deadline.**
8. **Who owns the Vercel project, the API keys, and the bill.**
