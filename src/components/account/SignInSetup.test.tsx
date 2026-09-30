import { render, screen, userEvent } from "../../../test/utils/render";
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
  // No token anywhere: the only "Bearer" is the prompt's reference to the variable.
  expect(document.body.textContent).not.toMatch(/mlt_|Bearer (?!\$MAKERLAB_MCP_TOKEN)/);
});

it("offers a setup prompt for the student's AI: sign-in address first, a token only from the environment", async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<SignInSetup snippets={mcpSnippets("https://tools.example.edu")} />);

  expect(screen.getByRole("heading", { name: "Copy setup prompt for your AI" })).toBeInTheDocument();
  const prompt = screen.getByLabelText("setup prompt").textContent ?? "";
  const signIn = prompt.indexOf("https://tools.example.edu/api/mcp/signed-in");
  const fallback = prompt.indexOf("MAKERLAB_MCP_TOKEN");
  expect(signIn).toBeGreaterThan(-1);
  expect(fallback).toBeGreaterThan(signIn);
  expect(prompt).toContain("Never ask me to paste the token into this chat");
  expect(prompt).not.toMatch(/mlt_/);

  await userEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));
  expect(writeText).toHaveBeenCalledWith(prompt);
  expect(await screen.findByText("setup prompt copied to the clipboard.")).toBeInTheDocument();
});
