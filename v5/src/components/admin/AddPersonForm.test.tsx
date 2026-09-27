import { render, screen, userEvent } from "../../../test/utils/render";
import { AddPersonForm } from "./AddPersonForm";
import type { AddPersonAction } from "../../app/admin/users/action-result";

/**
 * The presentation half of **Add person**. Who may add, and what is refused,
 * is `src/app/admin/users/actions.test.ts`; the Google sign-in that attaches to
 * the new row is `src/lib/auth/config.test.ts`. The action is a prop, so a
 * `vi.fn` stands in for it.
 */

function renderForm(action?: AddPersonAction) {
  const fn = vi.fn<AddPersonAction>(
    action ??
      (async (input) => ({
        ok: true,
        person: {
          id: "u-new",
          name: input.name || input.email,
          email: input.email.trim().toLowerCase(),
          role: "user",
          title: input.title ?? null,
        },
      }))
  );
  render(<AddPersonForm action={fn} />);
  return { action: fn };
}

async function openForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add person" }));
  return user;
}

describe("AddPersonForm", () => {
  it("is a button until opened, and opens inline with the email field focused", async () => {
    renderForm();
    const opener = screen.getByRole("button", { name: "Add person" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();

    await openForm();

    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus();
  });

  it("offers roles by their authorization names, User by default", async () => {
    renderForm();
    await openForm();

    const role = screen.getByRole("combobox", { name: "Role" });
    expect(role).toHaveValue("user");
    expect(Array.from((role as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      "User",
      "Admin",
      "Super admin",
    ]);
  });

  it("sends email, name, role and title, then clears and confirms", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(screen.getByRole("textbox", { name: "Email" }), "Luis@Cornell.edu");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Luis");
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Assistant Director");
    // The submit button, not the opener: both say "Add person".
    const buttons = screen.getAllByRole("button", { name: "Add person" });
    await user.click(buttons[buttons.length - 1]);

    expect(action).toHaveBeenCalledWith({
      email: "Luis@Cornell.edu",
      name: "Luis",
      role: "admin",
      title: "Assistant Director",
    });
    expect(await screen.findByText(/luis@cornell.edu was added/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("user");
  });

  it("sends a blank title as null (the role's default)", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(screen.getByRole("textbox", { name: "Email" }), "sam@cornell.edu");
    const buttons = screen.getAllByRole("button", { name: "Add person" });
    await user.click(buttons[buttons.length - 1]);

    expect(action).toHaveBeenCalledWith({ email: "sam@cornell.edu", name: "", role: "user", title: null });
  });

  it("keeps what was typed and says why on a refusal", async () => {
    renderForm(async () => ({ ok: false, error: "duplicate_email" }));
    const user = await openForm();

    await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@cornell.edu");
    const buttons = screen.getAllByRole("button", { name: "Add person" });
    await user.click(buttons[buttons.length - 1]);

    expect(await screen.findByText("Somebody with that address is already on the list.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@cornell.edu");
  });

  it("says 'did not save' when the action throws", async () => {
    renderForm(async () => {
      throw new Error("network");
    });
    const user = await openForm();

    await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@cornell.edu");
    const buttons = screen.getAllByRole("button", { name: "Add person" });
    await user.click(buttons[buttons.length - 1]);

    expect(await screen.findByText("That did not save. Nothing was changed.")).toBeInTheDocument();
  });
});
