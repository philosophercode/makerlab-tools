import { render, screen, userEvent } from "../../../test/utils/render";
import { TitleEditor } from "./TitleEditor";
import type { SetTitleAction } from "../../app/admin/users/action-result";

/**
 * The presentation half of a person's title. Who may change it is
 * `src/app/admin/users/actions.test.ts`; like `RoleSelect`, the action is a
 * prop, so a `vi.fn` stands in for it.
 */

function renderEditor(overrides: Partial<React.ComponentProps<typeof TitleEditor>> = {}) {
  const action = vi.fn<SetTitleAction>(async ({ title }) => ({
    ok: true,
    title: title?.trim() || null,
  }));
  render(
    <TitleEditor userId="u1" personName="Ada Lovelace" role="user" title={null} action={action} {...overrides} />
  );
  return { action };
}

const editButton = () => screen.getByRole("button", { name: "Edit the title for Ada Lovelace" });
const field = () => screen.getByRole("textbox", { name: "Title for Ada Lovelace" });

// en.json: admin.titles.user = "Student", admin.title.save = "Save".
describe("TitleEditor", () => {
  it("shows the role's default when there is no custom title, and the custom one when there is", () => {
    renderEditor();
    expect(screen.getByTestId("person-title")).toHaveTextContent("Student");
  });

  it("shows a custom title", () => {
    renderEditor({ title: "Shop Assistant" });
    expect(screen.getByTestId("person-title")).toHaveTextContent("Shop Assistant");
  });

  it("saves what was typed and shows what the server stored", async () => {
    const user = userEvent.setup();
    const { action } = renderEditor();

    await user.click(editButton());
    await user.type(field(), "  Shop Assistant ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(action).toHaveBeenCalledWith({ userId: "u1", title: "  Shop Assistant " });
    expect(screen.getByTestId("person-title")).toHaveTextContent("Shop Assistant");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("goes back to the role's default after a blank save", async () => {
    const user = userEvent.setup();
    renderEditor({ title: "Shop Assistant" });

    await user.click(editButton());
    expect(field()).toHaveAttribute("placeholder", "Leave blank for “Student”");
    await user.clear(field());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("person-title")).toHaveTextContent("Student");
  });

  it("keeps the field open with the reason on a refusal, changing nothing", async () => {
    const user = userEvent.setup();
    const action = vi.fn<SetTitleAction>(async () => ({ ok: false, error: "invalid_title" }));
    renderEditor({ action });

    await user.click(editButton());
    await user.type(field(), "Too long, supposedly");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(field()).toHaveValue("Too long, supposedly");
    expect(screen.getByRole("status")).toHaveTextContent("A title can be at most 60 characters.");
  });

  it("cancels without calling the server", async () => {
    const user = userEvent.setup();
    const { action } = renderEditor();

    await user.click(editButton());
    await user.type(field(), "Nope");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByTestId("person-title")).toHaveTextContent("Student");
  });
});
