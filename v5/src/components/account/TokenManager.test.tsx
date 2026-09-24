import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import type { CreateTokenResult, RevokeResult } from "../../lib/account/token-actions";
import type { TokenRow } from "../../lib/account/token-rows";
import { TokenManager } from "./TokenManager";

/**
 * The token page's island (MCP access spec §5.1, §6, §10 "Component"): create,
 * reveal once, revoke with an inline confirmation, the read-only toggle. Who
 * may do any of it is `lib/account/token-actions.test.ts`.
 */

const TOKEN = `mlt_${"A".repeat(43)}`;

const EXISTING: TokenRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Old laptop",
  prefix: "oldoldol",
  readOnly: false,
  expiresAt: "2026-12-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

function setup(initialTokens: TokenRow[] = [EXISTING]) {
  const createAction = vi.fn(
    async (input: { name: string; expiry: string; readOnly: boolean }): Promise<CreateTokenResult> => ({
      ok: true,
      token: TOKEN,
      summary: {
        id: "22222222-2222-4222-8222-222222222222",
        name: input.name,
        prefix: "AAAAAAAA",
        readOnly: input.readOnly,
        expiresAt: new Date("2026-12-23T00:00:00Z"),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-09-24T00:00:00Z"),
      },
    })
  );
  const revokeAction = vi.fn(async (): Promise<RevokeResult> => ({ ok: true }));
  render(
    <TokenManager initialTokens={initialTokens} baseUrl="https://tools.example.edu" createAction={createAction} revokeAction={revokeAction} />
  );
  return { createAction, revokeAction };
}

describe("TokenManager", () => {
  it("lists tokens by name and prefix — never a whole token", () => {
    setup();
    const row = screen.getByText("Old laptop").closest("li")!;
    expect(within(row).getByText("mlt_oldoldol…")).toBeInTheDocument();
    expect(within(row).getByText("Never used", { exact: false })).toBeInTheDocument();
  });

  it("creates a token with the chosen expiry and read-only, and reveals it once with setup snippets", async () => {
    const user = userEvent.setup();
    const { createAction } = setup();

    await user.type(screen.getByLabelText("Name"), "Claude Code on my laptop");
    await user.selectOptions(screen.getByLabelText("Expires"), "30");
    await user.click(screen.getByRole("checkbox", { name: /read-only/i }));
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(createAction).toHaveBeenCalledWith({ name: "Claude Code on my laptop", expiry: "30", readOnly: true });
    const reveal = await screen.findByRole("heading", { name: /Your new token/ });
    const panel = reveal.closest("section")!;
    expect(within(panel).getByLabelText("Personal access token")).toHaveTextContent(TOKEN);
    expect(within(panel).getByText(/won't be shown again/)).toBeInTheDocument();
    expect(panel).toHaveTextContent("claude mcp add --transport http makerlab https://tools.example.edu/api/mcp");
    expect(panel).toHaveTextContent('bearer_token_env_var = "MAKERLAB_MCP_TOKEN"');
    expect(panel).toHaveTextContent(`export MAKERLAB_MCP_TOKEN=${TOKEN}`);

    // The new row is listed as read-only.
    const row = screen.getByText("Claude Code on my laptop").closest("li")!;
    expect(within(row).getByText("Read-only")).toBeInTheDocument();

    // Dismissed, it is gone for good: nothing on the page holds it any more.
    await user.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("revokes only after an inline confirmation", async () => {
    const user = userEvent.setup();
    const { revokeAction } = setup();

    await user.click(screen.getByRole("button", { name: "Revoke Old laptop" }));
    expect(revokeAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Anything using it stops working at once/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, revoke" }));
    expect(revokeAction).toHaveBeenCalledWith(EXISTING.id);
    await waitFor(() => expect(within(screen.getByText("Old laptop").closest("li")!).getByText("Revoked")).toBeInTheDocument());
  });

  it("can back out of a revoke", async () => {
    const user = userEvent.setup();
    const { revokeAction } = setup();
    await user.click(screen.getByRole("button", { name: "Revoke Old laptop" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(revokeAction).not.toHaveBeenCalled();
  });

  it("says why a create was refused", async () => {
    const user = userEvent.setup();
    const createAction = vi.fn(async (): Promise<CreateTokenResult> => ({ ok: false, error: "too_many_tokens" }));
    render(<TokenManager initialTokens={[]} baseUrl="https://x.test" createAction={createAction} revokeAction={vi.fn()} />);
    await user.type(screen.getByLabelText("Name"), "One more");
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/too many active tokens/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Your new token/ })).not.toBeInTheDocument();
  });
});
