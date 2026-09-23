# MCP Access: Public Reads, Personal Tokens, Sign-in — Design Spec

**Date:** 2026-09-23
**Status:** Draft
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
