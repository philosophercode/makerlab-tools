# Connect an AI assistant to MakerLab Tools

MakerLab's inventory is available to AI assistants over MCP (the Model Context
Protocol) at:

```text
https://<your-deployment>/api/mcp
```

It is a remote MCP server speaking **Streamable HTTP with JSON responses**
(stateless — no SSE stream, no session). Everything below works with any client
that speaks that.

In the app, the **MCP server page, `/mcp`** (linked from the About page), has
the same instructions with your own addresses filled in, every tool the server
offers — generated from the server's own tool definitions and grouped by who may
use them — and a **Try it** form that runs the public, read-only tools right
there, as an anonymous caller, so you can see what an assistant would get back.
Personal access tokens and connected apps are managed on **profile menu →
Connect an AI assistant** (`/account/tokens`).

## Just browsing? No account needed

Add the address above as an MCP server and ask things like *"Which laser cutters
are available?"* or *"What does the Form 4 manual say about replacing the resin
tank?"* Without signing in you get the public, read-only tools: tools, units,
availability, maintenance history (dates, status and summaries — never who
reported what) and the public manuals.

## Acting as yourself: sign in with Google

To file reports, list your own reports, or (if you are lab staff) use the staff
tools, the assistant has to act as you. **The default way is to sign in with
Google.** Every client below supports it, and there's no token to copy or keep
safe. Give the client the **sign-in address**:

```text
https://<your-deployment>/api/mcp/signed-in
```

The client sends you to MakerLab to sign in with Google, then to a consent page
("*Claude* wants to access MakerLab Tools as you") where you can also choose
**read-only**. The connection then appears under **Connected apps** on
**profile menu → Connect an AI assistant** (`/account/tokens`), where you can
disconnect it.

Either way the assistant gets exactly your role's permissions and never more.

### When to use a personal access token instead

A **personal access token** is the fallback for a client or script that can't
sign in with OAuth: Claude Desktop's `claude_desktop_config.json` through the
`mcp-remote` bridge, a CI job, your own script, or an older client. Get one from
**profile menu → Connect an AI assistant → New token**. Name it after the device
and tick **Read-only** if the assistant only needs to look things up. **Every
token expires 90 days after you make it (one semester)** — there is no choice
of expiry, and no token that never expires; the page shows the date before you
create it. Make a new one next term.

Copy the token (`mlt_…`) straight away. **Save it now: you won't be able to see
or copy it again after you leave the page** — the page says so above the token
and again beside **I've copied it**. Put it in an environment variable rather
than in a file or a chat:

```bash
export MAKERLAB_MCP_TOKEN=mlt_…   # in your shell profile
```

## Claude Code

**Sign in (recommended):**

```bash
claude mcp add --transport http makerlab https://<your-deployment>/api/mcp/signed-in
```

Then run `/mcp` inside Claude Code, choose **makerlab** and pick
**Authenticate**. Your browser opens to sign in with Google and approve.

**With a token (fallback):**

```bash
claude mcp add --transport http makerlab https://<your-deployment>/api/mcp \
  --header "Authorization: Bearer $MAKERLAB_MCP_TOKEN"
```

Your shell expands the variable when you run the command, so Claude Code's own
config stores the token. To keep it out of every file, use a project
`.mcp.json` instead. Claude Code expands `${VAR}` when it starts the server:

```json
{
  "mcpServers": {
    "makerlab": {
      "type": "http",
      "url": "https://<your-deployment>/api/mcp",
      "headers": { "Authorization": "Bearer ${MAKERLAB_MCP_TOKEN}" }
    }
  }
}
```

For browsing only, add `https://<your-deployment>/api/mcp` with no header.

## Claude Desktop

**Sign in (recommended):** **Settings → Connectors → Add custom connector**, and
paste the sign-in address `https://<your-deployment>/api/mcp/signed-in`. Claude
Desktop sends you to MakerLab to sign in and approve. For browsing only, paste
`https://<your-deployment>/api/mcp` instead.

