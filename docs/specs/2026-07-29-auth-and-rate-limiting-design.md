# Sign-in and Tiered Rate Limiting — Design Spec

**Date:** 2026-07-29
**Status:** Approved for planning — 2026-07-29
**Target:** `v5/`
**Branch:** `v5/auth`
**Spec PR:** TBD · **Implementation PR:** TBD

## 1. Summary

v5 has no concept of who is using it. The catalog is public, the assistant answers anyone,
and maintenance tickets carry a self-reported name typed into chat. That was correct while
the app was a read-only reference tool. It stops being correct now that students submit
projects, that the assistant can write to Notion, and that the Anthropic bill is about to
become an institution's line item rather than a personal one.

This adds **Google Workspace sign-in restricted to `cornell.edu`**, four roles, and a
**tiered rate limit** that replaces the current flat per-IP limiter: anonymous visitors get
a small allowance, signed-in students get a generous one. Browsing the catalog stays fully
open and unauthenticated — sign-in unlocks, it does not gate the front door.

The architectural change is small but load-bearing: an `identity` module that resolves a
request to a user and role, consumed by API routes and by the capability adapters. It is
deliberately *not* a new capability — identity is context every capability receives, not an
ability the agent invokes.

## 2. Goals / Non-goals

### Goals

- A student signs in with their Cornell Google account in one click; no password, no new
  account to create.
- Anonymous visitors browse the full catalog and tool detail pages exactly as today.
- Anonymous visitors can use the assistant, at a strict allowance, so the ISAM demo needs
  no accounts.
- Maintenance tickets and project submissions record a verified identity rather than a
  typed string.
- Staff are distinguishable from students, so a later feature can act on that without a
  second auth pass.
- The Anthropic spend attributable to anonymous traffic is bounded and observable.

### Non-goals (this iteration)

- **No in-app admin CRUD.** Notion remains the editing surface (Article 7). Roles exist to
  gate actions, not to unlock a dashboard that does not exist.
- **No Shibboleth / SAML.** Google Workspace covers every `cornell.edu` account and needs
  no institutional approval; SAML needs an IT ticket and months of lead time.
- **No per-user chat history or memory.** Sessions stay client-side in v5. Persisting them
  requires a datastore Notion is wrong for — that is Blueprint's problem.
- **No trainings or certifications.** "Am I trained on the laser cutter?" stays
  unanswerable in v5. Deferred deliberately; it needs a Notion database and an
  authoritative source of truth the lab does not currently maintain.
- **No account management UI.** No profile page, no avatars, no settings. Sign in, sign
  out, and the header shows who you are.

## 3. Architecture

### 3.1 Library — Better Auth

`better-auth` with its Google social provider and the Next.js handler mounted at
`/api/auth/[...all]`. Chosen over Auth.js because it is on a stable 1.x line rather than a
long-running v5 beta, and over Clerk because a hosted provider adds a vendor account and a
per-MAU bill to a project being handed to an institution.

**Session storage is the one real decision here.** Better Auth expects a database, and v5's
only datastore is Notion — which is emphatically wrong for session rows (rate limits,
latency, and no transactional guarantees).

**Decision: stateless signed-cookie sessions, no session table.** Better Auth is configured
for JWT-style cookie sessions carrying `{ sub, email, name, role }`, signed with
`AUTH_SECRET`. Rationale:

- Zero new infrastructure, which is the entire point of keeping v5 simple to hand over.
- v5 needs identity, not session management. There is no "sign out all devices," no
  session listing, no device history.
- Cookie lifetime is 30 days with a rolling refresh; the blast radius of a leaked cookie is
  bounded by expiry rather than by revocation.

The cost is honest and worth stating: **there is no server-side session revocation.**
Removing a user's access means removing them from the Workspace domain or rotating
`AUTH_SECRET`, which signs everyone out. For a single lab of a few hundred students, that
is an acceptable trade. It would not be for Blueprint.

### 3.2 Where identity lives

