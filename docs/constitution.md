# MakerLab Tools v5 — Constitution

> **Status:** Active · **Adopted:** 2026-07-29 · **Applies to:** `v5/`
>
> Non-negotiable principles for the v5 codebase. **Every agent and contributor reads this
> before writing code.** Where this document and a task instruction conflict, raise the
> conflict rather than silently picking one.
>
> Amendments are made by PR that changes this file, with the rationale in the PR body.

---

## Why this exists

v5 is the live Cornell Tech MakerLAB deployment, and it is being handed to people who did
not write it. Most of its code was written by AI agents from specs. Both facts mean the
same thing: **the invariants have to be written down, because the person maintaining this
in a year will not be the person who chose them.**

This is a shorter document than a greenfield project would need. v5 is finishing a defined
feature set and then entering maintenance — these articles protect what already works.

---

## Article 1 — No feature without a merged spec

The spec PR merges **before** the implementation PR opens. Use `docs/specs/TEMPLATE.md`;
`/spec` scaffolds one.

A spec is cheap to argue with and cheap to throw away; an implementation is neither. It is
also the artifact that makes AI-generated code reviewable, since the interesting question
is almost always "is this the right thing" rather than "is this valid TypeScript."

Trivial fixes — typos, dependency bumps, one-line corrections — are exempt. If you are
wondering whether something is exempt, it is not.

## Article 2 — Agent abilities go in the capability registry

Tools are declared once in `src/lib/capabilities/` as data plus a `run()` function, and
surfaces (chat, MCP) are thin adapters over that registry. An ability added directly to a
route handler works in exactly one place and is invisible to the other surface.

Adapters translate. They do not decide.

## Article 3 — Every change ships with tests, and the suite never touches live services

**Comprehensive, not incidental.** New behaviour is covered at the layer it lives in:

| Layer | Covers |
|---|---|
| Unit | Pure logic — parsing, mapping, validation, derivation |
| Integration | API routes, with every external service mocked |
| Component | Rendering, states, interaction |
| E2E | The user path end to end, in a real browser |

A pull request that adds behaviour without tests is incomplete, and "hard to test" usually
means the code is shaped wrong rather than that the test is unnecessary.

**No test makes a network call.** The mock catalogue serves the data layer, MSW intercepts
HTTP, and model calls are stubbed at the `streamText` boundary. This is what lets anyone
clone the repository and run everything with no credentials, no API key, and no cost — and
it is why the suite is deterministic.

**How to check:** unset every environment variable and run `npm run test:all`. It passes.

*(The agent eval harness is deliberately separate. It makes real model calls, costs money,
and is run on demand — it is not part of this suite and must never gate a merge.)*

## Article 4 — Be a good client of every external service

Notion, Anthropic, and any service added later are metered, rate-limited, and occasionally
down. Treat every outbound call as something to avoid making. In descending order of
importance:

**Cache reads aggressively, and get freshness from invalidation rather than polling.** A
catalogue edited a few times a week does not need revalidating every minute. Cache for
hours or days, and refresh on the event that actually changes the data — a staff action, a
webhook, an explicit revalidate call.

**Rate-limit inbound before doing expensive outbound.** Every API route, keyed by user when
known and by IP otherwise, checked *before* any Notion fetch or model call. The catalogue is
publicly readable and the model bill is real, so an unmetered route is a cost incident
waiting to happen.

**Use prompt caching for repeated model context.** The system prompt, the catalogue index,
and attached manuals are large and largely identical across the turns of a conversation.
Mark them cacheable rather than re-sending them every turn.

**Load context lazily.** Fetch what the turn needs, not what it might need. A manual that
weighs more than the rest of the request should be attached when the conversation is
actually about that machine, not on every message.

**Bound concurrency and never call a service in an unbounded loop.** Fan-out is fine;
unbounded fan-out is how a single user action becomes a rate-limit ban or a surprising bill.

**Fail toward stale, not toward wrong.** When a refresh fails, serving slightly old cached
data is correct. Serving invented data because a fetch threw is not — the failure must be
visible in logs and, where a person could act on it, in the interface.

## Article 5 — Writes are drafts by default

Anything the agent or a student creates — catalogue entries from intake, project
submissions — is written unpublished and requires a human to publish it in Notion.

This is the entire security model for write paths. There is no admin approval queue in the
app; Notion is the approval surface. Do not add a write path that bypasses it.

## Article 6 — Branding, institution, and locale strings come from config

No hardcoded `"Cornell Tech"`, `"MakerLab"`, brand colours, or English-only user-facing
text. Branding comes from `siteConfig`, colours from CSS variables, user-facing strings
from `next-intl` — all 12 locale files updated together.

Maintenance tickets are the deliberate exception: their title and description are always
written in **English** so staff can read them, even when the assistant replies in another
language.

## Article 7 — Notion is the source of truth and the editing surface

The app reads and writes the documented Notion databases and nothing else. It does not
become the place staff edit records — that is Notion's job, and it is why v5 needs no admin
CRUD.

---

## Working agreements

Strong defaults rather than invariants.

- **The assistant is grounded or explicitly uncertain — never fabricated.** If the catalogue does not say it, the assistant does not assert it.
- **Server components by default.** `"use client"` only when the component needs interactivity.
- **`@/` import alias** for everything under `src/`.
- **Server-only modules import `"server-only"`.**
- **Separation of concerns.** Prefer several focused files over one large one.
- **Tests colocated** as `*.test.ts(x)` next to their source.
- **Comment density and naming match the surrounding file.** New code should be indistinguishable in style from the code around it.
- **Never `rm`.** Deletions are proposed and approved separately, never bundled into a larger change.

---

## Precedence

1. This constitution
2. The merged spec for the feature being built
3. `docs/v5-plan.md` (architecture; §9 is the long-term vision)
4. `AGENTS.md` and `v5/AGENTS.md` (repo map and conventions)
5. Task instructions

When a task instruction requires violating an article, **stop and say so.** The article may
deserve amendment — that is a conversation, not a decision to make mid-implementation.
