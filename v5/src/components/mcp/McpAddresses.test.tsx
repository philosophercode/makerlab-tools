import { render, screen } from "../../../test/utils/render";
import { mcpSnippets } from "../../lib/account/mcp-snippets";
import { McpAddresses } from "./McpAddresses";
import { McpConnect } from "./McpConnect";

/**
 * The header addresses and the Connect section on `/mcp` (MCP access spec,
 * amendment 2026-09-25).
 */

const snippets = mcpSnippets("https://tools.example.edu");

describe("McpAddresses", () => {
  it("shows both addresses, absolute, each with a Copy button and what it is for", () => {
    render(<McpAddresses publicUrl={snippets.url} signedInUrl={snippets.signedInUrl} />);
    expect(screen.getByRole("heading", { name: "Server addresses" })).toBeInTheDocument();
    expect(screen.getByLabelText("Public address (no sign-in)")).toHaveTextContent("https://tools.example.edu/api/mcp");
    expect(screen.getByLabelText("Sign-in address (sign in with Google)")).toHaveTextContent(
      "https://tools.example.edu/api/mcp/signed-in"
    );
    expect(screen.getByRole("button", { name: "Copy Public address (no sign-in)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Sign-in address (sign in with Google)" })).toBeInTheDocument();
    expect(screen.getByText(/Read-only and open to anyone/)).toBeInTheDocument();
  });
});

describe("McpConnect", () => {
  it("leads with sign-in setup and points token users at /account/tokens", () => {
    render(<McpConnect snippets={snippets} />);
    expect(screen.getByRole("heading", { name: "Sign in with Google (recommended)" })).toBeInTheDocument();
    expect(screen.getByLabelText("MCP address for sign-in")).toHaveTextContent("https://tools.example.edu/api/mcp/signed-in");
    expect(screen.getByRole("heading", { name: "Clients that can't sign in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage personal access tokens" })).toHaveAttribute("href", "/account/tokens");
    // No token anywhere on the public page.
    expect(document.body.textContent).not.toMatch(/mlt_|Bearer (?!\$MAKERLAB_MCP_TOKEN)/);
    // The Connect section carries the setup prompt for the student's own AI.
    expect(screen.getByRole("button", { name: "Copy setup prompt" })).toBeInTheDocument();
  });
});