```
src/lib/auth/
  config.ts        # Better Auth instance: Google provider, hd restriction, cookie config
  identity.ts      # resolveIdentity(req) -> Identity   ← the module everything else uses
  roles.ts         # Role type, ordering, STAFF_EMAILS parsing
```

```ts
export type Role = "anonymous" | "student" | "staff" | "admin";

export interface Identity {
  role: Role;
  userId: string | null;        // Google `sub`, or null when anonymous
  email: string | null;
  name: string | null;
  /** Stable key for rate limiting: userId when signed in, hashed IP otherwise. */
  rateLimitKey: string;
}

export async function resolveIdentity(req: Request): Promise<Identity>;
```

Every API route calls `resolveIdentity` first. It never throws — an absent or invalid
cookie yields the anonymous identity rather than an error, because anonymous is a
first-class state and not a failure.

### 3.3 How roles are assigned

There is no user database, so role assignment is configuration:

| Role | Assigned when |
|---|---|
| `anonymous` | No valid session cookie |
| `student` | Valid session, `@cornell.edu` — the default for anyone who signs in |
| `staff` | Email listed in `AUTH_STAFF_EMAILS` (comma-separated) |
| `admin` | Email listed in `AUTH_ADMIN_EMAILS` |

Env-var lists are the right mechanism at this scale: the lab has a handful of staff, the
list changes a few times a year, and it needs no UI, no database, and no migration. It is
also trivially auditable — the roster is in the deployment config, visible to whoever
operates it.

Domain restriction is enforced **twice**: Google's `hd` parameter narrows the account
picker, and the sign-in callback re-verifies `email.endsWith("@cornell.edu")` server-side.
The `hd` parameter alone is a UI hint and is not a security control.

### 3.4 Relationship to the capability registry

`CapabilityCtx` gains one field:

```ts
export interface CapabilityCtx {
  writer?: UIMessageStreamWriter;
  attachments?: UploadedImage[];
  locale?: string;
  focusedToolId?: string;
  identity?: Identity;          // NEW
}
```

Adapters populate it; tools consume it. A tool does **not** check whether the caller is
allowed to call it — that stays with the adapter, so the rule is enforced once rather than
per-tool. In v5 no capability is role-gated; `report_issue` and the intake tools simply
record `identity.name` and `identity.email` when present instead of asking the student to
type a name.

This depends on `chat-inventory-intake` being merged first (§7).

## 4. Data model

**No new Notion databases.** Two property changes, both additive and both optional, so
existing records stay valid:

| Database | Property | Type | Purpose |
|---|---|---|---|
| `Maintenance_Logs` | `reporter_email` | Email | Verified reporter, when signed in |
| `Projects` | `author_email` | Email | Verified author (see the projects spec) |

The existing `reported_by` / `author` text properties are unchanged and still populated
with a display name. When a user is signed in, the name comes from Google rather than from
chat. **A human must add these two properties in Notion before the code ships** — Notion
has no migrations.

Records created before this change simply have empty email fields, which every read path
already tolerates.

## 5. Behavior / flow

**Signing in.** Header shows "Sign in." Clicking it goes to Google with `hd=cornell.edu`,
returns to `/api/auth/callback/google`, verifies the domain server-side, sets the cookie,
and redirects back to the page the user started on. The header then shows their first name
and a sign-out control.

**Rejected domain.** A non-Cornell Google account reaching the callback is refused with a
plain explanation — "MakerLab Tools is available to Cornell accounts. You can still browse
the catalog and ask questions without signing in." — and a link back to the catalog. It
never dead-ends.

**Chatting anonymously.** Works. At the allowance ceiling, the assistant returns a clear
message offering sign-in as the way to continue, not a bare 429.

**Filing a ticket.** Signed in, the agent stops asking for a name and records the verified
one. Anonymous, behavior is exactly as today.

**Cookie expiry mid-session.** The next request resolves as anonymous. The UI reflects it
at the next navigation; an in-flight chat completes.

