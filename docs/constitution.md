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

## Article 3 — The test suite is green, and never touches live services

`npm run test:all` passes before any merge, and makes no network calls to Notion,
Anthropic, or Redis — the mock catalog and MSW guarantee it. Anyone can clone this repo
and run the full suite with no credentials and no cost.

**How to check:** unset every environment variable and run the suite. It passes.

## Article 4 — The mock-catalog fallback must be visible in production

v5 falls back to built-in mock data whenever a Notion env var is missing or a fetch
throws. That is correct for tests and dangerous in production: a misconfigured deploy
serves invented equipment while appearing perfectly healthy.

The fallback stays — the test suite depends on it — but when it engages outside of tests
it must log loudly and surface an unmistakable indicator in the UI. Silent wrong data is
worse than an honest error.

The same standard applies to the assistant: **grounded or explicitly uncertain, never
fabricated.**

## Article 5 — Writes are drafts by default

Anything the agent or a student creates — catalog entries from intake, project
submissions — is written unpublished and requires a human to publish it in Notion.

This is the entire security model for write paths. There is no admin approval queue in the
app; Notion is the approval surface. Do not add a write path that bypasses it.

## Article 6 — Every API route is rate-limited before expensive work

By IP, and before any Notion fetch or model call. The Anthropic bill is real and the
catalog is publicly readable, so an unmetered route is a cost incident waiting to happen.

## Article 7 — Branding, institution, and locale strings come from config

No hardcoded `"Cornell Tech"`, `"MakerLab"`, brand colors, or English-only user-facing
text. Branding comes from `siteConfig`, colors from CSS variables, user-facing strings
from `next-intl` — all 12 locale files updated together.

Maintenance tickets are the deliberate exception: their title and description are always
written in **English** so staff can read them, even when the assistant replies in another
language.

## Article 8 — Notion is the source of truth and the editing surface

The app reads and writes the documented Notion databases and nothing else. It does not
become the place staff edit records — that is Notion's job, and it is why v5 needs no
admin CRUD.

---

## Working agreements

Strong defaults rather than invariants.

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
