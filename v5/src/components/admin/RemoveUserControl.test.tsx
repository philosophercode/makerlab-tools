import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { RemoveUserControl } from "./RemoveUserControl";
import type { RemoveUserAction, RemoveUserResult } from "../../app/admin/users/action-result";

/**
 * **Remove**, inline (auth spec amendment 2026-09-25). The presentation half;
 * who may do it, and what it does to the database, is `actions.test.ts` and
 * `lib/data/user-removal.test.ts`.
 */

const REMOVED: RemoveUserResult = {
  ok: true,
  removed: { id: "u1", name: "Ada Lovelace", email: "ada@cornell.edu" },
  blocked: false,
};

function renderControl(overrides: Partial<React.ComponentProps<typeof RemoveUserControl>> = {}, result = REMOVED) {
  const action = vi.fn<RemoveUserAction>(async () => result);
  const onRemoved = vi.fn();
  render(
    <RemoveUserControl
      userId="u1"
      personName="Ada Lovelace"
      email="ada@cornell.edu"
      action={action}
      onRemoved={onRemoved}
      {...overrides}
    />
  );
  return { action, onRemoved };
}

describe("RemoveUserControl — asking first", () => {
  it("sends nothing until the confirmation's own button is pressed", async () => {
    const { action } = renderControl();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(action).not.toHaveBeenCalled();
    const prompt = screen.getByText(
      "Remove Ada Lovelace? They lose access and their account is deleted. Their reports and history stay."
    );
    expect(prompt).toBeInTheDocument();
    // Focus moves to the question, so it is read before the buttons.
    expect(prompt).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Also block this email from signing up again" })).not.toBeChecked();
  });

  it("removes without blocking by default, and reports the removal", async () => {
    const { action, onRemoved } = renderControl();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(action).toHaveBeenCalledWith({ userId: "u1", block: false });
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(REMOVED));
  });

  it("blocks with a reason when the box is ticked", async () => {
    const { action } = renderControl({}, { ...REMOVED, blocked: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("checkbox", { name: "Also block this email from signing up again" }));
    await user.type(screen.getByRole("textbox", { name: "Reason for blocking ada@cornell.edu" }), "  Misuse ");
    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(action).toHaveBeenCalledWith({ userId: "u1", block: true, reason: "Misuse" });
  });

  it("Cancel closes it, sends nothing, and returns focus to Remove", async () => {
    const { action } = renderControl();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByText(/They lose access/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ada Lovelace" })).toHaveFocus();
  });
});

describe("RemoveUserControl — refusals", () => {
  it("keeps the person and shows the reason when the server refuses", async () => {
    const { onRemoved } = renderControl({}, { ok: false, error: "last_super_admin" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(await screen.findByText(/This is the last director/)).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("says 'did not save' when the action throws", async () => {
    const action = vi.fn<RemoveUserAction>(async () => {
      throw new Error("network");
    });
    renderControl({ action });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(await screen.findByText("That did not save. Nothing was changed.")).toBeInTheDocument();
  });

  it("is disabled with the reason on a row that cannot be removed", () => {
    renderControl({ disabledReason: "protected_floor" });

    expect(screen.getByRole("button", { name: "Remove Ada Lovelace" })).toBeDisabled();
    expect(screen.getByText(/protected in the deployment's settings/)).toBeInTheDocument();
  });
});