**With a token (fallback):** add the server to `claude_desktop_config.json`
through the `mcp-remote` bridge (Node required):

```json
{
  "mcpServers": {
    "makerlab": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-deployment>/api/mcp", "--header", "Authorization:${MAKERLAB_AUTH_HEADER}"],
      "env": { "MAKERLAB_AUTH_HEADER": "Bearer mlt_…" }
    }
  }
}
```

Restart Claude Desktop after editing the file. *(Menu names change between
releases.)*

## claude.ai

**Settings → Connectors → Add custom connector**, and paste the sign-in address
`https://<your-deployment>/api/mcp/signed-in`. You'll be sent to MakerLab to
sign in with Google and approve the connection. No token needed, and claude.ai
has no way to use one. For browsing only, paste `https://<your-deployment>/api/mcp`
instead.

## ChatGPT

**Settings → Connectors**, then create a custom connector with the MCP address.
Custom MCP connectors are under ChatGPT's developer-mode or connector settings,
depending on your plan. ChatGPT connectors authenticate with OAuth or not at
all. They can't take a pasted header. So:

- **OAuth (recommended)**, address `https://<your-deployment>/api/mcp/signed-in`:
  sign in with MakerLab and approve. The connector then has your role's tools.
- **No authentication**, address `https://<your-deployment>/api/mcp`: the
  public, read-only tools.

## Codex (CLI / IDE)

**Sign in (recommended):**

```bash
codex mcp add makerlab --url https://<your-deployment>/api/mcp/signed-in
```

Codex signs in with OAuth when you add a server that asks for it. If your
browser doesn't open, or to sign in again later, run:

```bash
codex mcp login makerlab
```

Check with `/mcp` inside Codex. *(These commands are checked against
`codex mcp add --help` and `codex mcp login --help` from codex-cli 0.156. The
sign-in itself has not been run against a live deployment.)*

**With a token (fallback):** add a streamable-HTTP server that reads the token
from the environment:

```bash
codex mcp add makerlab --url https://<your-deployment>/api/mcp \
  --bearer-token-env-var MAKERLAB_MCP_TOKEN
```

or write the same into `~/.codex/config.toml` yourself:

```toml
[mcp_servers.makerlab]
url = "https://<your-deployment>/api/mcp"
bearer_token_env_var = "MAKERLAB_MCP_TOKEN"
```

Then `export MAKERLAB_MCP_TOKEN=mlt_…` in your shell profile.

## Other MCP clients

Any client that speaks Streamable HTTP with JSON responses. If it supports
OAuth, give it the sign-in address. Its discovery documents are at
`/.well-known/oauth-protected-resource/api/mcp/signed-in` and
`/.well-known/oauth-authorization-server` (dynamic client registration, PKCE
with S256). Otherwise use the open address, optionally with the header
`Authorization: Bearer mlt_…`.

## Let the assistant set itself up

