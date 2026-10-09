// @vitest-environment node
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describeDbError } from "./describe-error";
import { getDb, resetDbForTests } from "./client";
import { user as users } from "./schema/index";

/**
 * A failed write is logged without the values it tried to write: Drizzle's
 * message lists every bound parameter, and the driver's `detail` repeats the
 * conflicting key.
 */
describe("describeDbError", () => {
  afterAll(() => resetDbForTests());

  it("keeps the SQLSTATE and constraint and drops the params and the driver's detail", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "user_email_unique"'), {
      code: "23505",
      constraint: "user_email_unique",
      table: "user",
      detail: "Key (email)=(ada@cornell.edu) already exists.",
    });
    const error = new DrizzleQueryError('insert into "user" ("email", "name") values ($1, $2)', ["ada@cornell.edu", "Ada"], cause);

    const line = describeDbError(error);

    expect(line).toBe("DrizzleQueryError (SQLSTATE 23505, constraint user_email_unique, table user)");
    expect(line).not.toContain("ada@cornell.edu");
    expect(line).not.toContain("Ada");
  });

  it("says only that a query failed when there is no SQLSTATE (a dropped connection)", () => {
    const error = new DrizzleQueryError("insert into usage_gaps values ($1)", ["how do I resin print?"], new Error("socket hang up"));
    expect(describeDbError(error)).toBe("DrizzleQueryError");
  });

  it("keeps an app error's own name and message", () => {
    expect(describeDbError(new TypeError("unit has no tool"))).toBe("TypeError: unit has no tool");
    expect(describeDbError("boom")).toBe("non-Error thrown (string)");
  });

  it("describes a real failed insert without the row's values", async () => {
    const db = await getDb();
    const email = `describe-${Date.now()}@cornell.edu`;
    const row = { id: `u-${Date.now()}`, name: "Private Person", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
    await db.insert(users).values(row);

    const failure = await db
      .insert(users)
      .values({ ...row, id: `${row.id}-2` })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    // The raw message would carry the values; the description must not.
    expect((failure as Error).message).toContain(email);
    const line = describeDbError(failure);
    expect(line).toMatch(/SQLSTATE 23505/);
    expect(line).not.toContain(email);
    expect(line).not.toContain("Private Person");
  });
});
