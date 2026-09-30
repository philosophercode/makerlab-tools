/**
 * Ready-to-paste MCP client configuration (MCP access spec §5.1 step 3, §7).
 *
 * **Sign in with Google is the default** (amendment 2026-09-24): every client
 * that supports OAuth for a remote HTTP server gets the sign-in address and no
 * token. The token snippets are the fallback, for clients or scripts that
 * cannot sign in.
 *
 * Pure and client-safe: `/account/tokens` renders these with the token it just
 * revealed, or with a placeholder, and `docs/mcp.md` carries the same shapes.
 * Every snippet that can reads the token from the `MAKERLAB_MCP_TOKEN`
 * environment variable rather than holding it, so the token stays out of
 * config files and chat transcripts.
 */

/** The environment variable the guide and the self-setup prompt use. */
export const MCP_TOKEN_ENV_VAR = "MAKERLAB_MCP_TOKEN";

/** What the page shows before a token exists. */
export const TOKEN_PLACEHOLDER = "mlt_…";

export interface McpSnippets {
  /** The open endpoint: public reads, or a person's tools with a bearer token. */
  url: string;
  /** The OAuth endpoint: every client that can sign in with Google — the default way to connect. */
  signedInUrl: string;
  /** Claude Code, signing in (then `/mcp` → Authenticate). No token. */
  claudeCodeSignIn: string;
  /** Codex, signing in: adding the server starts the sign-in. No token. */
  codexSignIn: string;
  /** Codex: sign in again later. */
  codexLogin: string;
  /** `export MAKERLAB_MCP_TOKEN=…` for a shell profile. */
  envExport: string;
  /** Claude Code, token from the environment at add time. */
  claudeCode: string;
  /** Claude Code project `.mcp.json`, expanded from the environment at run time. */
  claudeCodeJson: string;
  /** Claude Desktop `claude_desktop_config.json`, through the `mcp-remote` bridge. */
  claudeDesktop: string;
  /** Codex `~/.codex/config.toml`. */
  codexToml: string;
  /** Codex's own command for the same. */
  codexCommand: string;
}

export function mcpSnippets(baseUrl: string, token: string = TOKEN_PLACEHOLDER): McpSnippets {
  const origin = baseUrl.replace(/\/+$/, "");
  const url = `${origin}/api/mcp`;
  const signedInUrl = `${origin}/api/mcp/signed-in`;
  return {
    url,
    signedInUrl,
    claudeCodeSignIn: `claude mcp add --transport http makerlab ${signedInUrl}`,
    codexSignIn: `codex mcp add makerlab --url ${signedInUrl}`,
    codexLogin: "codex mcp login makerlab",
    envExport: `export ${MCP_TOKEN_ENV_VAR}=${token}`,
    claudeCode: `claude mcp add --transport http makerlab ${url} --header "Authorization: Bearer $${MCP_TOKEN_ENV_VAR}"`,
    claudeCodeJson: JSON.stringify(
      {
        mcpServers: {
          makerlab: { type: "http", url, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}` } },
        },
      },
      null,
      2
    ),
    claudeDesktop: JSON.stringify(
      {
        mcpServers: {
          makerlab: {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--header", "Authorization:${MAKERLAB_AUTH_HEADER}"],
            env: { MAKERLAB_AUTH_HEADER: `Bearer ${token}` },
          },
        },
      },
      null,
      2
    ),
    codexToml: `[mcp_servers.makerlab]\nurl = "${url}"\nbearer_token_env_var = "${MCP_TOKEN_ENV_VAR}"`,
    codexCommand: `codex mcp add makerlab --url ${url} --bearer-token-env-var ${MCP_TOKEN_ENV_VAR}`,
  };
}