## 6. UI

- **Header:** a sign-in control, replaced when signed in by first name plus sign-out. Must
  match the technical-schematic system — 0px radius, mono label, no avatar image.
- **Rate-limit ceiling in chat:** an inline assistant message with a sign-in link, not a
  toast and not an error state.
- **Domain-rejected page:** a minimal panel with the explanation and a link to the catalog.

New user-facing strings go into all 12 locale files (Article 6). Roughly six strings.

## 7. Relationship to existing work

**Merge `philosophercode/chat-inventory-intake` before starting this.** It refactors
`api/chat/route.ts` into the capability registry and changes the shape of `CapabilityCtx` —
the exact file and type this spec extends. Doing auth first means resolving that conflict
twice.

**The projects gallery spec depends on this one** for `author_email`. Build order:
intake → auth → projects.

`src/lib/rate-limit.ts` is rewritten rather than extended (§8).

## 8. Security and safety

- **Authorization.** No capability is role-gated in v5. Identity is recorded, not enforced
  against. The write-safety model remains drafts-by-default (Article 5), which is
  unchanged and still the real protection.
- **Domain enforcement** happens server-side in the callback. `hd` is a UI hint.
- **Rate limiting**, replacing today's flat per-IP limiter:

  | Caller | `/api/chat` | Other API routes |
  |---|---|---|
  | Anonymous | 8 messages / hour / IP | current limits |
  | Student | 60 messages / hour / user | current limits |
  | Staff, admin | 200 messages / hour / user | current limits |

  Keyed on `identity.rateLimitKey`. The anonymous number is the one to tune with real
  data — it should comfortably cover an ISAM visitor's full demo conversation while
  bounding a scripted abuser. **Start at 8 and instrument it**, rather than guessing once
  and never revisiting.

- **IP hashing.** Anonymous keys are `sha256(ip + AUTH_SECRET)` rather than raw IPs, so the
  limiter store holds no personal data.
- **PII.** Email and display name are held in a signed cookie and written to Notion on
  tickets and projects. No other storage. Worth one line in a privacy note before launch,
  and worth confirming with the university that student email in a Notion workspace is
  acceptable — flagged as an open question.
- **`AUTH_SECRET` rotation** signs everyone out. Document it in the runbook as the
  emergency lever it is.
- **Prompt injection** is unchanged by this spec, but note that identity now flows into the
  system prompt as a name. Escape it, and never place email addresses in the prompt.

## 9. Phased build order

1. **Auth foundation.** `better-auth`, Google provider, `hd` + server-side domain check,
   `AUTH_SECRET`, cookie config, `/api/auth/[...all]`. Verifiable by signing in and reading
   the cookie.
2. **`identity.ts` + `roles.ts`.** `resolveIdentity` with full unit coverage. No consumers
   yet.
3. **Tiered rate limiting.** Rewrite `rate-limit.ts` to key on `Identity`; wire into
   `/api/chat` first, then the remaining routes.
4. **Header UI + locale strings.** Sign in, sign out, rejected-domain page.
5. **Identity into `CapabilityCtx`.** Adapters populate it; `report_issue` records verified
   name and email. Requires the two Notion properties to exist.

Each phase leaves `main` deployable. Phases 1–3 are invisible to users.

## 10. Testing

- **Unit** — `resolveIdentity` across: no cookie, valid cookie, expired cookie, tampered
  signature, non-Cornell email, staff email, admin email. Role ordering. `rateLimitKey`
  stability and IP hashing.
- **Integration** — `/api/chat` at and over the anonymous ceiling; the same request signed
  in getting the higher ceiling; the callback rejecting a non-Cornell domain. Better Auth's
  Google endpoints are mocked via MSW; **no live OAuth in tests** (Article 3).
- **Component** — header in both states; the ceiling message rendering as an assistant
  message rather than an error.
