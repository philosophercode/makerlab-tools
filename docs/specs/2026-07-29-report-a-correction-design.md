# Report a Correction — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
**Target:** `v5/`
**Branch:** `v5/flags`

## 1. Summary

The catalogue is maintained by hand and increasingly drafted by an AI intake flow, so some
of it is wrong. Right now a student who notices — the wrong bed size, a machine listed in
the wrong room, a manual link that 404s — has nowhere to say so. They tell a friend, or they
stop trusting the catalogue.

The `Flags` Notion database already exists for exactly this. **Nothing in the app reads or
writes it.** This spec connects it: a small "something's off" control on tool detail that
files a flag staff can act on.

Two reasons this is worth more than its size suggests. It is the only mechanism by which the
catalogue gets *more* correct over time rather than slowly less. And every flag is a
human-labelled example of the system being wrong — which is precisely the corpus the eval
harness needs and does not have.

## 2. Goals / Non-goals

### Goals

- A student can report a wrong field in under fifteen seconds, without an account.
- The report names the specific field, not just the tool, so staff can act without
  investigating.
- Reports land in Notion where staff already work.
- Signed-in reporters are identified, so staff can follow up.
- Abuse is bounded.

### Non-goals (this iteration)

- **No in-app review queue.** Staff triage in Notion (Article 8). A moderation UI is a
  dashboard v5 deliberately does not have.
- **No suggested edits applied automatically.** A student proposes; a human decides. Applying
  crowd edits to a safety-relevant catalogue is a category of risk this lab should not take.
- **No flagging of assistant answers.** Tempting, and it belongs with the eval harness where
  a wrong answer can be tied to the conversation that produced it. Here it would produce
  reports nobody can reproduce.
- **No public flag visibility.** Nobody sees what has been reported. Visible flags invite
  argument and make the catalogue look unreliable while a correct report sits unread.
- **No notification to the reporter.** Realistically nobody will send them, and promising a
  reply that never arrives is worse than promising nothing.

## 3. Architecture

Small: one capability tool, one form, one existing Notion database.

```
src/lib/capabilities/flags.ts    # NEW — a `report_correction` write tool
src/components/FlagButton.tsx    # NEW — control + modal on tool detail
src/app/api/flags/route.ts       # NEW — form submission path
```

**Why both a capability and a route.** The capability makes it available to the assistant —
so a student who says "the bed size is wrong" in chat can have it filed conversationally,
which is the lowest-friction path that exists. The route serves the UI control for people
who are not in a conversation. Both call the same underlying write, so there is one code
path and one set of validation (Article 2).

The capability is `kind: "write"`, so over MCP it is gated behind `MCP_TOKEN` like every
other write.

## 4. Data model

**The `Flags` database already exists** with the right shape — this is the rare feature that
needs no Notion changes. Confirm these properties are present:

| Property | Type | Notes |
|---|---|---|
| `title` | Title | Generated: `"<tool> — <field>"` |
| `tool` | Relation → Tools | Which machine |
| `field_flagged` | Select | `description` · `image` · `name` · `category` · `location` · `materials` · `safety_info` |
| `issue_description` | Text | What's wrong |
| `suggested_fix` | Text | Optional |
| `reporter` | Text | Name, or empty |
| `reporter_email` | Email | **New** — when signed in. Mirrors the auth spec |
| `status` | Select | `New` · `Reviewed` · `Fixed` · `Dismissed` |
| `created_at` | Created time | |

`FlagFields` and `FlagRecord` already exist in `src/lib/types.ts`. Only `reporter_email` is
new, and only if the auth spec has landed — without it, everything else works with an empty
reporter.

## 5. Behavior / flow

**From the tool page.** A small "Report a correction" control, quiet rather than prominent —
it should be findable when someone needs it and not compete with the content. Opening it
shows a short form: which field (pre-selected if they clicked from a specific field), what's
wrong, and optionally what it should say.

Submitting shows a plain confirmation: the report was sent and staff will review it. **Do
not promise a reply.**

**From chat.** A student saying "that's wrong, the X1 bed is 256 not 220" gets an offer to
file it. The assistant confirms the field and the correction before writing — the same
confirm-before-write pattern the intake flow already uses, for the same reason: a write tool
that fires on ambiguous intent creates noise staff then have to clear.

