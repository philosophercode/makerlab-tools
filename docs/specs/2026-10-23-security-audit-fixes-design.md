# Security Audit Fixes — Design Spec

**Date:** 2026-10-23
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `claude/project-thread-08y92j-security`
**Spec PR:** this PR (spec and fixes together, owner decision 2026-10-23) · **Implementation PR:** this PR

## 1. Summary

A source-and-local security audit of commit `6978ceb` was run with Cloudflare's
`security-audit-skill` (quick profile; every local check in an OS-enforced sandbox, dummy
data only, nothing sent to the live site). It confirmed six findings: two medium and four
low. It also raised two leads that needed a deployment fact. `npm audit` found 54
dependency advisories, two of them critical, in Next.js 16.3.8. This spec fixes all of them.
No feature changes, apart from one new setting (`DEMO_PASS_DAILY_LIMIT`) and the chat's
taint refusal, which now asks for a new chat.

## 2. Goals / Non-goals

### Goals

- Each confirmed finding is closed by a source change, and each has a regression test.
- The dependency tree has no critical, high or low advisories. What remains is a short,
  stated list of dev-only moderates.

### Non-goals

- **Email verification for demo passes.** It is the complete fix for pass minting, but it
  is a feature in its own right. The daily cap bounds the spend today.
- **Major-version upgrades** (`ai` 7, `workflow` 5, `vitest` 5). Every fix here stays
  inside the current major.
- **The critic's three deferred units.** These are CSRF on the cookie-authenticated API
  routes, the decider binding in `/api/chat-proposals`, and the Workflow SDK's generated
  endpoints. They are for the next, `standard`-profile audit.

## 3. Changes

| Finding | Severity | Change |
|---|---|---|
| The usage scrub's email regex is quadratic, and every chat turn runs it over the whole question (about 4.7 s of blocked event loop for a 59,900-character anonymous message) | medium | `scrubQuestion` runs its patterns on the first `SCRUB_INPUT_CHARS` (4 × 300) code points only (`src/lib/usage/scrub.ts`) |
| Unverified demo-pass emails mint a fresh $0.50 budget each (60 an hour per IP) | medium | A deployment-wide cap on new passes in any 24 hours, `DEMO_PASS_DAILY_LIMIT` (default 200, about $100 a day at the default budget). Past the cap a *new* address gets 503 `busy`, which the form already shows as "Sign-up isn't available right now". An address that already has a pass still gets it back (`src/app/api/demo-pass/route.ts`, `src/lib/data/demo-signups.ts`, `src/lib/demo-pass/config.ts`) |
| `GET /api/auth/mcp/get-session` hands a bearer its own refresh token, so a leaked one-hour token renews itself | low | The auth route refuses the path with 403 (`src/app/api/auth/[...all]/route.ts`). The app resolves tokens itself |
| A pending MCP consent code can be exchanged at `/mcp/token` before consent, and `POST /api/auth/oauth2/consent` skips the ownership check | low | The auth route refuses `oauth2/consent` with 403, and refuses `/mcp/token` with 400 `invalid_grant` for a code whose row is still `requireConsent`. Consent goes only through `decideConsent`, which checks ownership, applies read-only and audits |
| Chat taint resets every request, although the history re-sends earlier outside reads | low | `historyReadOutside(messages)` (`src/lib/chat/taint.ts`) starts the turn tainted when the history carries an outside-content tool part, or a dynamic one. The refusal now says "make the request in a new chat" |
| The `changeLocale` server action calls `revalidatePath("/", "layout")` for anyone | low | It only sets the cookie. The caller's `router.refresh()` re-renders, and setting a cookie in a server action already clears that caller's router cache |

### Leads

- **Markdown images to any host** (`allowedImagePrefixes: ["*"]`). Fixed without waiting
  for validation: `MESSAGE_MARKDOWN` draws an image only from a same-origin path. Any other
  source becomes a link that is never fetched, so steered model text cannot send data
  off-site on its own.
- **First `X-Forwarded-For` hop as the rate-limit key.** Resolved for this deployment:
  Vercel overwrites `x-forwarded-for` with the client's IP to prevent spoofing (Vercel
  docs, "Request headers"). A fork behind a different proxy must make sure that proxy
  overwrites the header too.

### Dependencies

- `next` and `eslint-config-next` move to 16.4.3. This patches two unauthenticated RCEs:
  the image optimizer with SVGs, and `use cache` returning typed arrays.
- Within their majors: `@modelcontextprotocol/sdk`, `ai`, `@ai-sdk/gateway`,
  `@ai-sdk/react`, `zod`, `undici`, `workflow`, `@vercel/blob`, `vitest`,
  `@vitest/coverage-v8` and `@workflow/vitest`. `@types/node` moves to 24, to match the
  runtime.
- `overrides` pins nested `zod` (^4.6.7) and `devalue` (^5.9.3). Without them, the workflow
  packages bring in vulnerable copies.
- **Left:** 4 moderate advisories in `drizzle-kit`'s bundled `esbuild` (`@esbuild-kit/*`).
  They are dev-only, and the advisory concerns esbuild's dev server, which the repo never
  starts. `npm audit` would fix them by downgrading drizzle-kit to 0.18, which is not a fix.

## 8. Security and safety

This whole spec is security work. Every refusal answers with a reason: 403 with a code, or
`invalid_grant` (Article 4). None of the changes widens access.

## 10. Testing

Regression tests:

- `src/lib/usage/scrub.test.ts`: 400,000 characters scrub in under 250 ms.
- `src/i18n/actions.test.ts`: no `revalidatePath` or `revalidateTag`.
- `src/lib/auth/mcp-oauth.test.ts`: a pending code gives 400 and allowing it still works;
  `oauth2/consent` gives 403 in three spellings; `get-session` gives 403.
- `src/lib/chat/taint.test.ts` and `src/app/api/chat/taint.route.test.ts`: a follow-up
  message after a ticket read is refused with `tainted_turn`.
- `src/app/api/demo-pass/route.test.ts` and `src/lib/demo-pass/config.test.ts`: the daily
  cap is enforced, and an existing pass is still returned.
- `src/components/ai-elements/message-response.test.tsx`: an off-site image becomes a link.

The audit's own reports are in the project files (`security-audit/REPORT.md`).