The quickest way: open **`/mcp`** (or, right after creating a token, the
token's reveal on `/account/tokens`) and press **Copy setup prompt** under
**Copy setup prompt for your AI**. Paste it into Claude, ChatGPT or Codex. The
prompt carries the addresses for the deployment you are on and asks the
assistant to connect itself — or to tell you the exact steps if it can't:

- **On `/mcp`** it gives the **sign-in address first** (`/api/mcp/signed-in`,
  OAuth with Google, no token); only if the assistant cannot sign in does it
  fall back to the open address with `Authorization: Bearer
  $MAKERLAB_MCP_TOKEN`, **read from the `MAKERLAB_MCP_TOKEN` environment
  variable at run time**.
- **On the token reveal** it assumes you have just put the new token in
  `MAKERLAB_MCP_TOKEN` and gives the open address with that header.

Neither prompt ever contains a token, and both tell the assistant never to ask
you to paste one into the chat, and never to print it or write it into a file.

A longer version for a coding agent that edits its own MCP config — Claude Code,
Codex — uses sign-in too, so no secret passes through the chat:

```text
Set up the MakerLab Tools MCP server for yourself.
- Server URL: https://<your-deployment>/api/mcp/signed-in  (Streamable HTTP, JSON responses,
  OAuth sign-in with Google)
- Use your own supported way to add a remote HTTP MCP server with OAuth, named "makerlab"
  (for example `claude mcp add --transport http makerlab <url>` for Claude Code, or
  `codex mcp add makerlab --url <url>` for Codex). Don't add any token or header.
- Then tell me how to finish signing in (for Claude Code: run /mcp and choose Authenticate;
  for Codex: `codex mcp login makerlab` if the browser didn't open).
- Once I've signed in, verify: list the server's tools and call `search_tools` with the query
  "laser". Report which tools you can see (they depend on my role) and the first result.
- Don't change any other MCP server or setting.
```

For a client that can't sign in, use a token instead. Put it in
`MAKERLAB_MCP_TOKEN` yourself, so it never appears in the chat. Then tell the agent
to use the open address with the header `Authorization: Bearer ${MAKERLAB_MCP_TOKEN}`,
to reference the variable by name only, and never to print its value. For
read-only browsing with no account, use the open address and no auth at all.

## What you can do

The tools an assistant is offered are exactly the ones your identity may use; a
tool your role doesn't allow is not listed at all. The table below is a summary;
the `/mcp` page lists the tools as the server defines them, with their inputs,
and marks the ones your account can use.

| Tool | No account | Student | Staff (SuperMaker, Director) | Try asking |
|---|---|---|---|---|
| `list_tools`, `search_tools`, `get_tool_details` | ✓ | ✓ | ✓ (also drafts and archived tools, marked) | "What can cut acrylic?" |
| `get_unit_details` | ✓ | ✓ | ✓ | "Is Prusa #2 working?" |
| `get_maintenance_history` | ✓ (no names) | ✓ (no names) | ✓ (reporter names) | "Has the Trotec been repaired lately?" |
| `search_manual` | ✓ (public manuals) | ✓ (public manuals) | ✓ (staff SOPs too) | "How do I replace the Form 4 resin tank?" |
| `report_issue` | — | ✓ | ✓ | "Report that Prusa #1's nozzle is clogged" |
| `report_correction` | — | ✓ | ✓ | "The Trotec's bed size on its page is wrong" |
| `list_my_reports` | — | ✓ | ✓ | "What happened to the tickets I filed?" |
| `create_tool` | — | — | ✓ (draft only) | "Add a draft for our new drill press" |
| `list_intake_queue` | — | — | ✓ | "What's waiting in intake?" |
| `list_open_tickets` | — | — | ✓ | "What maintenance is open, worst first?" |
| `update_ticket` | — | — | ✓ | "Mark the Trotec focus ticket resolved" |
| `propose_change` | — | — | ✓ (a proposal) | "Propose a clearer description for the Form 4" |
| `list_corrections`, `list_project_queue`, `get_tool_units`, `list_imports` | — | — | ✓ | "Which units does the Prusa have?" |
| The proposing tools (below) | — | — | ✓ (proposals) | "Publish the Form 4", "Retire Prusa #3", "Approve the two researched drills" |

A read-only token or connection gets the reads in its column and none of the
tools that file or change anything.

### Changes are proposals you confirm in the app

Since the assistant–GUI parity work (2026-09-27) an assistant connected over MCP
can ask for most of what staff do by hand in `/admin`, but it **never makes the
change itself**. Each of these tools stores a **proposal** and answers
"nothing has changed yet":

| Area | Tools |
|---|---|
| Maintenance | `log_completed_maintenance` (work already done) |
| Corrections, projects | `set_correction_status`, `set_project_published` |
| Catalogue | `set_tool_published`, `mark_tool_reviewed`, `restore_tool` |
| Units and links | `add_unit`, `edit_unit`, `retire_unit`, `add_resource`, `edit_resource` |
| Intake | `approve_pending_items`, `add_pending_as_unit`, `rename_pending_item`, `edit_pending_items` |
| Imported lists | `edit_import_row`, `set_import_hints`, `merge_import_row`, `decide_import_suggestions` |

The proposal waits in **Assistant proposals** (`/admin/proposals`, in the admin
section bar) for **7 days**. Only you — the person the token or connection acts
as — see it there, and only you can press **Confirm**, signed in to the site.
The card shows exactly what will change, read from the database, not from the
assistant's words; confirming checks your permission and every rule again, as
the button on the page would. A token can never confirm anything: the confirm
button works with your browser session only.

At most 50 proposals from MCP wait at once (counted apart from the assistant in
the site, so a busy client never blocks it). The inbox does not yet say which
token or app made a proposal, and revoking a token does not withdraw what it
already proposed: if you revoke one you suspect, dismiss its cards in the inbox.

**Never over MCP**, whatever your role or scope: anything about people (roles,
titles, adding or removing someone, allowances), anything that cannot be undone
(archiving a tool, deleting a unit, removing a link, discarding an intake item,
disconnecting the Notion mirror), and anything that spends the research budget
(research, a different image, name suggestions, re-processing a manual,
refreshing research). Ask the assistant in the site for most of those — it puts
the same kind of card in front of you there.

**Never through any assistant**, in the site or over MCP, whatever your role
(owner decision 2026-09-27): making someone a super admin or changing a super
admin's role, granting research allowances, removing people, blocking or
unblocking addresses, and disconnecting the Notion mirror — use the People page
or the mirror page. Nor can an assistant read or set secrets or environment
variables, create tokens, deploy or change hosting, run SQL, restore backups or
push data, edit the audit trail, export people's email addresses or send emails
or messages: no such tool exists, and the server drops any tool named for that
work from every list.

`update_ticket` is the one tool that still changes something directly, as it
always has, so clients that already use it keep working.

What the assistant in the site itself can do, for everybody and for staff, is
in [`assistant.md`](assistant.md).

## Keeping it safe

- Prefer signing in. There is no secret to paste, store or leak, and every
  signed-in client is listed under **Connected apps**, where you can disconnect it.
- A token acts as you. Make one per device, prefer read-only, and revoke it from
  the same page if a laptop is lost.
- Tokens are stored only as a hash and never appear in logs; the page shows the
  first eight characters (`mlt_ab12cd34…`) so you can tell them apart.
- Nothing an assistant does publishes, archives or edits the catalogue. New
  tools are drafts; every other change is a **proposal** that waits for you in
  the app — field edits (`propose_change`) under "Proposals from assistants" on
  the Refresh page, everything else in **Assistant proposals**
  (`/admin/proposals`), where only you can confirm it. Working a maintenance
  ticket is the one direct change, and only for staff.
- A leaked token cannot add an admin, remove anyone or spend the research
  budget, even as a proposal: those tools are never offered over MCP. Nor can
  it reach a secret, a deployment, the database, the audit trail or anyone's
  email address: no assistant, in the site or over MCP, has a tool for any of
  those.

## Troubleshooting

- **401 "unknown token" / "token revoked" / "token expired"** — create a new
  token (or, for a connector, sign in again). A bad token is refused, never
  treated as anonymous.
- **401 "account suspended"** — the account behind the token is banned.
- **401 from `/api/mcp/signed-in` with no token**: this is expected. The 401 is
  what tells an OAuth client to start sign-in. If your client shows the error
  instead of opening a sign-in (in Claude Code, run `/mcp` and choose
  **Authenticate**; in Codex, run `codex mcp login makerlab`), it doesn't support
  OAuth. Use a personal access token with `/api/mcp` instead, or `/api/mcp` with
  no token to browse.
- **429 "Too many requests"** — slow down: 30 requests a minute without an
  account, 60 a minute per token or connection, and 10 reports or changes a
  minute per person.
- **A tool is missing from the list** — your role (or a read-only token)
  doesn't allow it.
