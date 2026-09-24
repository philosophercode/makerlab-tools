# Connect an AI assistant to MakerLab Tools

MakerLab's inventory is available to AI assistants over MCP (the Model Context
Protocol) at:

```text
https://<your-deployment>/api/mcp
```

It is a remote MCP server speaking **Streamable HTTP with JSON responses**
(stateless — no SSE stream, no session). Everything below works with any client
that speaks that.

In the app, the same instructions — with your own address filled in — are on
**profile menu → Connect an AI assistant** (`/account/tokens`).

## Just browsing? No account needed

Add the address above as an MCP server and ask things like *"Which laser cutters
are available?"* or *"What does the Form 4 manual say about replacing the resin
tank?"* Without signing in you get the public, read-only tools: tools, units,
availability, maintenance history (dates, status and summaries — never who
reported what) and the public manuals.

## Acting as yourself

To file reports, list your own reports, or — if you are lab staff — use the
staff tools, the assistant has to act as you. There are two ways:

- **A personal access token** (Claude Code, Claude Desktop, Codex, most
  clients): profile menu → **Connect an AI assistant** → **New token**. Name it
  after the device, choose when it expires (30 days, 90 days or never), and tick
  **Read-only** if the assistant only needs to look things up. Copy the token
  (`mlt_…`) — it is shown once.
- **Sign in with MakerLab** (claude.ai and ChatGPT connectors, which sign in with
  OAuth instead of a pasted header): use the sign-in address

  ```text
  https://<your-deployment>/api/mcp/signed-in
  ```

  The client sends you to MakerLab to sign in with Google, then to a consent page
  ("*Claude* wants to access MakerLab Tools as you") where you can also choose
  read-only.

Either way the assistant gets exactly your role's permissions and never more.
Put the token in an environment variable rather than in a file or a chat:

```bash
export MAKERLAB_MCP_TOKEN=mlt_…   # in your shell profile
```

## Claude Code

```bash
claude mcp add --transport http makerlab https://<your-deployment>/api/mcp \
  --header "Authorization: Bearer $MAKERLAB_MCP_TOKEN"
```

Your shell expands the variable when you run the command, so Claude Code's own
config stores the token. To keep it out of every file, use a project
`.mcp.json` instead — Claude Code expands `${VAR}` when it starts the server:

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

Run `/mcp` inside Claude Code to check it's connected. For browsing only, drop
the `--header` (or the `headers` entry).

## Claude Desktop

Claude Desktop's **Settings → Connectors → Add custom connector** takes a URL
and signs in with OAuth: give it the sign-in address
(`https://<your-deployment>/api/mcp/signed-in`), or the open address for
browsing only.

To use a personal access token instead, add the server to
`claude_desktop_config.json` through the `mcp-remote` bridge (Node required):

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
sign in with Google and approve the connection; no token needed. For browsing
only, paste `https://<your-deployment>/api/mcp` instead.

## ChatGPT

**Settings → Connectors** → create a custom connector with the MCP address
(custom MCP connectors sit behind ChatGPT's developer-mode / connector settings,
depending on plan). ChatGPT connectors authenticate with OAuth or not at all —
not with a pasted header — so:

- **No authentication**, address `https://<your-deployment>/api/mcp`: the
  public, read-only tools.
- **OAuth**, address `https://<your-deployment>/api/mcp/signed-in`: sign in with
  MakerLab and approve; the connector then has your role's tools.

## Codex (CLI / IDE)

Add a streamable-HTTP server that reads the token from the environment:

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

Then `export MAKERLAB_MCP_TOKEN=mlt_…` in your shell profile, and check with
`/mcp` inside Codex.

## Other MCP clients

Any client that speaks Streamable HTTP with JSON responses: the address above,
and optionally the header `Authorization: Bearer mlt_…`. OAuth-capable clients
can use the sign-in address; its discovery documents are at
`/.well-known/oauth-protected-resource/api/mcp/signed-in` and
`/.well-known/oauth-authorization-server` (dynamic client registration, PKCE
with S256).

## Let the assistant set itself up

Put the token in an environment variable yourself (so it never appears in the
chat), then paste this into Claude Code, Codex, or any coding agent that can edit
its own MCP config:

```text
Set up the MakerLab Tools MCP server for yourself.
- Server URL: https://<your-deployment>/api/mcp  (Streamable HTTP, JSON responses)
- Auth: bearer token, read from the environment variable MAKERLAB_MCP_TOKEN.
  Never print, echo, or write the token's value into any file or message — reference the
  variable by name only. If the variable is unset, stop and tell me to set it.
- Use your own supported way to add a remote MCP server (for example a project
  .mcp.json entry whose Authorization header is "Bearer ${MAKERLAB_MCP_TOKEN}" for
  Claude Code, or `codex mcp add makerlab --url … --bearer-token-env-var MAKERLAB_MCP_TOKEN`
  for Codex). Name it "makerlab".
- Then verify: list the server's tools and call `search_tools` with the query "laser".
  Report which tools you can see (they depend on my role) and the first result.
- Don't change any other MCP server or setting.
```

For read-only browsing with no account, drop the auth lines — the public tools
need none.

## What you can do

The tools an assistant is offered are exactly the ones your identity may use; a
tool your role doesn't allow is not listed at all.

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

A read-only token or connection gets the reads in its column and none of the
tools that file or change anything.

## Keeping it safe

- A token acts as you. Make one per device, prefer read-only, and revoke it from
  the same page if a laptop is lost; connected apps (claude.ai, ChatGPT) are
  listed there too and disconnect the same way.
- Tokens are stored only as a hash and never appear in logs; the page shows the
  first eight characters (`mlt_ab12cd34…`) so you can tell them apart.
- Nothing an assistant does publishes, archives or edits the catalogue. New
  tools are drafts; catalogue changes are **proposals** a person accepts in the
  app (under "Proposals from assistants" on the refresh review page). Working a
  maintenance ticket is the one direct change, and only for staff.

## Troubleshooting

- **401 "unknown token" / "token revoked" / "token expired"** — create a new
  token (or, for a connector, sign in again). A bad token is refused, never
  treated as anonymous.
- **401 "account suspended"** — the account behind the token is banned.
- **401 from `/api/mcp/signed-in` with no token** — expected: that address is for
  clients that sign in. Use `/api/mcp` to browse without an account.
- **429 "Too many requests"** — slow down: 30 requests a minute without an
  account, 60 a minute per token or connection, and 10 reports or changes a
  minute per person.
- **A tool is missing from the list** — your role (or a read-only token)
  doesn't allow it.
