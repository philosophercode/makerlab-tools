import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { BanToggle } from "./BanToggle";
import type { AdminActionResult } from "../../app/admin/users/action-result";

/**
 * The presentation half of banning. `src/app/admin/users/actions.test.ts`
 * covers the half that decides anything.
 */

function renderToggle(
  overrides: Partial<React.ComponentProps<typeof BanToggle>> = {}
) {
  const action = vi.fn<
    (input: { userId: string; banned: boolean; reason?: string }) => Promise<AdminActionResult>
  >(async () => ({ ok: true }));

  render(
    <BanToggle
      userId="u1"
      personName="Ada Lovelace"
      banned={false}
      action={action}
      {...overrides}
    />
  );
  return { action };
}

describe("BanToggle — banning", () => {
  it("offers a reason field only while the person is not banned", () => {
    renderToggle();
    expect(screen.getByLabelText(/Reason for banning Ada Lovelace/)).toBeInTheDocument();
  });

  it("sends the reason it was given", async () => {
    const user = userEvent.setup();
    const { action } = renderToggle();

    await user.type(
      screen.getByLabelText(/Reason for banning Ada Lovelace/),
      "  Ignored the laser rules  "
    );
    await user.click(screen.getByRole("button", { name: "Ban" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        userId: "u1",
        banned: true,
        reason: "Ignored the laser rules",
      });
    });
  });

  it("omits the reason entirely when none was typed", async () => {
    const user = userEvent.setup();
    const { action } = renderToggle();

    await user.click(screen.getByRole("button", { name: "Ban" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({ userId: "u1", banned: true });
    });
  });

  it("offers to lift the ban once it has landed", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: "Ban" }));

    expect(await screen.findByRole("button", { name: "Lift ban" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason for banning/)).not.toBeInTheDocument();
  });

  it("puts the control back and explains when the server refuses", async () => {
    const user = userEvent.setup();
    const { action } = renderToggle();
    action.mockResolvedValue({ ok: false, error: "protected_floor" });

    await user.click(screen.getByRole("button", { name: "Ban" }));

    expect(
      await screen.findByText(/protected in the deployment's settings/i)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ban" })).toBeInTheDocument()
    );
  });
});

describe("BanToggle — lifting a ban", () => {
  it("calls the action with `banned: false`", async () => {
    const user = userEvent.setup();
    const { action } = renderToggle({ banned: true });

    await user.click(screen.getByRole("button", { name: "Lift ban" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({ userId: "u1", banned: false });
    });
  });

  it("is offered even on a row that cannot be banned — restoring access locks nobody out", () => {
    renderToggle({ banned: true, disabledReason: "protected_floor" });
    expect(screen.getByRole("button", { name: "Lift ban" })).toBeEnabled();
  });
});

describe("BanToggle — rows that cannot be banned", () => {
  it("disables the floor row and says why", () => {
    renderToggle({ disabledReason: "protected_floor" });

    expect(screen.getByRole("button", { name: "Ban" })).toBeDisabled();
    expect(screen.getByText(/protected in the deployment's settings/i)).toBeInTheDocument();
  });

  it("disables your own row with the self-ban reason", () => {
    renderToggle({ disabledReason: "self_ban" });

    expect(screen.getByRole("button", { name: "Ban" })).toBeDisabled();
    expect(screen.getByText("You cannot ban yourself.")).toBeInTheDocument();
  });
});
