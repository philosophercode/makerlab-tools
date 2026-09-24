import { mcpSnippets, TOKEN_PLACEHOLDER } from "./mcp-snippets";

/**
 * The setup snippets (MCP access spec §5.1, amendment 2026-09-24): sign-in
 * snippets carry no token at all; token snippets read it from the environment.
 * The command shapes match `claude mcp add --help` and `codex mcp add --help`.
 */

describe("mcpSnippets", () => {
  const s = mcpSnippets("https://tools.example.edu/");

  it("gives the two addresses, the trailing slash dropped", () => {
    expect(s.url).toBe("https://tools.example.edu/api/mcp");
    expect(s.signedInUrl).toBe("https://tools.example.edu/api/mcp/signed-in");
  });

  it("signs Claude Code and Codex in with the sign-in address and no token", () => {
    expect(s.claudeCodeSignIn).toBe("claude mcp add --transport http makerlab https://tools.example.edu/api/mcp/signed-in");
    expect(s.codexSignIn).toBe("codex mcp add makerlab --url https://tools.example.edu/api/mcp/signed-in");
    expect(s.codexLogin).toBe("codex mcp login makerlab");
    for (const snippet of [s.claudeCodeSignIn, s.codexSignIn, s.codexLogin]) {
      expect(snippet).not.toMatch(/Bearer|mlt_|MAKERLAB_MCP_TOKEN/);
    }
  });

  it("keeps the token fallback reading the environment", () => {
    expect(s.claudeCode).toContain('--header "Authorization: Bearer $MAKERLAB_MCP_TOKEN"');
    expect(s.codexCommand).toBe("codex mcp add makerlab --url https://tools.example.edu/api/mcp --bearer-token-env-var MAKERLAB_MCP_TOKEN");
    expect(s.envExport).toBe(`export MAKERLAB_MCP_TOKEN=${TOKEN_PLACEHOLDER}`);
  });
});
