// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { user } from "../db/schema/index";
import { insertUserRow } from "../../../test/utils/session";
import type { Db } from "../db/types";
import {
  countUsersWithRole,
  findUserById,
  listAssignableStaff,
  listUsers,
} from "./users";

/**
 * The admin roster against a real (in-process) Postgres. No env, no network.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(user);
});

async function seed(
  email: string,
  role: "user" | "admin" | "super_admin",
  extra: { banned?: boolean; banReason?: string | null; name?: string } = {}
) {
  return insertUserRow(db, { id: `u-${email}`, email, role, ...extra });
}

describe("listUsers", () => {
  it("returns everyone in email order, whatever order they were created in", async () => {
    await seed("zoe@cornell.edu", "user");
    await seed("ada@cornell.edu", "super_admin");
    await seed("marie@cornell.edu", "admin");

    const rows = await listUsers({ db });

    expect(rows.map((row) => row.email)).toEqual([
      "ada@cornell.edu",
      "marie@cornell.edu",
      "zoe@cornell.edu",
    ]);
    expect(rows.map((row) => row.role)).toEqual(["super_admin", "admin", "user"]);
  });

  it("reports a ban and its reason", async () => {
    await seed("banned@cornell.edu", "user", {
      banned: true,
      banReason: "Repeatedly ignored the laser rules",
    });

    const [row] = await listUsers({ db });
    expect(row.banned).toBe(true);
    expect(row.banReason).toBe("Repeatedly ignored the laser rules");
  });

  it("is empty on a database nobody has signed in to", async () => {
    expect(await listUsers({ db })).toEqual([]);
  });

  it("falls back to `user` for a row whose role column is null", async () => {
    // Better Auth declares `role` optional, so a row written before the
    // default applied would read back null. It must not become `anonymous`.
    await seed("nullrole@cornell.edu", "user");
    await db.update(user).set({ role: null }).where(eq(user.email, "nullrole@cornell.edu"));

    const [row] = await listUsers({ db });
    expect(row.role).toBe("user");
  });
});

describe("findUserById", () => {
  it("finds the row the role-change action needs to check the floor", async () => {
    const seeded = await seed("ada@cornell.edu", "admin", { name: "Ada" });

    const found = await findUserById(seeded.id, { db });
    expect(found).toMatchObject({
      id: seeded.id,
      email: "ada@cornell.edu",
      name: "Ada",
      role: "admin",
      banned: false,
    });
  });

  it("answers null for an unknown id, and for no id at all", async () => {
    expect(await findUserById("nobody", { db })).toBeNull();
    expect(await findUserById("", { db })).toBeNull();
  });
});

describe("countUsersWithRole", () => {
  it("counts the holders of a role", async () => {
    await seed("a@cornell.edu", "super_admin");
    await seed("b@cornell.edu", "super_admin");
    await seed("c@cornell.edu", "user");

    expect(await countUsersWithRole("super_admin", { db })).toBe(2);
    expect(await countUsersWithRole("admin", { db })).toBe(0);
  });

  it("excludes the person about to be changed — 'who would be left?'", async () => {
    const only = await seed("only@cornell.edu", "super_admin");

    expect(await countUsersWithRole("super_admin", { db })).toBe(1);
    expect(
      await countUsersWithRole("super_admin", { db, excludeUserId: only.id })
    ).toBe(0);
  });

  it("does not count a banned holder — they resolve to anonymous and can undo nothing", async () => {
    await seed("banned-director@cornell.edu", "super_admin", { banned: true });
    await seed("director@cornell.edu", "super_admin");

    expect(await countUsersWithRole("super_admin", { db })).toBe(1);
  });

  it("counts a holder whose `banned` column is null, not just one that is false", async () => {
    // `banned <> true` is unknown for a null in SQL, so a naive filter would
    // quietly report zero super admins and refuse every demotion.
    await seed("nullban@cornell.edu", "super_admin");
    await db.update(user).set({ banned: null }).where(eq(user.email, "nullban@cornell.edu"));

    expect(await countUsersWithRole("super_admin", { db })).toBe(1);
  });
});

describe("listAssignableStaff", () => {
  it("returns the admin roles a ticket can be handed to, by name", async () => {
    await seed("casey@cornell.edu", "user", { name: "Casey" });
    await seed("niti@cornell.edu", "admin", { name: "Niti" });
    await seed("isaac@cornell.edu", "super_admin", { name: "Isaac" });

    const staff = await listAssignableStaff({ db });

    expect(staff.map((person) => person.name)).toEqual(["Isaac", "Niti"]);
  });

  it("leaves out a banned account, which cannot sign in to see the ticket", async () => {
    await seed("niti@cornell.edu", "admin", { name: "Niti" });
    await seed("gone@cornell.edu", "admin", { name: "Gone", banned: true });

    expect((await listAssignableStaff({ db })).map((person) => person.name)).toEqual(["Niti"]);
  });

  it("is empty when nobody holds an admin role yet", async () => {
    await seed("casey@cornell.edu", "user");

    expect(await listAssignableStaff({ db })).toEqual([]);
  });
});
