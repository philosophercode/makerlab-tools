// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

// The one seam `actions.test.ts` cannot have: a database that answers the
// *second* statement with an error. `vi.hoisted` because the `vi.mock` factory
// runs before module scope exists.
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../../../lib/data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (
      event: Parameters<typeof actual.recordAuditEvent>[0],
      options?: Parameters<typeof actual.recordAuditEvent>[1]
    ) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event, options);
    },
  };
});

import { eq } from "drizzle-orm";

import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, blockedEmails, session, user } from "../../../lib/db/schema/index";
import { findUserById } from "../../../lib/data/users";
import { seedUser, signInAsNew } from "../../../../test/utils/session";
import { removeUser, setUserRole } from "./actions";

/**
 * What happens when the change lands and the audit event does not (§4.11).
 *
 * Its own file because it is the only one here that replaces `data/audit.ts`:
 * `actions.test.ts` asserts against the real table, and a module mocked for one
 * test in a file is a module mocked for all of them. The failure is worth
 * provoking because it is not exotic — `auth.api.setRole` commits in its own
 * statement and, on the Neon HTTP driver, the audit insert is a separate
 * request that can fail on its own.
 *
 * **The property under test is that the browser is never told the change failed
 * when it did not.** `RoleSelect` answers a refusal by restoring the previous
 * value, so an exception here would leave the page asserting a role the
 * database no longer holds. (Removal is the exception that proves it: its event
 * is written inside its own transaction, so there a failure really is "nothing
 * happened".)
 */

const AUTH_SECRET = "admin-users-audit-test-secret";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  audit.failing = false;

  const db = await getDb();
  await db.delete(auditEvents);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  audit.failing = false;
  resetAuthForTests();
  resetDbForTests();
});

async function asDirector() {
  const signedIn = await signInAsNew({
    email: "director@cornell.edu",
    role: "super_admin",
    name: "Dee Rector",
  });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

describe("an audit write that fails after the change landed", () => {
  it("reports the role change as a success, with the gap named", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    audit.failing = true;

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
      warning: "audit_unavailable",
    });
    // The half that makes the answer honest: the row really did move.
    expect((await findUserById(target.id))?.role).toBe("admin");
  });

  it("does not throw out of the server action", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    audit.failing = true;

    // A rejected action reaches the island as a caught failure, and the island
    // answers that by putting the old role back — over a database holding the
    // new one.
    await expect(setUserRole({ userId: target.id, role: "admin" })).resolves.toMatchObject(
      { ok: true }
    );
  });

  it("rolls a removal back instead — its audit event is inside the transaction", async () => {
    // The opposite answer from a role change, and deliberately (auth spec
    // amendment 2026-09-25): removal is one transaction the app owns, so a
    // lost event means nothing happened, and the page is told exactly that.
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    audit.failing = true;

    expect(await removeUser({ userId: target.id, block: true })).toEqual({ ok: false, error: "failed" });
    expect(await findUserById(target.id)).not.toBeNull();
    const db = await getDb();
    expect(await db.select().from(blockedEmails)).toEqual([]);
  });

  it("carries no warning when the trail was written", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    // The ordinary path, asserted here too so the warning cannot become a
    // constant that nobody notices is always set.
    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
    });
  });
});

/**
 * The same property, one function earlier.
 *
 * `authorize()` reconciles the super-admin floor *before* the action's own
 * write, and that reconciliation is itself a row UPDATE followed by audit
 * inserts. While those inserts threw, a floor director whose row was stale hit
 * this: their own row was promoted — and any ban on it lifted — and then the
 * throw was caught and returned as `failed`, so the page said "nothing was
 * changed" over a database that had changed two columns and recorded neither.
 *
 * The recovery path is exactly where a silent, unrecorded promotion is least
 * acceptable, which is why it is asserted separately from the actions above.
 */
describe("an audit write that fails during the floor reconciliation", () => {
  it("still performs the action, and names the gap instead of denying it", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    resetAuthForTests();

    // Signed in first, then the row is spoiled behind them: a restored backup
    // or a manual UPDATE, which is the only way a floor row is banned at all.
    const founder = await signInAsNew({
      email: "founder@cornell.edu",
      role: "user",
      name: "Fou Nder",
    });
    setMockHeaders({ cookie: founder.cookie });
    const db = await getDb();
    await db
      .update(user)
      .set({ banned: true, banReason: "mistake" })
      .where(eq(user.id, founder.user.id));

    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    audit.failing = true;

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
      warning: "audit_unavailable",
    });

    // Both rows moved, and the caller is told the trail is incomplete rather
    // than being told nothing happened.
    expect((await findUserById(target.id))?.role).toBe("admin");
    const reconciled = await findUserById(founder.user.id);
    expect(reconciled?.role).toBe("super_admin");
    expect(reconciled?.banned).toBe(false);
  });

  it("warns even when the action itself changes nothing", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    resetAuthForTests();

    const founder = await signInAsNew({
      email: "founder@cornell.edu",
      role: "user",
      name: "Fou Nder",
    });
    setMockHeaders({ cookie: founder.cookie });
    const target = await seedUser({ email: "student@cornell.edu", role: "admin" });
    audit.failing = true;

    // "admin → admin" writes no event of its own, so the only gap in the trail
    // is the reconciliation's — and it is still a gap.
    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
      warning: "audit_unavailable",
    });
    expect((await findUserById(founder.user.id))?.role).toBe("super_admin");
  });
});
