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
    async (input: { name: string; readOnly: boolean }): Promise<CreateTokenResult> => ({
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

/** A token's row in the table (the phone list repeats it in jsdom, where no CSS picks one). */
function tokenRow(name: string) {
  return within(screen.getByRole("table", { name: "Your tokens" })).getByRole("row", { name: new RegExp(name) });
}

describe("TokenManager", () => {
  it("lists tokens by name and prefix — never a whole token", () => {
    setup();
    const row = tokenRow("Old laptop");
    expect(within(row).getByText("mlt_oldoldol…")).toBeInTheDocument();
    // Never used, expiring on an ISO day: the table's dates are comparable.
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(["Never", "2026-12-01"])
    );
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("offers no expiry choice: every token lasts 90 days, said as a date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    try {
      setup();
      expect(screen.queryByLabelText("Expires")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByTestId("token-expiry")).toHaveTextContent("Dec 24, 2026 — 90 days, one semester.");
      // Read-only is still the one choice.
      expect(screen.getByRole("checkbox", { name: /read-only/i })).not.toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the form and the reveal in one column", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Name"), "Laptop");
    await user.click(screen.getByRole("button", { name: "Create token" }));
    const reveal = (await screen.findByRole("heading", { name: /Your new token/ })).closest("section")!;
    const form = screen.getByRole("button", { name: "Create token" }).closest("form")!;
    // One shared column: the reveal and the form's section are siblings in the same width-capped wrapper.
    const column = reveal.parentElement!;
    expect(column).toHaveClass("max-w-[640px]");
    expect(column).toContainElement(form);
  });

  it("creates a read-only token and reveals it once, warning to save it now and again beside Done", async () => {
    const user = userEvent.setup();
    const { createAction } = setup();

    await user.type(screen.getByLabelText("Name"), "Claude Code on my laptop");
    await user.click(screen.getByRole("checkbox", { name: /read-only/i }));
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(createAction).toHaveBeenCalledWith({ name: "Claude Code on my laptop", readOnly: true });
    const reveal = await screen.findByRole("heading", { name: /Your new token/ });
    const panel = reveal.closest("section")!;
    expect(within(panel).getByLabelText("Personal access token")).toHaveTextContent(TOKEN);

    // The warning: above the token, and repeated next to the button that dismisses the reveal.
    const warnings = within(panel).getAllByText(
      "Save this token now. You won't be able to see or copy it again after you leave this page."
    );
    expect(warnings).toHaveLength(2);
    const tokenBlock = within(panel).getByLabelText("Personal access token");
    expect(warnings[0].compareDocumentPosition(tokenBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const done = within(panel).getByRole("button", { name: "I've copied it" });
    expect(warnings[1].closest("div")).toContainElement(done);

    expect(panel).toHaveTextContent("claude mcp add --transport http makerlab https://tools.example.edu/api/mcp");
    expect(panel).toHaveTextContent('bearer_token_env_var = "MAKERLAB_MCP_TOKEN"');
    expect(panel).toHaveTextContent(`export MAKERLAB_MCP_TOKEN=${TOKEN}`);

    // The setup prompt names the variable, never the token.
    const prompt = within(panel).getByLabelText("setup prompt");
    expect(prompt).toHaveTextContent("MAKERLAB_MCP_TOKEN");
    expect(prompt).toHaveTextContent("https://tools.example.edu/api/mcp");
    expect(prompt).toHaveTextContent("Never ask me to paste the token into this chat");
    expect(prompt.textContent).not.toContain(TOKEN);
    expect(within(panel).getByRole("button", { name: "Copy setup prompt" })).toBeInTheDocument();

    // The new row is listed as read-only.
    expect(within(tokenRow("Claude Code on my laptop")).getByText("Read-only")).toBeInTheDocument();

    // Dismissed, it is gone for good: nothing on the page holds it any more.
    await user.click(done);
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("copies the setup prompt without the token", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await user.type(screen.getByLabelText("Name"), "Laptop");
    await user.click(screen.getByRole("button", { name: "Create token" }));
    await user.click(await screen.findByRole("button", { name: "Copy setup prompt" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Authorization: Bearer $MAKERLAB_MCP_TOKEN");
    expect(copied).not.toContain(TOKEN);
  });

  it("revokes only after an inline confirmation", async () => {
    const user = userEvent.setup();
    const { revokeAction } = setup();

    await user.click(within(tokenRow("Old laptop")).getByRole("button", { name: "Revoke Old laptop" }));
    expect(revokeAction).not.toHaveBeenCalled();
    expect(within(tokenRow("Old laptop")).getByText(/Anything using it stops working at once/)).toBeInTheDocument();

    await user.click(within(tokenRow("Old laptop")).getByRole("button", { name: "Yes, revoke" }));
    expect(revokeAction).toHaveBeenCalledWith(EXISTING.id);
    await waitFor(() => expect(within(tokenRow("Old laptop")).getByText("Revoked")).toBeInTheDocument());
    expect(within(tokenRow("Old laptop")).queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it("can back out of a revoke", async () => {
    const user = userEvent.setup();
    const { revokeAction } = setup();
    await user.click(within(tokenRow("Old laptop")).getByRole("button", { name: "Revoke Old laptop" }));
    await user.click(within(tokenRow("Old laptop")).getByRole("button", { name: "Cancel" }));
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
