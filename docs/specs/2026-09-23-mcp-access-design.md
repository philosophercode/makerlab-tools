# MCP Access: Public Reads, Personal Tokens, Sign-in — Design Spec

**Date:** 2026-09-23
**Status:** Implemented (branch `v5/mcp-access`, 2026-09-24) — see the amendment at the end
**Target:** `v5/`
**Branch:** `v5/mcp-access-spec`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

v5 already serves its capability tools over MCP at `/api/mcp`, through the same registry the
chat uses (Article 2). Its access model predates accounts:

- **One shared secret, `MCP_TOKEN`.** When it's unset, the endpoint is open and read-only.
  When it's set, the whole endpoint needs that one secret, and the write tools appear for
  whoever holds it.
- **Every caller is anonymous.** A ticket filed over MCP has no verified reporter, and a
  caller's role never applies.

This spec gives MCP the same identity and permissions as the web app:

1. **Public, read-only, no sign-in.** Anyone can connect an MCP client and search the lab's
   inventory: tools, units, availability. This is the "open MCP", unchanged except that it
   stops exposing reporter names.
2. **Personal access tokens.** A signed-in person creates a token from the profile menu. The
   app stores only its hash, and the person can revoke it. MCP calls with that token act *as
   that person*, with exactly their role's permissions and nothing more. This replaces
   `MCP_TOKEN`.
3. **Sign in with MakerLab (OAuth).** MCP clients that support the MCP authorization flow,
   such as claude.ai custom connectors, get a sign-in button instead of a pasted token, using
   Better Auth's `mcp` plugin, which is already in the installed package.

With identity in place, MCP gains **role-scoped tools**:

- *users* can file tickets and corrections under their verified name, and list their own
  reports;
- *admins* can see drafts and the intake queue, work maintenance tickets, and propose
  catalogue changes;
- nothing an agent does over MCP publishes or edits the live catalogue without a person
  accepting it in the app (Article 5).

A **how-to guide**, `docs/mcp.md`, ships with the build. It covers setup in Claude Code,
Claude Desktop, claude.ai, ChatGPT, Codex and a generic client, plus a copy-paste prompt
that lets a coding agent configure the connection itself without ever seeing the token.

## 2. Goals / Non-goals

### Goals

- **Public reads stay open,** keyed by IP and rate-limited, and never include a person's
  name or email.
- **An authenticated call resolves to the same `Identity` the web app uses.** Role, ban and
  the super-admin floor all apply, and `can()` decides what is exposed. There is no
  MCP-specific permission table.
- **Tokens:**
  - created, named, listed and revoked from the profile menu;
  - shown once;
  - stored as a SHA-256 hash;
  - optionally set to expire;
  - optionally **read-only** (a token with less than the role allows, never more);
  - `last_used_at` tracked.
- **OAuth for clients that support it,** using the MCP authorization spec's discovery
  endpoints, with Google sign-in underneath as today.
- **Tool listings match the role.** An MCP client only *sees* the tools its identity may
  use, so a model is never offered a tool that will refuse.
- **`MCP_TOKEN` is retired,** with a one-release deprecation during which it still works but
  maps to a no-role, read-only identity. It is then removed.
- **The how-to guide ships** in the same PR as the feature.

### Non-goals (this iteration)

- **Publishing or editing catalogue fields directly over MCP.** Admin changes are proposals
  (§3.3), accepted in the app.
- **Starting research or intake batches over MCP.** Research spends money and stays a button
  press in the app (data-platform spec §3.6). An admin can list the queue over MCP, not
  launch it. Revisit if a real need appears (§11).
- **Per-tool scopes beyond read-only / full.** Tokens inherit the role. Fine-grained scopes
  are Blueprint's problem.
- **Service accounts** that aren't a person, and org-wide tokens.
- **SSE streaming, `GET` sessions and resumability.** The route stays stateless JSON, which
  is what works on serverless.

## 3. Architecture

### 3.1 Resolving identity for MCP

`resolveIdentity(req)` (`src/lib/auth/identity.ts`) gains a bearer branch, tried before
cookies:

```text
Authorization: Bearer mlt_<32 random bytes, base64url>   → personal token
Authorization: Bearer <OAuth access token>                → Better Auth mcp plugin session
(none)                                                    → anonymous (public reads)
```

- **Personal token:** hash the token, look it up in `api_tokens` (not revoked, not expired),
  load the user, then apply the same ban and floor rules as a session.
  `rateLimitKey = token:<id>`.
- **OAuth:** verify through Better Auth's `mcp` plugin session lookup (`getMcpSession` or
  its current equivalent — confirm the exact API in Phase 0). It yields the same user row.