- **E2E** — Playwright with a stubbed session cookie, since driving real Google OAuth in CI
  is neither possible nor desirable. Assert: anonymous browse works; anonymous chat works;
  signed-in header shows the name.

**Cases that would embarrass us in production:**

- A tampered or expired cookie throwing a 500 instead of degrading to anonymous.
- The rate limiter keying on a value that changes per request, making the ceiling
  unreachable or trivially bypassable.
- Sign-in redirecting to `/` instead of back to the page the user was on.
- A non-Cornell account getting a stack trace instead of the explanation page.

## 11. Open questions

1. **Which emails are staff and admin at launch?** Needed before phase 1 ships. *Isaac to
   supply; Niti to confirm.*
2. **Is student email in Notion acceptable to the university?** Tickets and project
   submissions would carry it. Worth asking rather than assuming. *Blocks phase 5, not
   phases 1–4.*
3. **Is 8 messages/hour the right anonymous allowance?** Deliberately a guess. Instrument
   it and revisit with two weeks of data. *Not blocking.*
4. **Does the ISAM demo need a bypass?** A shared demo account, or a higher anonymous
   ceiling behind an env var, in case conference wifi puts every visitor behind one NAT'd
   IP — which would exhaust a per-IP allowance almost immediately. **This is a real
   scenario, not a hypothetical, and it should be resolved before the conference.**

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a
design changed usually outlives the change.

### 2026-07-29 — `GET /api/identity` added (as-built)

**What changed.** A route not present in §3.2's file list: `src/app/api/identity/route.ts`.

**Why.** The header renders inside a statically-shelled layout and cannot read the session
cookie during render, so it needs a small endpoint to ask the server who the caller is.
Not foreseen when this spec was written — §6 assumed the header could resolve identity
directly.

**Scope.** Projects `resolveIdentity` down to **role and display name only**; the email
stays server-side per §8. Always returns 200 with `role: "anonymous"` rather than 401,
because anonymous is a normal answer and not an error. Rate-limited per identity before
any work, though generously — it is one HMAC verification per page load with no outbound
call behind it, and a header showing "Sign in" to someone already signed in is worse than
the traffic it saves.

**Status.** Accepted. The code is right and the spec was incomplete.

### 2026-07-29 — additional environment variables (as-built)

