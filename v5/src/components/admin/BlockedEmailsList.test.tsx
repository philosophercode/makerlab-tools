import { render, screen, userEvent, within } from "../../../test/utils/render";
import { BlockedEmailsList, type BlockedEmailRow } from "./BlockedEmailsList";
import type { UnblockEmailAction } from "../../app/admin/users/action-result";

/**
 * "Blocked emails" on the People page (auth spec amendment 2026-09-25).
 */

const ROWS: BlockedEmailRow[] = [
  { email: "ben@cornell.edu", reason: "Spam", blockedByName: "Dee Rector", blockedOn: "2026-09-25" },
  { email: "noreason@cornell.edu", reason: null, blockedByName: null, blockedOn: "2026-09-24" },
];

function renderList(rows = ROWS, unblock: UnblockEmailAction = vi.fn(async ({ email }) => ({ ok: true as const, email }))) {
  render(<BlockedEmailsList rows={rows} unblock={unblock} />);
  return { unblock, table: () => screen.getByRole("table", { name: "Blocked email addresses" }) };
}

describe("BlockedEmailsList", () => {
  it("lists each address with its reason, blocker and date", () => {
    const { table } = renderList();

    expect(screen.getByRole("heading", { name: "Blocked emails" })).toBeInTheDocument();
    const row = within(table()).getByRole("row", { name: /ben@cornell.edu/ });
    expect(within(row).getByText("Spam")).toBeInTheDocument();
    expect(within(row).getByText("Dee Rector")).toBeInTheDocument();
    expect(within(row).getByText("2026-09-25")).toBeInTheDocument();
  });

  it("says so when nothing is blocked", () => {
    renderList([]);
    expect(screen.getByText("No addresses are blocked.")).toBeInTheDocument();
  });

  it("unblocks on the click, and the row leaves once the server says so", async () => {
    const { unblock, table } = renderList();
    const user = userEvent.setup();

    await user.click(within(table()).getByRole("button", { name: "Unblock ben@cornell.edu" }));

    expect(unblock).toHaveBeenCalledWith({ email: "ben@cornell.edu" });
    expect(await screen.findByText("ben@cornell.edu can sign up again.")).toBeInTheDocument();
    expect(within(table()).queryByRole("row", { name: /ben@cornell.edu/ })).not.toBeInTheDocument();
    expect(within(table()).getByRole("row", { name: /noreason@cornell.edu/ })).toBeInTheDocument();
  });

  it("keeps the row and says why when the server refuses", async () => {
    const { table } = renderList(ROWS, vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const })));
    const user = userEvent.setup();

    await user.click(within(table()).getByRole("button", { name: "Unblock ben@cornell.edu" }));

    expect(await screen.findByText("Your account does not hold the permission this needs.")).toBeInTheDocument();
    expect(within(table()).getByRole("row", { name: /ben@cornell.edu/ })).toBeInTheDocument();
  });
});
