import { render, screen, within } from "../../../test/utils/render";
import { UsersTable } from "./UsersTable";
import type { UserRecord } from "../../lib/data/users";

/**
 * The roster's rendering, and the two rows it marks as unchangeable.
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

function renderTable(users: UserRecord[], currentUserId: string | null = null) {
  const setRole = vi.fn(async () => ({ ok: true }) as const);
  const setBanned = vi.fn(async () => ({ ok: true }) as const);
  render(
    <UsersTable
      users={users}
      currentUserId={currentUserId}
      setRole={setRole}
      setBanned={setBanned}
    />
  );
  return { setRole, setBanned };
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

describe("UsersTable — the roster", () => {
  it("shows each person's name, address and role control", () => {
    renderTable([person()]);

    const row = rowFor("Ada Lovelace");
    expect(within(row).getByText("ada@cornell.edu")).toBeInTheDocument();
    expect(within(row).getByRole("combobox", { name: /Ada Lovelace/ })).toHaveValue("user");
  });

  it("renders the first sign-in as an ISO date", () => {
    renderTable([person()]);
    expect(screen.getByText("2026-03-04")).toBeInTheDocument();
  });

  it("marks the viewer's own row", () => {
    renderTable([person()], "u-ada");
    expect(within(rowFor("Ada Lovelace")).getByText("you")).toBeInTheDocument();
  });

  it("shows a ban and its reason rather than hiding the account", () => {
    renderTable([person({ banned: true, banReason: "Ignored the laser rules" })]);

    const row = rowFor("Ada Lovelace");
    expect(within(row).getByText(/Ignored the laser rules/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Lift ban" })).toBeInTheDocument();
  });

  it("names what is missing when nobody has signed in", () => {
    renderTable([]);
    expect(screen.getByText(/Nobody has signed in yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("UsersTable — rows it will not let you change", () => {
  it("locks a floor address, with the reason visible", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    renderTable([
      person({ id: "u-founder", email: "founder@cornell.edu", name: "Fay Founder", role: "super_admin" }),
      person({ id: "u-other", email: "other@cornell.edu", name: "Otto Other", role: "super_admin" }),
    ]);

    const row = rowFor("Fay Founder");
    expect(within(row).getByRole("combobox", { name: /Fay Founder/ })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Ban" })).toBeDisabled();
    expect(
      within(row).getAllByText(/protected in the deployment's settings/i).length
    ).toBeGreaterThan(0);
  });

  it("locks the last director's role, worked out from the list it was given", () => {
    renderTable([
      person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
      person({ id: "u-ada", email: "ada@cornell.edu", name: "Ada Lovelace", role: "user" }),
    ]);

    expect(
      within(rowFor("Dee Rector")).getByRole("combobox", { name: /Dee Rector/ })
    ).toBeDisabled();
    expect(
      within(rowFor("Ada Lovelace")).getByRole("combobox", { name: /Ada Lovelace/ })
    ).toBeEnabled();
  });

  it("unlocks it once a second director exists", () => {
    renderTable([
      person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
      person({ id: "u-sam", email: "sam@cornell.edu", name: "Sam Second", role: "super_admin" }),
    ]);

    expect(
      within(rowFor("Dee Rector")).getByRole("combobox", { name: /Dee Rector/ })
    ).toBeEnabled();
  });

  it("does not count a banned director as somebody who could undo it", () => {
    renderTable([
      person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
      person({
        id: "u-ban",
        email: "banned@cornell.edu",
        name: "Ben Banned",
        role: "super_admin",
        banned: true,
      }),
    ]);

    expect(
      within(rowFor("Dee Rector")).getByRole("combobox", { name: /Dee Rector/ })
    ).toBeDisabled();
  });

  it("will not let you ban yourself, but leaves your role alone", () => {
    renderTable(
      [
        person({ id: "u-ada", name: "Ada Lovelace", role: "admin" }),
        person({ id: "u-dee", email: "dee@cornell.edu", name: "Dee Rector", role: "super_admin" }),
        person({ id: "u-sam", email: "sam@cornell.edu", name: "Sam Second", role: "super_admin" }),
      ],
      "u-ada"
    );

    const row = rowFor("Ada Lovelace");
    expect(within(row).getByRole("button", { name: "Ban" })).toBeDisabled();
    expect(within(row).getByText("You cannot ban yourself.")).toBeInTheDocument();
    expect(within(row).getByRole("combobox", { name: /Ada Lovelace/ })).toBeEnabled();
  });
});