**What changed.** §4 and §11 name `AUTH_SECRET`, `AUTH_STAFF_EMAILS`, and
`AUTH_ADMIN_EMAILS`. The implementation also requires `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `AUTH_BASE_URL`, and `AUTH_ALLOWED_EMAIL_DOMAIN`.

**Why.** The first two are the OAuth client credentials, which the spec assumed rather than
listed. `AUTH_BASE_URL` is required by Better Auth for callback construction on a custom
domain and in local development. `AUTH_ALLOWED_EMAIL_DOMAIN` makes the `cornell.edu`
restriction configuration rather than a constant — which the spec's own white-label
principle (constitution Article 6) implies but did not state.

**Status.** Accepted. All four are documented in `v5/.env.example` and in
[`../handover.md`](../handover.md) §2.

### ~~Open — phase 5 not built~~ (superseded 2026-07-29, see below)

§9 phase 5 (identity into `CapabilityCtx`) is **not implemented**. `CapabilityCtx` has no
`identity` field, so `report_issue` still takes a model-supplied `reported_by` string and
maintenance tickets carry names typed into chat rather than the verified session. Verified
authorship was one of the reasons sign-in was specified. Tracked in
[`README.md`](README.md).

### 2026-07-29 — phase 5 built, with three as-built details

**What changed.** §9 phase 5 is now implemented, which closes the amendment above.
`CapabilityCtx` and `PromptEnv` each carry an optional `identity`; the chat route passes the
`Identity` it already resolved, the MCP route passes its own (normally anonymous, since an
MCP caller presents a bearer token rather than a session cookie); and `report_issue` prefers
`ctx.identity.name` over the model-supplied `reported_by` and writes `reporter_email`
**only** from `ctx.identity.email`. There is no tool-input field for the email and
deliberately no path that would let one exist — a client may never assert its own identity.
Absent identity behaves exactly as before, so anonymous reporting, MCP, and scheduled
callers are unaffected.

Three things the spec did not describe:

1. **Notion property fallback.** §4 requires a person to add the `reporter_email` Email
   column to `Maintenance_Logs` by hand, and Notion rejects any write naming a property
   that does not exist. If that write is refused, the ticket is re-filed without the email
   and the misconfiguration is logged loudly. Losing a student's report of an unsafe
   machine to a missing column is the wrong way to fail (Article 4 — fail toward stale, not
   toward wrong). **This means the feature degrades silently-but-loudly rather than
   blocking on the Notion change**, which is why phase 5 could ship before it.
2. **Display names are escaped before reaching the system prompt.** §8 says to escape the
   name; the as-built rule is specifically: strip newlines and the markdown characters that
   could close a span or open something that reads as an instruction, collapse whitespace,
   cap at 80 characters. A display name arrives from Google and is not an instruction
   channel. Emails never enter the prompt at all.
3. **The prompt fragment branches on identity.** Signed in, it names the student and tells
   the assistant not to ask who they are and to leave `reported_by` empty. Signed out, it
   asks for a name exactly as before — and still files without one if the student declines,
   because an anonymous report beats an unreported fault.

**Status.** Accepted. Verified by 19 tests in `v5/src/lib/capabilities/maintenance.test.ts`
covering verified name and email, fallback to the model-supplied name with no email,
`reporter_email` in tool input being ignored (signed in and signed out), the Notion
property fallback, and prompt-fragment escaping.

**Still needs a person.** The `reporter_email` Email property in `Maintenance_Logs`, and
open question 2 (§11) — whether student email in Notion is acceptable to the university.
Until the column exists, tickets file with the verified *name* and no email.

### 2026-07-29 — the E2E session is stubbed at `/api/identity`, not signed (as-built)

**What changed.** §10 calls for "Playwright with a stubbed session cookie." `v5/e2e/auth.spec.ts`
sets a session cookie under the real name (`makerlab.identity`), but its **value is opaque and
nothing verifies it**. The signed-in state is produced by intercepting `GET /api/identity` with
`page.route()` and answering from the cookie the browser actually sent.

**Why.** The cookie is an HMAC over `AUTH_SECRET`, and the Playwright web server boots with no
credentials at all (constitution Article 3 — the suite runs with every environment variable
unset, which is exactly what makes it deterministic). A cookie signed with a secret the server
does not hold verifies to `null`, so a real token could only be minted by giving the E2E server
an `AUTH_SECRET` — a change to `playwright.config.ts`, outside this work's ownership, and one
that would make the auth E2E the only spec in the suite that depends on a configured server.

The stub sits where the header's *entire* view of the session already is: per the
`/api/identity` amendment above, `PrimaryNav` renders in a statically-shelled layout and knows
nothing except what that route answers. Keying the stub on the cookie header keeps the cookie —
not the stub — the thing that flips the assertion, and the spec asserts both directions from the
same handler (no cookie ⇒ sign-in control; cookie ⇒ first name and sign-out).

**What is therefore *not* covered by E2E**, and is covered by unit tests instead:
`verifySessionToken` (`src/lib/auth/session-cookie.test.ts`) and `resolveIdentity` across
absent, expired, tampered, non-domain, staff and admin cookies (`src/lib/auth/identity.test.ts`).
The browser-side seam — cookie present ⇒ header shows the name — is what E2E adds.

**Also.** §10's third E2E assertion, "anonymous chat works", was already covered before this
change: `v5/e2e/chat.spec.ts` never signs in, so its whole path is the anonymous one. It is not
duplicated in `auth.spec.ts`.

**Status.** Accepted. The spec's intent (no live OAuth, assert the header states) is met; the
mechanism is one layer up from the cookie because the suite deliberately has no secret.