**Staff side.** Flags appear in Notion. They triage, fix the underlying record, set `status`.
Nothing in the app enforces this — same as maintenance tickets, and the same warning applies:
**a queue nobody reads teaches students not to report.** The handover guide should name an
owner.

**Unhappy paths.** Notion unreachable → the form says the report did not send and keeps what
was typed. Rate limited → a message with when to retry. Empty description → client-side
validation before submit.

## 6. UI

- **`FlagButton`** — a text control in the tool detail footer. Technical-schematic style: no
  icon-only button, no colour, 0px radius.
- **Modal** — field select, description textarea, optional suggested fix, optional name when
  not signed in. Submit disabled until a description exists.
- **Confirmation** — inline, replacing the form. Not a toast; toasts vanish before they are
  read.

All strings through `next-intl`, all 12 locale files. Roughly eight strings.

Mobile matters here more than usual — this gets used standing at a machine, on a phone.

## 7. Relationship to existing work

- **`Flags` DB, `FlagFields`, `FlagRecord` already exist** and are unused. This is
  connecting existing scaffolding, not building new.
- **Depends on `chat-inventory-intake`** for the capability registry.
- **`reporter_email` depends on the auth spec.** Ships fine without it.
- **Feeds the eval harness**: flagged fields are known-wrong examples, and the eval spec's
  open question about seeding cases from real data is partly answered by this.
- Independent of projects, QR, Gateway, ops hardening.

## 8. Security and safety

- **Anonymous reporting is allowed.** Requiring sign-in would kill the feature — the whole
  point is a fifteen-second path. Abuse is handled by rate limiting, not identity.
- **Rate limit: 5 flags per hour per IP.** Tighter than chat, looser than project
  submission.
- **Writes are inert by construction.** A flag never modifies a tool; it creates a row in a
  separate database. There is no path from a student's report to the live catalogue that
  does not pass through a human. This is the whole security model, and it is stronger than
  drafts-by-default because nothing is even provisionally applied.
- **Untrusted text** goes into Notion as plain text. Never rendered as HTML or Markdown
  anywhere in the app, and never fed to the assistant — a flag is staff-facing only, which
  also removes any prompt-injection surface.
- **Length caps** on description and suggested fix (2,000 characters each).
- **PII**: name and, when signed in, email. Same open question as the auth spec.

## 9. Phased build order

1. **`flags.ts` capability** with `report_correction`, plus tests. Available in chat
   immediately; no UI yet.
2. **`/api/flags` route**, rate-limited, sharing the capability's validation.
3. **`FlagButton` + modal** on tool detail, with locale strings.
4. **`reporter_email`** wired, once auth has landed.

Steps 1–3 ship independently of everything else in the v5 scope.

## 10. Testing

- **Unit** — flag payload construction: title generation, field enum validation, length
  caps, empty-description rejection, `reporter_email` present only when signed in.
- **Integration** — `POST /api/flags` with MSW-mocked Notion: valid payload creates a row
  with `status: New`; an invalid `field_flagged` is rejected; rate limit returns 429 after
  the fifth; a Notion failure returns 5xx **without leaking the Notion error**; and — the
  assertion that matters — **a flag submission never writes to the Tools database.**
- **Component** — modal validation, submit disabled while empty, confirmation replaces the
  form, input preserved on failure.
- **E2E** — open a tool page, report a correction, see the confirmation.

**Cases that would embarrass us**
- A flag mutating the tool it refers to.
- Flag text rendered unescaped anywhere.
- The control being so prominent it reads as "this catalogue is unreliable."
- Reports accumulating for months with nobody assigned to read them.

## 11. Open questions

1. **Who triages flags, and how often?** Same question as maintenance tickets and the same
   consequence. Name an owner in the handover guide before shipping the button. *Niti.*
2. **Should the assistant proactively offer to file one** when a student disputes a fact, or
   only when asked? Proactive risks noise; passive means it rarely happens. Recommend
   passive first, and revisit once there is any volume at all.
3. **Is `field_flagged` the right granularity?** Seven options may be more than a student
   wants to think about. Consider collapsing to three — "wrong information," "broken link,"
   "safety concern" — if the form tests badly.
