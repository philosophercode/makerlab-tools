// @vitest-environment node
import { eq } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { createPgliteDb } from "../pglite";
import { account, session, user } from "./auth";
import { auditEvents } from "./audit";
import { tools } from "./tools";
import type { Db } from "../types";

/**
 * Migration `0003` against a real (in-process) Postgres. Better Auth writes
 * these rows in production, but the *shape* is ours — the role CHECK, the
 * unique email, the cascade, and the `created_by` foreign key Phase 1 deferred
 * to this migration. Each of those is a thing that can only fail at runtime,
 * so each one is asserted here rather than read off the schema file.
 */
describe("Better Auth schema", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  async function insertUser(over: Partial<typeof user.$inferInsert> = {}) {
    const id = over.id ?? `u-${Math.random().toString(36).slice(2)}`;
    await db.insert(user).values({
      id,
      name: over.name ?? "Test Person",
      email: over.email ?? `${id}@cornell.edu`,
      ...over,
    });
    return id;
  }

  it("defaults a new user to the least-privileged stored role", async () => {
    const id = await insertUser();
    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row.role).toBe("user");
    expect(row.banned).toBe(false);
    expect(row.emailVerified).toBe(false);
  });

  it("accepts every role in the vocabulary", async () => {
    for (const role of ["user", "admin", "super_admin"] as const) {
      const id = await insertUser({ role });
      const [row] = await db.select().from(user).where(eq(user.id, id));
      expect(row.role).toBe(role);
    }
  });

  it("refuses a role outside the vocabulary", async () => {
    // "staff" was a role in the env-list era. The CHECK is what stops a stale
    // script, or a hand-written UPDATE, reintroducing a word nothing grants.
    await expectViolation(insertUser({ role: "staff" }), /user_role_check/);
  });

  it("refuses a duplicate email", async () => {
    await insertUser({ email: "dup@cornell.edu" });
    await expectViolation(insertUser({ email: "dup@cornell.edu" }), /user_email_unique/);
  });

  it("refuses a duplicate session token", async () => {
    const userId = await insertUser();
    const row = {
      token: "same-token",
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await db.insert(session).values({ id: "s-dup-1", ...row });
    await expectViolation(
      db.insert(session).values({ id: "s-dup-2", ...row }),
      /session_token_unique/
    );
  });

  it("cascades a user delete to their sessions and accounts", async () => {
    const userId = await insertUser();
    await db.insert(session).values({
      id: "s-cascade",
      token: "cascade-token",
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(account).values({
      id: "a-cascade",
      accountId: "google-sub-1",
      providerId: "google",
      userId,
    });

    await db.delete(user).where(eq(user.id, userId));

    expect(await db.select().from(session).where(eq(session.userId, userId))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
  });

  it("refuses a created_by that names no user, and accepts null", async () => {
    // The foreign key Phase 1 deferred. Null is the normal case: imported rows
    // and demo-seed rows have no author.
    await expectViolation(
      db.insert(tools).values({
        slug: "ghost-author",
        name: "Ghost Author",
        createdBy: "no-such-user",
      }),
      /tools_created_by_user_id_fk/
    );

    await db.insert(tools).values({ slug: "no-author", name: "No Author" });
    const [row] = await db.select().from(tools).where(eq(tools.slug, "no-author"));
    expect(row.createdBy).toBeNull();
  });

  it("keeps a tool alive when its author is deleted", async () => {
    const userId = await insertUser();
    await db.insert(tools).values({ slug: "authored", name: "Authored", createdBy: userId });

    await db.delete(user).where(eq(user.id, userId));

    const [row] = await db.select().from(tools).where(eq(tools.slug, "authored"));
    expect(row).toBeDefined();
    expect(row.createdBy).toBeNull();
  });

  it("refuses an audit event whose actor names no user", async () => {
    await expectViolation(
      db.insert(auditEvents).values({
        actorUserId: "no-such-user",
        action: "role.changed",
        subjectType: "user",
        subjectId: "someone",
      }),
      /audit_events_actor_user_id_user_id_fk/
    );
  });
});
