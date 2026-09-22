// @vitest-environment node
import { eq } from "drizzle-orm";

import { getDb, resetDbForTests } from "../db/client";
import { auditEvents, session, user } from "../db/schema/index";
import { listAuditEvents } from "../data/audit";
import { seedUser } from "../../../test/utils/session";
import { reconcileSuperAdminFloor } from "./floor-role";
import type { Identity } from "./identity";

/**
 * `reconcileSuperAdminFloor` on its own, over PGlite. The behaviour in context
 * — a floor address actually performing a `/admin/users` write — is asserted in
 * `src/app/admin/users/actions.test.ts`; this file pins the branches directly,
 * because the one thing a function that *raises* a role must never do is raise
 * one it was not asked to.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");

  const db = await getDb();
  await db.delete(auditEvents);
  await db.delete(session);
  await db.delete(user);
});

afterAll(() => {
  resetDbForTests();
});

/** The identity `resolveIdentity` would hand back for a signed-in person. */
function identityFor(
  person: { id: string; email: string },
  role: Identity["role"] = "super_admin"
): Identity {
  return {
    role,
    userId: person.id,
    email: person.email,
    name: null,
    rateLimitKey: `user:${person.id}`,
  };
}

async function roleOf(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row?.role;
}

describe("reconcileSuperAdminFloor", () => {
  it("writes the floor onto a row that says something lesser", async () => {
    const person = await seedUser({ email: "founder@cornell.edu", role: "user" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await reconcileSuperAdminFloor(identityFor(person))).toBe(true);
    expect(await roleOf(person.id)).toBe("super_admin");
  });

  it("writes nothing when the row already agrees", async () => {
    const person = await seedUser({ email: "founder@cornell.edu", role: "super_admin" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await reconcileSuperAdminFloor(identityFor(person))).toBe(false);
    expect(await listAuditEvents()).toEqual([]);
  });

  it("leaves an address the floor does not name alone", async () => {
    const person = await seedUser({ email: "someone@cornell.edu", role: "user" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await reconcileSuperAdminFloor(identityFor(person))).toBe(false);
    expect(await roleOf(person.id)).toBe("user");
  });

  it("does nothing at all when no floor is configured", async () => {
    const person = await seedUser({ email: "founder@cornell.edu", role: "user" });

    expect(await reconcileSuperAdminFloor(identityFor(person))).toBe(false);
    expect(await roleOf(person.id)).toBe("user");
  });

  it("refuses a floor entry outside the allowed domain", async () => {
    // `isSuperAdminFloor` applies the domain rule, and so must anything that
    // writes a role from it: a typo in the env list has to fail closed.
    const person = await seedUser({ email: "outsider@example.com", role: "user" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "outsider@example.com");

    expect(await reconcileSuperAdminFloor(identityFor(person))).toBe(false);
    expect(await roleOf(person.id)).toBe("user");
  });

  it("does nothing for an anonymous identity", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    const anonymous: Identity = {
      role: "anonymous",
      userId: null,
      email: "founder@cornell.edu",
      name: null,
      rateLimitKey: "ip:abc",
    };
    expect(await reconcileSuperAdminFloor(anonymous)).toBe(false);
  });

  it("does nothing when the id names no row", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    const ghost = identityFor({ id: "deleted-mid-request", email: "founder@cornell.edu" });
    expect(await reconcileSuperAdminFloor(ghost)).toBe(false);
    expect(await listAuditEvents()).toEqual([]);
  });
});
