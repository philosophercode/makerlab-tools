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

const opener = () => screen.queryByRole("button", { name: "Add person" });
const submit = () => screen.getByRole("button", { name: "Add" });
const cancel = () => screen.getByRole("button", { name: "Cancel" });
const email = () => screen.getByRole("textbox", { name: "Email" });

async function openForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add person" }));
  return user;
}

describe("AddPersonForm", () => {
  it("is a button until opened, and opens inline with the email field focused", async () => {
    renderForm();
    expect(opener()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();

    await openForm();

    expect(email()).toHaveFocus();
  });

  it("shows one 'Add person' at a time: while open, the form's buttons are Add and Cancel", async () => {
    renderForm();
    await openForm();

    expect(opener()).not.toBeInTheDocument();
    expect(submit()).toHaveAttribute("type", "submit");
    expect(submit()).toHaveAttribute("data-variant", "default");
    expect(cancel()).toHaveAttribute("type", "button");
    expect(cancel()).not.toHaveAttribute("data-variant", "default");
  });

  it("Cancel closes and empties the form, sends nothing, and puts focus back on Add person", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(email(), "ada@cornell.edu");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(cancel());

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(opener()).toHaveFocus();

    // Reopened, it starts empty.
    await user.click(opener()!);
    expect(email()).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("Escape cancels from any field, the same way", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Tech Lead");
    await user.keyboard("{Escape}");

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(opener()).toHaveFocus();
    await user.click(opener()!);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("");
  });

  it("Cancel forgets a refusal along with what was typed", async () => {
    renderForm(async () => ({ ok: false, error: "duplicate_email" }));
    const user = await openForm();

    await user.type(email(), "ada@cornell.edu");
    await user.click(submit());
    expect(await screen.findByText("Somebody with that address is already on the list.")).toBeInTheDocument();

    await user.click(cancel());
    expect(screen.queryByText("Somebody with that address is already on the list.")).not.toBeInTheDocument();
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

  it("sends email, name, role and title, then empties the form for the next person and confirms", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(email(), "Luis@Cornell.edu");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Luis");
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Assistant Director");
    await user.click(submit());

    expect(action).toHaveBeenCalledWith({
      email: "Luis@Cornell.edu",
      name: "Luis",
      role: "admin",
      title: "Assistant Director",
    });
    expect(await screen.findByText(/luis@cornell.edu was added/)).toBeInTheDocument();
    expect(email()).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("user");
    expect(email()).toHaveFocus();

    // Closing afterwards keeps the confirmation said.
    await user.click(cancel());
    expect(screen.getByText(/luis@cornell.edu was added/)).toBeInTheDocument();
  });

  it("says a blank name is filled in from Google at their first sign-in", async () => {
    renderForm();
    await openForm();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription(
      "Optional. Leave blank to use their Google name when they first sign in."
    );
  });

  it("sends a blank title as null (the role's default)", async () => {
    const { action } = renderForm();
    const user = await openForm();

    await user.type(email(), "sam@cornell.edu");
    await user.click(submit());

    expect(action).toHaveBeenCalledWith({ email: "sam@cornell.edu", name: "", role: "user", title: null });
  });

  it("keeps what was typed and says why on a refusal", async () => {
    renderForm(async () => ({ ok: false, error: "duplicate_email" }));
    const user = await openForm();

    await user.type(email(), "ada@cornell.edu");
    await user.click(submit());

    expect(await screen.findByText("Somebody with that address is already on the list.")).toBeInTheDocument();
    expect(email()).toHaveValue("ada@cornell.edu");
  });

  it("says 'did not save' when the action throws", async () => {
    renderForm(async () => {
      throw new Error("network");
    });
    const user = await openForm();

    await user.type(email(), "ada@cornell.edu");
    await user.click(submit());

    expect(await screen.findByText("That did not save. Nothing was changed.")).toBeInTheDocument();
  });
});
