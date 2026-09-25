import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import type { RevokeResult } from "../../lib/account/token-actions";
import { ConnectedApps } from "./ConnectedApps";

/**
 * Connected apps on `/account/tokens` (MCP access spec §3.4, §6) as a table:
 * each OAuth client with its access and last sign-in, disconnected only after
 * an inline confirmation, and gone from the list once it is.
 */

const APPS = [
  { clientId: "c1", name: "claude.ai", readOnly: true, lastIssuedAt: "2026-09-20T08:00:00.000Z" },
  { clientId: "c2", name: null, readOnly: false, lastIssuedAt: "2026-09-21T08:00:00.000Z" },
];

function appRow(name: string) {
  return within(screen.getByRole("table", { name: "Connected apps" })).getByRole("row", { name: new RegExp(name) });
}

it("lists each app with its access and last sign-in, naming an unnamed one", () => {
  render(<ConnectedApps initialApps={APPS} revokeAction={vi.fn()} />);
  expect(appRow("claude.ai")).toHaveTextContent("Read-only");
  expect(appRow("claude.ai")).toHaveTextContent("2026-09-20");
  expect(appRow("Unnamed app")).toBeInTheDocument();
});

it("disconnects only after an inline confirmation", async () => {
  const revokeAction = vi.fn(async (): Promise<RevokeResult> => ({ ok: true }));
  const user = userEvent.setup();
  render(<ConnectedApps initialApps={APPS} revokeAction={revokeAction} />);

  await user.click(within(appRow("claude.ai")).getByRole("button", { name: "Revoke claude.ai" }));
  expect(revokeAction).not.toHaveBeenCalled();
  await user.click(within(appRow("claude.ai")).getByRole("button", { name: "Yes, revoke" }));
  expect(revokeAction).toHaveBeenCalledWith("c1");
  await waitFor(() =>
    expect(within(screen.getByRole("table", { name: "Connected apps" })).queryByRole("row", { name: /claude\.ai/ })).not.toBeInTheDocument()
  );
});

it("says when there are none", () => {
  render(<ConnectedApps initialApps={[]} revokeAction={vi.fn()} />);
  expect(screen.getByText("No connected apps.")).toBeInTheDocument();
});
