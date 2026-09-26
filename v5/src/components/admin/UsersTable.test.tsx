import { render, screen, userEvent, within } from "../../../test/utils/render";
import { UsersTable } from "./UsersTable";
import type { UserRecord } from "../../lib/data/users";
import type { RemoveUserResult } from "../../app/admin/users/action-result";

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
  render(<UsersTable users={users} currentUserId={currentUserId} setRole={setRole} removeUser={removeUser} />);
  return { setRole, removeUser };
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

  it("offers no Ban any more", () => {
    renderTable([person()]);
    expect(screen.queryByRole("button", { name: /ban/i })).not.toBeInTheDocument();
  });

  it("renders the first sign-in as an ISO date", () => {
    renderTable([person()]);
    expect(screen.getByText("2026-03-04")).toBeInTheDocument();
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
    expect(within(row).getAllByText(/protected in the deployment's settings/i).length).toBeGreaterThan(0);
  });

  it("locks the last director's role and Remove, worked out from the list it was given", () => {
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

  it("unlocks both once a second director exists", () => {
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
    expect(within(row).getByText("You cannot remove yourself.")).toBeInTheDocument();
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
    const admins = await screen.findByRole("menuitemradio", { name: /SuperMaker|Admin/ });
    expect(admins).toHaveTextContent("2");
    await user.click(admins);

    expect(window.location.search).toBe("?role=admin");
    const names = within(table()).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(names).toEqual([expect.stringContaining("Grace Hopper"), expect.stringContaining("Ken Thompson")]);
  });
});
