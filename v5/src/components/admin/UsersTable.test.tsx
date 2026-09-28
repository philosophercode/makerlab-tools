import { render, screen, userEvent, within } from "../../../test/utils/render";
import { UsersTable } from "./UsersTable";
import type { UserRecord } from "../../lib/data/users";
import type { RemoveUserResult, SetNameAction } from "../../app/admin/users/action-result";

/**
 * The roster's rendering, the rows it marks as unchangeable, and Remove from
 * the table (auth spec amendment 2026-09-25).
 *
 * `UsersTable` is a server component with no `async`, which is exactly why it
 * can be mounted here: everything it needs is a prop, and the interactive cells
 * are client islands with their own tests.
 */

function person(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "u-ada",
    email: "ada@cornell.edu",
    name: "Ada Lovelace",
    role: "user",
    banned: false,
    banReason: null,
    title: null,
    firstSignedInAt: new Date("2026-03-04T10:00:00.000Z"),
    createdAt: new Date("2026-03-04T10:00:00.000Z"),
    ...overrides,
  };
}

function renderTable(
  users: UserRecord[],
  currentUserId: string | null = null,
  removeResult: RemoveUserResult = {
    ok: true,
    removed: { id: "u-ada", name: "Ada Lovelace", email: "ada@cornell.edu" },
    blocked: false,
  }
) {
  const setRole = vi.fn(async () => ({ ok: true }) as const);
  const removeUser = vi.fn(async () => removeResult);
  const setTitle = vi.fn(async () => ({ ok: true, title: null }) as const);
  const setName = vi.fn<SetNameAction>(async ({ name }) => ({ ok: true, name: name.trim() }));
  render(
    <UsersTable
      users={users}
      currentUserId={currentUserId}
      setRole={setRole}
      removeUser={removeUser}
      setTitle={setTitle}
      setName={setName}
    />
  );
  return { setRole, removeUser, setTitle, setName };
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

describe("UsersTable — the roster", () => {
  it("shows each person's name, address, role control and Remove", () => {
    renderTable([person()]);

    const row = rowFor("Ada Lovelace");
    expect(within(row).getByText("ada@cornell.edu")).toBeInTheDocument();
    expect(within(row).getByRole("combobox", { name: /Ada Lovelace/ })).toHaveValue("user");
    expect(within(row).getByRole("button", { name: "Remove Ada Lovelace" })).toBeEnabled();
  });

  it("shows each person's title under their name: custom, else the role's default", () => {
    renderTable([
      person(),
      person({ id: "u-grace", name: "Grace Hopper", email: "grace@cornell.edu", role: "admin" }),
      person({ id: "u-dee", name: "Dee Rector", email: "dee@cornell.edu", role: "super_admin", title: "Lab Director" }),
    ]);

    // By test id: "Student" is also an option in the row's role select.
    expect(within(rowFor("Ada Lovelace")).getByTestId("person-title")).toHaveTextContent("Student");
    expect(within(rowFor("Grace Hopper")).getByTestId("person-title")).toHaveTextContent("Supermaker");
    expect(within(rowFor("Dee Rector")).getByTestId("person-title")).toHaveTextContent("Lab Director");
    expect(within(rowFor("Dee Rector")).getByRole("button", { name: "Edit the title for Dee Rector" })).toBeInTheDocument();
  });

  it("keeps role and title apart: one column each, roles named by what they authorize", () => {
    renderTable([person({ role: "admin", title: "Tech Lead" })]);

    const table = screen.getByRole("table", { name: "People and their roles" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Person"),
        expect.stringContaining("Title"),
        expect.stringContaining("Role"),
        expect.stringContaining("First signed in"),
        expect.stringContaining("Account"),
      ])
    );

    const row = rowFor("Ada Lovelace");
    const options = within(within(row).getByRole("combobox", { name: /Ada Lovelace/ }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["User", "Admin", "Super admin"]);
    // No title word is ever a role label, and no role label a title.
    for (const word of ["Director", "SuperMaker", "Supermaker", "Student"]) expect(options).not.toContain(word);
    expect(within(row).getByTestId("person-title")).toHaveTextContent("Tech Lead");
  });

  it("puts the address in the person's cell, under the name", () => {
    renderTable([person()]);
    const header = within(rowFor("Ada Lovelace")).getByRole("rowheader");
    expect(header).toHaveTextContent("Ada Lovelace");
    expect(header).toHaveTextContent("ada@cornell.edu");
  });

  it("edits a title from a pencil icon button named for the person", async () => {
    const { setTitle } = renderTable([person()]);
    const user = userEvent.setup();

    await user.click(within(rowFor("Ada Lovelace")).getByRole("button", { name: "Edit the title for Ada Lovelace" }));
    await user.type(within(rowFor("Ada Lovelace")).getByRole("textbox", { name: "Title for Ada Lovelace" }), "Tech Lead");
    await user.click(within(rowFor("Ada Lovelace")).getByRole("button", { name: "Save" }));

    expect(setTitle).toHaveBeenCalledWith({ userId: "u-ada", title: "Tech Lead" });
  });

  it("renames anybody from a pencil beside the name, and shows what the server stored", async () => {
    const { setName } = renderTable([person()]);
    const user = userEvent.setup();
    const row = () => rowFor("Ada");

    await user.click(within(row()).getByRole("button", { name: "Edit the name for Ada Lovelace" }));
    const field = within(row()).getByRole("textbox", { name: "Name for Ada Lovelace" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Ada Lovelace");
    await user.clear(field);
    await user.type(field, "  Ada King ");
    await user.click(within(row()).getByRole("button", { name: "Save" }));

    expect(setName).toHaveBeenCalledWith({ userId: "u-ada", name: "  Ada King " });
    expect(within(row()).getByTestId("person-name")).toHaveTextContent("Ada King");
  });

  it("names somebody who was added without a name", async () => {
    const { setName } = renderTable([person({ name: "luis@cornell.edu", email: "luis@cornell.edu", firstSignedInAt: null })]);
    const user = userEvent.setup();

    await user.click(within(rowFor("luis@cornell.edu")).getByRole("button", { name: "Edit the name for luis@cornell.edu" }));
    const field = within(rowFor("luis@cornell.edu")).getByRole("textbox", { name: "Name for luis@cornell.edu" });
    await user.clear(field);
    await user.type(field, "Luis Example{Enter}");

    expect(setName).toHaveBeenCalledWith({ userId: "u-ada", name: "Luis Example" });
  });

  it("keeps the field open and says why when a rename is refused; Escape then cancels", async () => {
    const { setName } = renderTable([person()]);
    setName.mockResolvedValueOnce({ ok: false, error: "invalid_name" });
    const user = userEvent.setup();

    const opener = within(rowFor("Ada")).getByRole("button", { name: "Edit the name for Ada Lovelace" });
    await user.click(opener);
    await user.clear(within(rowFor("Ada")).getByRole("textbox", { name: "Name for Ada Lovelace" }));
    await user.click(within(rowFor("Ada")).getByRole("button", { name: "Save" }));

    expect(await within(rowFor("Ada")).findByText("A name needs 1 to 80 characters.")).toBeInTheDocument();
    const field = within(rowFor("Ada")).getByRole("textbox", { name: "Name for Ada Lovelace" });
    await user.type(field, "{Escape}");
    expect(within(rowFor("Ada")).queryByRole("textbox", { name: "Name for Ada Lovelace" })).not.toBeInTheDocument();
    expect(within(rowFor("Ada")).getByRole("button", { name: "Edit the name for Ada Lovelace" })).toHaveFocus();
    expect(within(rowFor("Ada")).getByTestId("person-name")).toHaveTextContent("Ada Lovelace");
  });

  it("says 'Not signed in yet' for somebody added ahead of time", () => {
    renderTable([person({ firstSignedInAt: null })]);
    expect(within(rowFor("Ada Lovelace")).getByText("Not signed in yet")).toBeInTheDocument();
    expect(screen.queryByText("2026-03-04")).not.toBeInTheDocument();
  });

  it("says an address once when it is also the placeholder name", () => {
    renderTable([person({ name: "luis@cornell.edu", email: "luis@cornell.edu", firstSignedInAt: null })]);
    expect(within(rowFor("luis@cornell.edu")).getAllByText("luis@cornell.edu")).toHaveLength(1);
  });

  it("offers no Ban any more", () => {
    renderTable([person()]);
    expect(screen.queryByRole("button", { name: /ban/i })).not.toBeInTheDocument();
  });

  it("renders the first sign-in as an ISO date", () => {
    renderTable([person()]);
    expect(within(rowFor("Ada Lovelace")).getByText("2026-03-04")).toBeInTheDocument();
  });

  it("marks the viewer's own row", () => {
    renderTable([person()], "u-ada");
    expect(within(rowFor("Ada Lovelace")).getByText("you")).toBeInTheDocument();
  });

  it("names what is missing when nobody has signed in", () => {
    renderTable([]);
    expect(screen.getByText(/Nobody has signed in yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("UsersTable — rows it will not let you change", () => {
  it("locks a floor address's role and Remove, with the reason visible", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    renderTable([
      person({ id: "u-founder", email: "founder@cornell.edu", name: "Fay Founder", role: "super_admin" }),
      person({ id: "u-other", email: "other@cornell.edu", name: "Otto Other", role: "super_admin" }),
    ]);

    const row = rowFor("Fay Founder");
    expect(within(row).getByRole("combobox", { name: /Fay Founder/ })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Remove Fay Founder" })).toBeDisabled();
    // A short badge, not a sentence per row…
    expect(within(row).getAllByText("Protected")).toHaveLength(2);
    // …with the sentence as each disabled control's description.
    expect(within(row).getByRole("combobox", { name: /Fay Founder/ })).toHaveAccessibleDescription(
      /protected in the deployment's settings/i
    );
    expect(within(row).getByRole("button", { name: "Remove Fay Founder" })).toHaveAccessibleDescription(
      /protected in the deployment's settings/i
    );
  });

  it("locks the last super admin's role and Remove, worked out from the list it was given", () => {
    renderTable(
      [
        person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
        person({ id: "u-ada", email: "ada@cornell.edu", name: "Ada Lovelace", role: "user" }),
      ],
      "u-other-viewer"
    );

    const dee = rowFor("Dee Rector");
    expect(within(dee).getByRole("combobox", { name: /Dee Rector/ })).toBeDisabled();
    expect(within(dee).getByRole("button", { name: "Remove Dee Rector" })).toBeDisabled();
    expect(within(rowFor("Ada Lovelace")).getByRole("combobox", { name: /Ada Lovelace/ })).toBeEnabled();
  });

  it("unlocks both once a second super admin exists", () => {
    renderTable([
      person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
      person({ id: "u-sam", email: "sam@cornell.edu", name: "Sam Second", role: "super_admin" }),
    ]);

    expect(within(rowFor("Dee Rector")).getByRole("combobox", { name: /Dee Rector/ })).toBeEnabled();
    expect(within(rowFor("Dee Rector")).getByRole("button", { name: "Remove Dee Rector" })).toBeEnabled();
  });

  it("will not let you remove yourself, but leaves your role alone", () => {
    renderTable(
      [
        person({ id: "u-ada", name: "Ada Lovelace", role: "admin" }),
        person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
        person({ id: "u-sam", email: "sam@cornell.edu", name: "Sam Second", role: "super_admin" }),
      ],
      "u-ada"
    );

    const row = rowFor("Ada Lovelace");
    expect(within(row).getByRole("button", { name: "Remove Ada Lovelace" })).toBeDisabled();
    expect(within(row).getByText("Your account")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Remove Ada Lovelace" })).toHaveAccessibleDescription(
      "You cannot remove yourself."
    );
    expect(within(row).getByRole("combobox", { name: /Ada Lovelace/ })).toBeEnabled();
  });
});

describe("UsersTable — removing somebody", () => {
  it("takes the row off once the server has removed them, and says so", async () => {
    const { removeUser } = renderTable([
      person(),
      person({ id: "u-grace", email: "grace@cornell.edu", name: "Grace Hopper" }),
    ]);
    const user = userEvent.setup();

    // Scoped to the table row: jsdom renders the phone list too.
    await user.click(within(rowFor("Ada Lovelace")).getByRole("button", { name: "Remove Ada Lovelace" }));
    await user.click(within(rowFor("Ada Lovelace")).getByRole("button", { name: "Remove Ada Lovelace" }));

    expect(removeUser).toHaveBeenCalledWith({ userId: "u-ada", block: false });
    expect(await screen.findByText("Ada Lovelace was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Ada Lovelace/ })).not.toBeInTheDocument();
    expect(rowFor("Grace Hopper")).toBeInTheDocument();
  });
});

describe("UsersTable — finding somebody", () => {
  beforeEach(() => window.history.replaceState(null, "", "/admin/users"));

  it("searches name and address, and narrows by role with counts, into the URL", async () => {
    renderTable([
      person(),
      person({ id: "u-grace", email: "grace@cornell.edu", name: "Grace Hopper", role: "admin" }),
      person({ id: "u-ken", email: "ken@cornell.edu", name: "Ken Thompson", role: "admin" }),
    ]);
    const user = userEvent.setup();
    const table = () => screen.getByRole("table", { name: "People and their roles" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "grace@");
    expect(within(table()).getAllByRole("rowheader")).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search" }));

    await user.click(within(screen.getByRole("search")).getByRole("button", { name: "Role" }));
    const admins = await screen.findByRole("menuitemradio", { name: /^Admin/ });
    expect(admins).toHaveTextContent("2");
    await user.click(admins);

    expect(window.location.search).toBe("?role=admin");
    const names = within(table()).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(names).toEqual([expect.stringContaining("Grace Hopper"), expect.stringContaining("Ken Thompson")]);
  });

  const cast = () => [
    person({ id: "u-ada", name: "ada Lovelace", role: "user", firstSignedInAt: new Date("2026-03-04T00:00:00Z") }),
    person({
      id: "u-grace",
      email: "grace@cornell.edu",
      name: "Grace Hopper",
      role: "admin",
      title: "Tech Lead",
      firstSignedInAt: new Date("2026-01-02T00:00:00Z"),
    }),
    person({ id: "u-new", email: "new@cornell.edu", name: "Bea New", role: "admin", firstSignedInAt: null }),
    person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
  ];
  const table = () => screen.getByRole("table", { name: "People and their roles" });
  const shownNames = () =>
    within(table())
      .getAllByTestId("person-name")
      .map((cell) => cell.textContent);
  const header = (name: string) => within(table()).getByRole("columnheader", { name: new RegExp(name) });

  it("narrows to who has not signed in yet, with counts, into the URL", async () => {
    renderTable(cast());
    const user = userEvent.setup();

    await user.click(within(screen.getByRole("search")).getByRole("button", { name: "Signed in" }));
    const notYet = await screen.findByRole("menuitemradio", { name: /^Not signed in yet/ });
    expect(notYet).toHaveTextContent("1");
    expect(screen.getByRole("menuitemradio", { name: /^Signed in/ })).toHaveTextContent("3");
    await user.click(notYet);

    expect(window.location.search).toBe("?signed_in=no");
    expect(shownNames()).toEqual(["Bea New"]);
  });

  it("narrows by title as the roster shows it — custom titles and role defaults alike", async () => {
    renderTable(cast());
    const user = userEvent.setup();

    await user.click(within(screen.getByRole("search")).getByRole("button", { name: "Title" }));
    const options = (await screen.findAllByRole("menuitemradio")).map((item) => item.textContent);
    // "Any", then every title present, sorted: two defaults and one custom.
    expect(options).toEqual(["Any", "Student1", "Super Admin1", "Supermaker1", "Tech Lead1"]);
    await user.click(screen.getByRole("menuitemradio", { name: /^Supermaker/ }));

    expect(window.location.search).toBe("?title=Supermaker");
    expect(shownNames()).toEqual(["Bea New"]);
  });

  it("starts from the filters in the URL, and combines them", () => {
    render(
      <UsersTable
        users={cast()}
        currentUserId={null}
        initial={{ query: "", role: "admin", signedIn: "yes", title: null }}
        setRole={vi.fn()}
        removeUser={vi.fn()}
        setTitle={vi.fn()}
        setName={vi.fn()}
      />
    );
    expect(shownNames()).toEqual(["Grace Hopper"]);
  });

  it("finds somebody by their title in the search box", async () => {
    renderTable(cast());
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "tech lead");
    expect(shownNames()).toEqual(["Grace Hopper"]);
  });

  it("sorts by Person, ignoring case, from a header button with aria-sort", async () => {
    renderTable(cast());
    const user = userEvent.setup();

    expect(header("Person")).not.toHaveAttribute("aria-sort");
    await user.click(within(header("Person")).getByRole("button"));
    expect(header("Person")).toHaveAttribute("aria-sort", "ascending");
    expect(shownNames()).toEqual(["ada Lovelace", "Bea New", "Dee Rector", "Grace Hopper"]);

    await user.click(within(header("Person")).getByRole("button"));
    expect(header("Person")).toHaveAttribute("aria-sort", "descending");
    expect(shownNames()).toEqual(["Grace Hopper", "Dee Rector", "Bea New", "ada Lovelace"]);
  });

  it("sorts by the title shown, by role (most privileged first), and by first sign-in", async () => {
    renderTable(cast());
    const user = userEvent.setup();

    await user.click(within(header("Title")).getByRole("button"));
    expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    // Student, Super Admin, Supermaker, Tech Lead.
    expect(shownNames()).toEqual(["ada Lovelace", "Dee Rector", "Bea New", "Grace Hopper"]);

    await user.click(within(header("Role")).getByRole("button"));
    expect(header("Role")).toHaveAttribute("aria-sort", "descending");
    expect(header("Title")).not.toHaveAttribute("aria-sort");
    expect(shownNames()[0]).toBe("Dee Rector");
    expect(shownNames()[3]).toBe("ada Lovelace");

    await user.click(within(header("First signed in")).getByRole("button"));
    expect(header("First signed in")).toHaveAttribute("aria-sort", "ascending");
    // Not signed in yet first, then the earliest date.
    expect(shownNames().slice(0, 2)).toEqual(["Bea New", "Grace Hopper"]);
  });

  it("does not offer to sort the Account column", () => {
    renderTable(cast());
    expect(within(header("Account")).queryByRole("button")).not.toBeInTheDocument();
  });
});
