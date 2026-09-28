import { render, screen, userEvent } from "../../../test/utils/render";
import { OwnNameEditor } from "./OwnNameEditor";
import type { UpdateOwnNameResult } from "../../lib/account/name-actions";

/**
 * **Name** on `/account`. Who may rename whom, and the audit event, are
 * `src/lib/account/name-actions.test.ts`; the action is a prop here.
 */

function renderEditor(result?: UpdateOwnNameResult) {
  const action = vi.fn(async ({ name }: { name: string }): Promise<UpdateOwnNameResult> =>
    result ?? { ok: true, name: name.replace(/\s+/g, " ").trim() }
  );
  render(<OwnNameEditor name="Casey" action={action} />);
  return { action };
}

describe("OwnNameEditor", () => {
  it("shows your name with a pencil that edits it", () => {
    renderEditor();
    expect(screen.getByTestId("own-name")).toHaveTextContent("Casey");
    expect(screen.getByRole("button", { name: "Edit your name" })).toBeInTheDocument();
  });

  it("saves your name and shows what the server stored", async () => {
    const { action } = renderEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    const field = screen.getByRole("textbox", { name: "Your name" });
    await user.clear(field);
    await user.type(field, "  Casey   Rivera ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(action).toHaveBeenCalledWith({ name: "  Casey   Rivera " });
    expect(screen.getByTestId("own-name")).toHaveTextContent("Casey Rivera");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("says why a name was refused, in the account page's words", async () => {
    renderEditor({ ok: false, error: "invalid_name" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    await user.clear(screen.getByRole("textbox", { name: "Your name" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A name needs 1 to 80 characters.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeInTheDocument();
  });

  it("names an audit gap on a save that landed", async () => {
    renderEditor({ ok: true, name: "Casey R.", warning: "audit_unavailable" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("own-name")).toHaveTextContent("Casey R.");
    expect(screen.getByRole("status")).toHaveTextContent(/could not be written to the audit log/);
  });

  it("Cancel and Escape leave the name as it was and return focus to the pencil", async () => {
    const { action } = renderEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    await user.type(screen.getByRole("textbox", { name: "Your name" }), " Extra");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit your name" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue("Casey");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Your name" })).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByTestId("own-name")).toHaveTextContent("Casey");
  });
});