- **Refusal.** A bad, revoked or expired token is a **401** with a JSON-RPC error that names
  the reason category ("token revoked", "token expired", "unknown token"). It is never
  treated as anonymous. For OAuth, the 401 carries a `WWW-Authenticate` header pointing at
  the resource metadata (§3.4).

Tokens are never logged. Only the 8-character prefix (`mlt_ab12cd34`) appears in logs and in
the UI.

### 3.2 What each identity sees

The MCP adapter (`src/lib/capabilities/mcp-adapter.ts`) already skips `chatOnly` tools. It
now also filters by `requiredPermission` against the caller's identity, and by `kind:
"write"` for read-only tokens.

| Tool | Anonymous | User | Admin | Notes |
|---|---|---|---|---|
| `list_tools`, `search_tools`, `get_tool_details` | ✓ | ✓ | ✓ | Admins also see drafts and archived tools, marked as such (`tools.edit`) |
| `get_unit_details` | ✓ | ✓ | ✓ | |
| `get_maintenance_history` | ✓ *(no names)* | ✓ *(no names)* | ✓ *(names)* | **Fix:** today it returns `reportedByName` to anyone; public and user callers get dates, status and summaries only |
| `report_issue` | — | ✓ | ✓ | Verified name and email from the identity; `reported_by` is ignored |
| `report_correction` | — | ✓ | ✓ | Same |
| `list_my_reports` *(new)* | — | ✓ | ✓ | The caller's own tickets and corrections, with status |
| `create_tool` | — | — | ✓ | `tools.add`; stays draft-only |
| `list_intake_queue` *(new)* | — | — | ✓ | `tools.approve`; read-only view of pending items and their status |
| `list_open_tickets` *(new)* | — | — | ✓ | `maintenance.manage`; the queue as on `/admin/maintenance` |
| `update_ticket` *(new)* | — | — | ✓ | `maintenance.manage`; status, priority, assignee, resolution: the same `runQueueWrite` path the admin page uses |
| `propose_change` *(new, after refresh Phase 1)* | — | — | ✓ | `tools.edit`; creates a `FieldProposal` (refresh-research spec §4.2 and §12). It writes nothing; the admin accepts it in the app |

`identify_tools`, `read_page` and the curation tools stay `chatOnly`: they depend on uploaded
photos, the focused page, or proposal cards in the chat UI.

### 3.3 Why admin edits are proposals

An admin's agent asking to "fix the Trotec's power spec" over MCP gets a proposal, and the
proposal appears on the refresh review page (`/admin/refresh`), where one click applies it
through the editor's revision check. This keeps one approval surface (Article 5). It also
reuses the refresh-research machinery rather than adding a second write path, and it means a
leaked token cannot silently rewrite the catalogue.

`update_ticket` is the exception: working a maintenance queue is operational rather than
catalogue publishing, and the admin page already writes it in one click.

### 3.4 OAuth (Phase 3)

- **Better Auth's `mcp` plugin** exposes the OAuth authorization server and the discovery
  documents MCP clients look for:
  - `/.well-known/oauth-authorization-server`;
  - `/.well-known/oauth-protected-resource`, pointing at `/api/mcp`.
- **Sign-in** goes through the existing Google provider and allowed-domain rules.
- **Consent screen:** a small `/oauth/consent` page ("*Claude* wants to access MakerLab as
  *you*"), with read-only as an option.
- **OAuth grants are listed next to tokens** in the profile menu's "Connected apps" and can
  be revoked the same way.
- **Unverified.** The plugin's exact configuration and its compatibility with the current
  MCP authorization spec revision are to be confirmed in Phase 0, against the installed
  `better-auth` version. If it falls short, `oidc-provider` is the fallback.

## 4. Data model

### 4.1 `api_tokens` (migration: next free number)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | text fk `user`, cascade | Deleting a person revokes their tokens |
| `name` | text | "Claude Code on my laptop" |
| `prefix` | text | First 8 characters after `mlt_`, for display |
| `token_hash` | text unique | SHA-256 of the full token |
| `read_only` | boolean default false | |
| `expires_at` | timestamptz null | Choices: 30 days, 90 days, or never |
| `last_used_at` | timestamptz null | Updated at most once a minute |
| `revoked_at` | timestamptz null | |
| `created_at` | timestamptz | |

**OAuth** clients, grants and access tokens live in the tables the Better Auth plugin
defines, generated with the project's Drizzle adapter.

### 4.2 Audit

`AUDIT_ACTIONS` gains `token.created` and `token.revoked` (security-relevant under §4.11 of
the data-platform spec). Tool calls themselves aren't audited; tickets and proposals already
record who made them.

## 5. Behavior / flow

### 5.1 Creating a token

1. Profile menu → **Connect an AI assistant** → `/account/tokens`.
2. **New token:** name, expiry, read-only toggle, then **Create**.
3. The page shows the token once, with a copy button and ready-to-paste snippets for Claude
   Code and Claude Desktop (§7).
4. The list shows each token's name, prefix, read-only flag, last used, expiry and a
   **Revoke** button.

### 5.2 Using it

- **The client calls `/api/mcp`** with the bearer token, and `tools/list` returns what the
  role allows.
- **A tool refused mid-session** (role changed, token revoked) answers a clear JSON-RPC error
  and the next `tools/list` reflects it.
- **Rate limits:**
  - anonymous: 30 requests a minute per IP (today's figure);
  - token or OAuth: 60 a minute per identity;
  - writes: 10 a minute per identity.

### 5.3 Unhappy paths

- **Banned user:** their tokens stop working at once, with a 401 saying "account
  suspended". The floor exception applies as in §3.4 of the data-platform spec.
- **Demoted admin:** admin tools vanish from `tools/list` on the next call.
- **`MCP_TOKEN` still set after upgrade:** accepted for one release as a read-only, no-role
  identity, with a deprecation warning in the logs and on `/admin`. Then removed.

## 6. UI

- **`/account/tokens`,** reached from the profile menu for any signed-in person:
  - a token list;
  - a create form;
  - a one-time reveal panel;
  - revoke with inline confirmation;
  - a "Connected apps" section for OAuth grants in Phase 3.
- **`/oauth/consent`** (Phase 3).
- **Strings:** about 30 keys under `account.tokens.*`, English first.

## 7. The how-to guide (`docs/mcp.md`, linked from the About page and `/account/tokens`)

The guide ships with Phase 2. Draft:

> **Connect an AI assistant to MakerLab Tools**
>
> MakerLab's inventory is available to AI assistants over MCP at
> `https://<your-deployment>/api/mcp`.
>
> **Just browsing?** No account needed. Add the URL as an MCP server and ask things like
> *"Which laser cutters are available?"* You get read-only access to tools, units and
> availability.
>
> **To file reports or use admin tools,** create a personal token: profile menu → *Connect an
> AI assistant* → *New token*. Copy it — it's shown once.
>
> **Claude Code**
> ```bash
> claude mcp add --transport http makerlab https://<your-deployment>/api/mcp \
>   --header "Authorization: Bearer mlt_…"
> ```
> Run `/mcp` inside Claude Code to check it's connected.
>
> **Claude Desktop** — Settings → Connectors (or edit `claude_desktop_config.json`) and add a
> remote MCP server with the URL and an `Authorization: Bearer mlt_…` header. *(Exact menu
> names change between releases; the guide will carry screenshots taken at build time.)*
>
> **claude.ai** — Settings → Connectors → *Add custom connector* → paste the URL. Once
> sign-in is enabled (Phase 3) you'll be sent to MakerLab to sign in with Google; no token
> needed.
>
> **ChatGPT** — Settings → Connectors → create a custom connector with the MCP URL (custom
> MCP connectors sit behind ChatGPT's developer-mode / connector settings, depending on plan).
> ChatGPT connectors authenticate with OAuth or no auth, not a pasted header, so: no auth gives
> the public read-only tools today; your own account's tools arrive with sign-in (Phase 3).
>
> **Codex (CLI / IDE)** — add a streamable-HTTP server to `~/.codex/config.toml`, with the
> token read from an environment variable rather than written into the file:
> ```toml
> [mcp_servers.makerlab]
> url = "https://<your-deployment>/api/mcp"
> bearer_token_env_var = "MAKERLAB_MCP_TOKEN"
> ```
> then `export MAKERLAB_MCP_TOKEN=mlt_…` in your shell profile. (Or `codex mcp add …` if your
> Codex version has it.) Check with `/mcp` inside Codex.
>
> **Other MCP clients** — any client that speaks Streamable HTTP with JSON responses:
> URL above, optional bearer header.
>
> **Let the assistant set itself up** — put the token in an environment variable yourself
> (so it never appears in the chat), then paste this into Claude Code, Codex, or any coding
> agent that can edit its own MCP config:
>
> ```text
> Set up the MakerLab Tools MCP server for yourself.
> - Server URL: https://<your-deployment>/api/mcp  (Streamable HTTP, JSON responses)
> - Auth: bearer token, read from the environment variable MAKERLAB_MCP_TOKEN.
>   Never print, echo, or write the token's value into any file or message — reference the
>   variable by name only. If the variable is unset, stop and tell me to set it.
> - Use your own supported way to add a remote MCP server (for example `claude mcp add
>   --transport http …` for Claude Code, or an `[mcp_servers.makerlab]` entry with
>   `bearer_token_env_var` in ~/.codex/config.toml for Codex). Name it "makerlab".
> - Then verify: list the server's tools and call `search_tools` with the query "laser".
>   Report which tools you can see (they depend on my role) and the first result.
> - Don't change any other MCP server or setting.
> ```
>
> For read-only browsing with no account, drop the auth lines — the public tools need none.
>
> **What you can do** — a table of tools by role (§3.2), with example prompts.
>
> **Keeping it safe** — tokens act as you; name them per device, prefer read-only, revoke from
> the same page if a laptop is lost. Admin changes made through an assistant arrive as
> proposals you accept in the app.
>
> **Troubleshooting** — 401 unknown/revoked/expired token; 429 slow down; a tool missing from
> the list means your role doesn't allow it.

Every command and menu path in the guide is checked against the live clients before it
merges. §7 above is a draft of the shape, not verified instructions.

## 8. Security and safety

- **Authentication.**
  - Tokens are hashed at rest and shown once.
  - Only the prefix ever appears in logs or the UI.
  - OAuth uses Better Auth's flow, with PKCE required.
- **Authorization.**
  - `can()` decides every tool and every call, even when the tool is listed, because the role
    can change mid-session.
  - Read-only tokens can't call `kind: "write"` tools.
- **Write safety (Article 5).**
  - No MCP tool publishes, archives, deletes or edits catalogue fields.
  - `create_tool` makes drafts, and `propose_change` makes proposals.
  - `update_ticket` is the one direct write, through the admin page's own path.
- **PII.**
  - The maintenance history fix (§3.2): anonymous and user callers never see reporter names
    or emails.
  - `list_my_reports` returns only the caller's own reports.
- **Rate limiting** as in §5.2, checked before any database or model work (Article 4).
- **Leaked tokens:** revocable in one click, limited to one person's role, and unable to
  rewrite the catalogue. Expiry defaults to 90 days.

## 9. Phased build order

| # | Phase | Delivers |
|---|---|---|
| **0** | Check | Confirm the `better-auth` `mcp` plugin's API and spec compatibility; confirm the Claude Code / Desktop / claude.ai / ChatGPT / Codex connector steps for the guide, including whether ChatGPT custom connectors accept a static bearer header (assumed not: OAuth or none) and Codex's `bearer_token_env_var` key |
| **1** | Public hardening | Maintenance history without names for public/user callers; tool listing filtered by identity; `MCP_TOKEN` deprecation path |
| **2** | Personal tokens | `api_tokens` + migration; bearer branch in `resolveIdentity`; `/account/tokens`; role-scoped tools (`list_my_reports`, `list_intake_queue`, `list_open_tickets`, `update_ticket`, admin draft visibility); audit events; **`docs/mcp.md`** |
| **3** | OAuth | Better Auth `mcp` plugin, discovery endpoints, consent page, Connected apps |
| **4** | Proposals over MCP | `propose_change`, once refresh-research Phase 1 exists |

Phases 1–2 are the useful core; 3 and 4 can wait.

## 10. Testing

- **Unit:**
  - token generation, hashing and prefix;
  - expiry and revocation checks;
  - identity resolution for token, OAuth, none, bad, revoked, expired and banned users;
  - tool filtering by role and read-only;
  - maintenance history field filtering by role.
- **Integration** (PGlite, route tests):
  - `tools/list` per identity;
  - a user's `report_issue` records their verified name;
  - admin tools refused for users even if called directly;
  - `update_ticket` writes through `runQueueWrite`;
  - rate limits per identity;
  - `MCP_TOKEN` deprecation behaviour;
  - no token value appears in any log line (spy on console).
- **Component:** the token page (create, reveal once, revoke, read-only toggle).
- **E2E:** create a token in the UI, call `/api/mcp` with it (`tools/list` shows user tools,
  `report_issue` files with the right name), revoke it, and the next call is a 401.

**Cases that would embarrass us in production:**
- An anonymous MCP caller reads who reported which broken machine.
- A read-only token files a ticket.
- A demoted admin's token keeps updating tickets.
- A token shows up in Vercel logs.
- An agent rewrites a published tool's safety field over MCP.

## 11. Open questions

| # | Question | Recommendation | Who |
|---|---|---|---|
| 1 | Allow queueing research over MCP for admins? | Not now: it spends money, and the app button is deliberate | Isaac |
| 2 | Default token expiry | 90 days, with "never" available but not preselected | Isaac |
| 3 | Should anonymous MCP be on in production at all? | Yes: it's the same data as the public site, rate-limited | Isaac |
| 4 | List the MCP endpoint on the About page? | Yes, with a link to `docs/mcp.md` | Isaac |

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited.

### 2026-09-24 — Phases 0–4 built: public reads, personal tokens, OAuth sign-in, proposals over MCP

**Status.** Built on `v5/mcp-access` (off `main` at `2fcc42f`): all five phases of §9. No new
package: `@modelcontextprotocol/sdk` 1.29 and `better-auth` 1.6.25 (whose `mcp` plugin is used)
were already installed. **Not built:** the §10 E2E scenario — the route, OAuth and component
tests cover the same path offline (token created, `tools/list`, `report_issue` under the
verified name, revoked token → 401), and the live check below ran it against `next dev`.
The guide's claude.ai, Claude Desktop and ChatGPT menu paths are not verified against the
live clients (§7's own caveat); the Claude Code and Codex commands were checked against the
installed CLIs' `--help` (`claude mcp add --transport http … --header`, `codex mcp add … --url
… --bearer-token-env-var`).

**Phase 0 findings.** Better Auth 1.6.25's `mcp` plugin exposes dynamic client registration
(`/api/auth/mcp/register`), `/mcp/authorize` (PKCE S256, `requirePKCE` honoured), `/mcp/token`,
`getMcpSession`, and the two discovery documents under `/api/auth/.well-known/…`. It stores
access and refresh tokens as issued (not hashed). It shows a consent page **only when the
client sends `prompt=consent`**. `oidc-provider` was not needed.

**As built, and where it differs from the text above** (open choices took the simplest option
consistent with the spec):

- **Bearer tokens are honoured on the MCP route only** (§3.1 said `resolveIdentity` gains a
  bearer branch). `resolveMcpCaller` (`src/lib/auth/mcp-caller.ts`) is the MCP route's resolver;
  `resolveIdentity`, which every other route uses, still reads only the session cookie. A token
  is made for an MCP client, and honouring it on `/api/chat`, uploads or the research route would
  let a leaked read-only token spend money and carry permissions onto surfaces its owner never
  connected. On `/api/mcp` a cookie is never consulted at all. The ban/floor/domain rules are one
  function, `evaluateUser`, shared with the session path.
- **OAuth tokens are looked up in the plugin's table directly** (`findOAuthAccessToken`) rather
  than through `getMcpSession`, which answers null for expired and unknown alike; the route has
  to say which (§3.1). Refusal reasons: `unknown token`, `token revoked`, `token expired`,
  `account suspended` (401, JSON-RPC `-32001`, `WWW-Authenticate: Bearer error="invalid_token",
  …, resource_metadata=…`); a database that cannot be reached is 503.
- **A second URL for sign-in: `/api/mcp/signed-in`.** An OAuth client starts sign-in when the
  server answers 401 with `WWW-Authenticate`; on `/api/mcp` anonymous access succeeds, so it would
  never be asked. `/api/mcp/signed-in` is the same server but answers an anonymous caller 401 +
  `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp/signed-in"`.
  The guide gives claude.ai and ChatGPT that URL.
- **Discovery at the origin.** `/.well-known/oauth-authorization-server` re-serves the plugin's
  metadata; `/.well-known/oauth-protected-resource[/api/mcp[/signed-in]]` is ours
  (`src/lib/mcp/discovery.ts`), naming the origin as the authorization server and adding the
  `read_only` scope.
- **Consent is forced.** Registration is open (DCR), so without consent any page could walk a
  signed-in browser through `/mcp/authorize` to its own redirect URI. The auth route
  (`forceConsent` in `app/api/auth/[...all]/route.ts`) redirects any `/mcp/authorize` without
  `consent` in `prompt` back to itself with it added. The login page is `/oauth/sign-in` (Google
  sign-in, then back to the same authorization); the consent page is `/oauth/consent`.
- **Read-only on the consent page is a scope.** Choosing it adds `read_only` to the pending
  authorization before it is accepted (`lib/account/oauth-consent.ts`), so every access token the
  grant issues carries it; `resolveMcpCaller` reads it as a read-only caller. A consent code can
  only be answered by the person it was issued to. An accepted grant is audited
  `token.created` with `detail.kind: "oauth"`; disconnecting is `token.revoked`, `kind: "oauth"`
  (subject type `oauth_client`, subject id the client id). Tokens: subject type `api_token`,
  detail `{ kind: "token", name, prefix, readOnly, expiresAt }` — never the token.
- **§4.1 migration `0014_mcp_access`** holds `api_tokens` as specified and the plugin's
  `oauth_application`, `oauth_access_token`, `oauth_consent` (property keys are Better Auth's
  field names; descriptive columns nullable because DCR may omit them). No CHECK is added for
  `audit_events.action` (there never was one); `AUDIT_ACTIONS` gains the two actions.
- **Token details.** Default expiry 90 days (30 / 90 / never, never not preselected — open
  question 2); names ≤ 80 characters; at most 20 live tokens per person (`too_many_tokens`);
  `last_used_at` moves at most once a minute, by a conditional `UPDATE`. Revoking stamps
  `revoked_at` (the row stays, so the list and the audit subject keep meaning something).
- **Tool gating** is `mcpToolAllowed` (`capabilities/mcp-access.ts`): the capability's and the
  tool's own `requiredPermission` through `can()`, plus two MCP rules — every `kind: "write"` tool
  (and `requiresSignIn`, new, for `list_my_reports`) needs a signed-in caller, and a read-only
  credential gets no writes. `CapabilityTool` gains `requiredPermission?` and `requiresSignIn?`;
  `capabilitiesForIdentity` honours the tool-level permission for the chat too. The server is
  built per request, and the handler asks again before running.
- **The new tools** are two MCP-only capabilities: `reports` (`list_my_reports`) and `staff`
  (`list_intake_queue` · `tools.approve`, `list_open_tickets` / `update_ticket` ·
  `maintenance.manage`, `propose_change` · `tools.edit`). `list_open_tickets` carries reporter
  **names, not emails** — emails never enter a model's context. `update_ticket` takes
  `assign_to: "me" | "nobody"` rather than an arbitrary user id, and goes through
  `writeTicket` (`lib/admin/ticket-write.ts`), now the admin page's own path too, via
  `runQueueWrite` with the resolved identity (`authorizeAdminAction` accepts one).
- **`propose_change` over MCP (Phase 4)** proposes changes to **tools only** (not pending items,
  which need `tools.approve` per subject), stores a `chat_proposals` row with `chat_id = "mcp"`,
  and shares validation with the chat's tool (`proposeChange` in `capabilities/curation.ts`;
  PPE refused). Its quotes are stored **unverified** — the server cannot see what the client
  read. Open ones appear on `/admin/refresh` under **Proposals from assistants**, as the chat's
  proposal cards, decided through `POST /api/chat-proposals`.
- **Admin draft visibility.** For `tools.edit`, `list_tools` / `search_tools` /
  `get_tool_details` read every tool uncached (drafts and archived; `includeArchived` is new on
  the catalogue query) and mark each `state`. This applies in the chat too, since the tools are
  shared.
- **Maintenance names.** `recentMaintenance` adds `reported_by` only for `maintenance.manage`;
  today's MCP output never actually carried `reportedByName` (the helper already dropped it), so
  the "fix" is the test that pins it, plus names for staff.
- **`create_tool`** now records the caller as `created_by`.
- **Rate limits** (`ROUTE_TIERS`): `mcp` 30/min per hashed IP (anonymous and the legacy token),
  `mcpSignedIn` 60/min keyed `token:<id>` for a personal token or `user:<id>` for OAuth,
  `mcpWrite` 10/min per identity checked before each write call, and `account` 30/min for the
  token page's actions and the consent decision.
- **`MCP_TOKEN`** no longer gates the endpoint; a request bearing it resolves to the anonymous,
  read-only identity, with one deprecation warning per process and a notice on `/admin`
  (`.env.example` says so). Remove it next release.
- **UI.** `/account/tokens` is open to anyone (the address and public access need no account)
  and reached from the profile menu's **Connect an AI assistant**; signed in, it has the create
  form, the one-time reveal with Claude Code / Claude Desktop (`mcp-remote`) / Codex snippets
  reading `MAKERLAB_MCP_TOKEN`, the list with inline-confirmed Revoke, and **Connected apps**.
  Strings are `account.*` (English; other locales fall back). The About page lists the endpoint
  and links to `/account/tokens` (open question 4) — the app cannot link `docs/mcp.md` itself,
  which lives in the repository.
- **Backups** skip `oauth_access_token` whole and blank `oauth_application.client_secret`;
  `api_tokens` is kept (hashes only).

**Live check (2026-09-24, `next dev` on :3011, a scratch PGlite dir seeded with the demo data,
no Gateway).** SDK client: anonymous `initialize` → 6 tools, `search_tools("laser")` → Trotec
Speedy 400, maintenance history without the reporter; student token → 9 tools,
`list_my_reports`, `list_open_tickets` → "Tool not found"; admin token → 14 tools, reporter
name shown, open tickets, intake queue, `propose_change` stored, PPE refused; bad token → 401
with `WWW-Authenticate`; anonymous `/api/mcp/signed-in` → 401 pointing at the metadata; both
discovery documents served. MCP Inspector CLI (`--cli --transport http`): `tools/list` and
`tools/call search_tools` anonymous. `/account/tokens`, `/admin/refresh`, `/about`,
`/oauth/consent`, `/oauth/sign-in` rendered. No token appeared in the dev server log.

### 2026-09-24 — Sign in with Google is the default way to connect

**Why.** The text above (§5.1, §7) treats a personal access token as the usual path and OAuth
as a claude.ai and ChatGPT special case. But every client the guide names supports OAuth for
a remote HTTP MCP server. That includes Claude Code (`claude mcp add --transport http <name>
<url>`, then **Authenticate** from `/mcp`), Claude Desktop and claude.ai (custom connector),
ChatGPT (connector with OAuth) and Codex (`codex mcp add <name> --url <url>`, `codex mcp login
<name>`). Signing in leaves no secret to paste, store or leak, and it shows up under Connected
apps, where it can be revoked. `/api/mcp/signed-in` already signs people in with Google, so
this is a documentation and UI change. The server is unchanged.

**What changes.**

- **`/account/tokens` leads with "Sign in with Google (recommended)"** (`SignInSetup`, shown
  signed in or not). It has the sign-in address, then the steps for each client: Claude Code's
  command and the `/mcp` → Authenticate step, Codex's `mcp add` and `mcp login` commands,
  Claude Desktop and claude.ai's custom connector, and ChatGPT's OAuth connector. Next comes
  **Browse without an account** with the open address. **Personal access tokens** follow as
  the fallback, with a line saying when to use one: a client or script that can't sign in,
  such as Claude Desktop's config file through `mcp-remote`, a CI job or a script.
- **`mcpSnippets`** gains `claudeCodeSignIn`, `codexSignIn` and `codexLogin`. None of them
  carries a token. The token snippets are unchanged.
- **Token expiry** keeps its 90-day default, now labelled "In 90 days (one semester)". The
  options are unchanged.
- **`docs/mcp.md`** puts sign-in first for every client, with the token as the fallback under
  each. The self-setup prompt now adds the sign-in address and tells the person how to finish
  signing in, so no secret passes through a chat. The token variant is a note. "Keeping it
  safe" says to prefer signing in. Troubleshooting explains the expected 401 on
  `/api/mcp/signed-in`.
- **Strings.** `account.signIn.*` and `account.tokens.lede` are new. `account.lede`,
  `account.signedOut`, `account.endpointHeading` / `endpointBody`,
  `account.tokens.expiry90` and `about.mcpBody` are reworded. The unused
  `account.signedInEndpointLabel` / `signedInEndpointBody` are gone from English. All are
  English only, and other locales fall back.

**Verified.** The command shapes were checked against the installed CLIs' help output only.
`claude mcp add --help` shows `--transport http <name> <url>`, with OAuth options
`--client-id`, `--client-secret` and `--callback-port`. `codex mcp add --help` (codex-cli
0.156.1) shows `--url`, `--oauth-client-id`, `--oauth-client-registration auto|cimd|dcr` "for
the immediate login", and `--oauth-resource`. `codex mcp login --help` shows `<NAME>`,
`--scopes` and `--no-browser`. **Not verified:** no OAuth sign-in from Claude Code or Codex
has been run against a deployment. The server's side (DCR, PKCE S256, discovery, forced
consent) is as the amendment above describes. The claude.ai, Claude Desktop and ChatGPT menu
paths are still unverified against the live clients (§7's caveat).

**Tests.** `mcp-snippets.test.ts` covers the sign-in commands, which carry no token, and the
token fallback, which reads the environment. `SignInSetup.test.tsx` covers the section and
each client's steps. `TokenManager.test.tsx` covers the 90-day default labelled one semester.

### 2026-09-25 — A public `/mcp` page: the server, its tools, and a way to try them

**Why.** The owner asked (2026-09-25) for a page to look at the MCP server. Today the
addresses and setup steps live on `/account/tokens`, a page named after tokens, and the only
list of tools is the hand-written table in `docs/mcp.md`, which lives in the repository and
can drift from the registry. Nobody can see what the server offers, or try it, without
installing a client.

**What is built.** A public page at **`/mcp`**, no sign-in needed, in four sections:

1. **Header.** One or two plain sentences (connect Claude, ChatGPT, Codex or another MCP
   client to the lab's catalogue) and the two addresses, each with a Copy button and one line
   saying what it is for: `/api/mcp` (public, read-only, no sign-in) and `/api/mcp/signed-in`
   (sign in with Google, act as yourself). Both are **absolute URLs for the origin the page was
   requested on** (`x-forwarded-host` or `host`, and `x-forwarded-proto`), falling back to
   `authBaseUrl()` when the request names no host.
2. **Tools — generated, never hand-written.** `describeMcpTools(capabilities)`
   (`src/lib/capabilities/mcp-catalog.ts`, pure) walks the **same `CAPABILITIES` array the
   route registers** and returns, per tool: name, description, a summary of its input schema
   (field name, type, required, description, enum values — from Zod's own `toJSONSchema`),
   `read` or `write`, and its **audience**: the least-privileged of anonymous → `user` →
   `admin` → `super_admin` that `mcpToolAllowed` admits, asked with a full-access (not
   read-only) credential. A `chatOnly` tool, or one no role reaches, is not listed. The page
   groups the tools **Anyone** / **Signed-in lab members** / **Staff**, and marks each tool the
   viewer's own session role would be offered — through the same `mcpToolAllowed` — **"You can
   use this"**. The marker describes the role; a read-only connection still gets no writes.
   A capability added to the registry appears on the page with no page change.
3. **Try it.** A small form for each tool that is `read` **and** admitted for an anonymous
   caller (today `list_tools`, `search_tools`, `get_tool_details`, `get_unit_details`,
   `get_maintenance_history`, `search_manual` — the list is derived, not written down), built
   from its input summary: text and number inputs, enums as selects. Submitting calls a server
   action, `runMcpTryIt` (`src/app/mcp/actions.ts`), which:
   - accepts only a tool name in that derived list — anything else, every write included, is
     refused `not_runnable` before any call (the page's own list is never trusted);
   - accepts only a flat object of strings, numbers and booleans, at most 2,000 characters as
     JSON (`invalid_input` otherwise);
   - builds a JSON-RPC `tools/call` **`Request` to `/api/mcp` carrying only `content-type`,
     `accept` and the visitor's forwarded-IP headers — never a cookie, never `Authorization`** —
     and hands it to `handleMcpRequest`, the route's own function. The caller is therefore
     anonymous by construction, whoever is signed in to the page: public manuals only, no
     reporter names, no drafts, no staff tools;
   - is rate-limited by that handler's anonymous `mcp` tier (30 a minute per IP), the same
     bucket as calling `/api/mcp` directly, so the page is no way around the limit.
   The page shows the HTTP status, the time the call took on the server, the tool's result
   (its JSON text parsed and pretty-printed when it is JSON) and the raw JSON-RPC response,
   each in a collapsible block. A 429 says to wait. Write tools are never runnable from the
   page; they are listed with their inputs only.
4. **Connect.** `SignInSetup` (sign in with Google first) moves here from `/account/tokens`,
   with a closing paragraph for clients that cannot sign in: personal access tokens, linking
   to `/account/tokens`. **`/account/tokens` keeps token management** — the create form, the
   one-time reveal with its token snippets, the list, Connected apps and "Keeping it safe" —
   and links to `/mcp` for the addresses, the setup steps and the tool list. The profile menu's
   **Connect an AI assistant** still opens `/account/tokens`, because the OAuth consent page
   sends people there to disconnect an app.

**Links.** The About page's assistant section links to `/mcp` (was `/account/tokens`);
`/account/tokens` links to it. Not in the primary nav (it is a reference page, not a daily
destination), and the app has no footer and no sitemap to add it to. Page metadata: title
"MCP server — <site name>".

**Strings.** `mcpPage.*`, English only; other locales fall back (Article 6).
`account.endpointHeading` / `endpointBody` move out with the section they labelled.

**Tests.** `mcp-catalog.test.ts`: the listing is the registry (a capability added to the array
appears, a `chatOnly` tool does not), audiences per role (the six public reads are Anyone,
`report_issue` / `report_correction` / `list_my_reports` are Signed-in, the staff tools and
`create_tool` are Staff), the viewer marker per role, input summaries (required, enums), and
the Try-it list is exactly the anonymous reads. `actions.test.ts` (PGlite, the real handler):
a run with an admin's session cookie in the request headers still answers as anonymous (no
draft, no private manual passage, no reporter name), a staff or write tool is `not_runnable`,
malformed arguments are `invalid_input`, and the 31st call in a minute from one IP is a 429.
Component tests for the header, the grouped tool list with markers, the Try-it form (fields
from the schema, enum select, result and timing shown) and the Connect section.
