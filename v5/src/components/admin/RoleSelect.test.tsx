import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { RoleSelect } from "./RoleSelect";
import type { AdminActionResult } from "../../app/admin/users/action-result";

/**
 * The presentation half of changing a role. The half that matters —
 * who may actually do it — is `src/app/admin/users/actions.test.ts`.
 *
 * The server action is a prop, so there is nothing to mock: a `vi.fn` is a
 * perfectly good `setUserRole` as far as this component is concerned, which is
 * the point of passing it in rather than importing it.
 */

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof RoleSelect>> = {}
) {
  const action = vi.fn<
    (input: { userId: string; role: string }) => Promise<AdminActionResult>
  >(async () => ({ ok: true }));

  render(
    <RoleSelect
      userId="u1"
      personName="Ada Lovelace"
      role="user"
      action={action}
      {...overrides}
    />
  );
  return { action };
}

function theSelect() {
  return screen.getByRole("combobox", { name: /Ada Lovelace/ });
}

// en.json: admin.roles.user = "Student", admin = "SuperMaker",
// super_admin = "Director".
describe("RoleSelect — what it offers", () => {
  it("offers every stored role, labelled in words rather than identifiers", () => {
    renderSelect();

    expect(
      screen.getAllByRole("option").map((option) => option.textContent)
    ).toEqual(["Student", "SuperMaker", "Director"]);
  });

  it("shows the role the person currently holds", () => {
    renderSelect({ role: "admin" });
    expect(theSelect()).toHaveValue("admin");
  });

  it("names the person in the control's accessible name", () => {
    renderSelect();
    expect(theSelect()).toHaveAccessibleName("Role for Ada Lovelace");
  });
});

describe("RoleSelect — changing it", () => {
  it("calls the action with the chosen role and confirms", async () => {
    const user = userEvent.setup();
    const { action } = renderSelect();

    await user.selectOptions(theSelect(), "admin");

    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({ userId: "u1", role: "admin" });
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(theSelect()).toHaveValue("admin");
  });

  it("puts the old role back and explains when the server refuses", async () => {
    const user = userEvent.setup();
    const { action } = renderSelect({ role: "super_admin" });
    action.mockResolvedValue({ ok: false, error: "last_super_admin" });

    await user.selectOptions(theSelect(), "user");

    expect(await screen.findByText(/last director/i)).toBeInTheDocument();
    // The page must not be left asserting a change that did not happen.
    await waitFor(() => expect(theSelect()).toHaveValue("super_admin"));
  });

  it("keeps the new role and names the gap when the audit write failed", async () => {
    const user = userEvent.setup();
    const { action } = renderSelect();
    action.mockResolvedValue({ ok: true, role: "admin", warning: "audit_unavailable" });

    await user.selectOptions(theSelect(), "admin");

    expect(await screen.findByText(/could not be written to the audit log/i)).toBeInTheDocument();
    // The change landed, so the control must not snap back — that is the whole
    // reason the action reports this as a success.
    expect(theSelect()).toHaveValue("admin");
    // And it is not "Saved": something is missing and somebody has to see it.
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("reports a refusal the page did not anticipate, rather than nothing", async () => {
    const user = userEvent.setup();
    const { action } = renderSelect();
    action.mockResolvedValue({ ok: false, error: "rate_limited" });

    await user.selectOptions(theSelect(), "admin");

    expect(await screen.findByText(/Too many changes/i)).toBeInTheDocument();
  });
});

describe("RoleSelect — rows that cannot change", () => {
  it("disables the floor row and shows why, without waiting to be clicked", () => {
    renderSelect({ role: "super_admin", disabledReason: "protected_floor" });

    expect(theSelect()).toBeDisabled();
    expect(screen.getByText(/protected in the deployment's settings/i)).toBeInTheDocument();
  });

  it("disables the last director's row with its own reason", () => {
    renderSelect({ role: "super_admin", disabledReason: "last_super_admin" });

    expect(theSelect()).toBeDisabled();
    expect(screen.getByText(/last director/i)).toBeInTheDocument();
  });

  it("never calls the action for a disabled row", async () => {
    const user = userEvent.setup();
    const { action } = renderSelect({ disabledReason: "protected_floor" });

    await user.selectOptions(theSelect(), "admin").catch(() => {
      // userEvent refuses to interact with a disabled control, which is the
      // assertion — the catch only keeps the failure from being the test's.
    });

    expect(action).not.toHaveBeenCalled();
  });
});
