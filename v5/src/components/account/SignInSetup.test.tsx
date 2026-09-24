import { render, screen } from "../../../test/utils/render";
import { mcpSnippets } from "../../lib/account/mcp-snippets";
import { SignInSetup } from "./SignInSetup";

/**
 * "Sign in with Google" on `/account/tokens` (MCP access spec, amendment
 * 2026-09-24): the default way to connect, with steps for every client that
 * signs in, and no token anywhere.
 */

it("leads with the sign-in address and gives Claude Code and Codex their commands", () => {
  render(<SignInSetup snippets={mcpSnippets("https://tools.example.edu")} />);
  expect(screen.getByRole("heading", { name: "Sign in with Google (recommended)" })).toBeInTheDocument();
  expect(screen.getByLabelText("MCP address for sign-in")).toHaveTextContent("https://tools.example.edu/api/mcp/signed-in");
  expect(screen.getAllByLabelText("Claude Code")[0]).toHaveTextContent("claude mcp add --transport http makerlab https://tools.example.edu/api/mcp/signed-in");
  expect(screen.getByText(/run \/mcp in Claude Code/)).toBeInTheDocument();
  expect(screen.getAllByLabelText("Codex")[0]).toHaveTextContent("codex mcp add makerlab --url https://tools.example.edu/api/mcp/signed-in");
  expect(screen.getByLabelText("Codex sign-in")).toHaveTextContent("codex mcp login makerlab");
  expect(screen.getByRole("heading", { name: "Claude Desktop and claude.ai" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "ChatGPT" })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/mlt_|Bearer/);
});
