// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, session, user } from "../../../lib/db/schema/index";
import { listAuditEvents } from "../../../lib/data/audit";
import { findUserById } from "../../../lib/data/users";
import { seedUser, signInAs, signInAsNew } from "../../../../test/utils/session";
import { setUserBanned, setUserRole } from "./actions";

/**
 * The two `/admin/users` writes, end to end over PGlite: a real Better Auth
 * instance, real session rows, the real admin plugin, the real audit table.
 * The only things stubbed are the two Next modules that need a request scope —
 * `next/headers` (fed a cookie `test/utils/session.ts` minted) and
 * `next/cache`. No network, no Google, no `DATABASE_URL` (Article 3).
 *
 * `resetAuthForTests()` runs in both hooks: `getAuth()` memoizes on the env
 * fingerprint *and* the substrate, so a test that stubs `AUTH_SECRET` and one
 * that resets the database must not share an instance.
 */

const AUTH_SECRET = "admin-users-actions-test-secret";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();

  // The demo seed ships one account per role; these tests build their own
  // cast, so the table starts empty and a count of super admins means what it
  // says. Sessions and audit rows go with them (cascade / explicit).
  const db = await getDb();
  await db.delete(auditEvents);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** Sign in as a director and point `next/headers` at their cookie. */
async function asDirector(email = "director@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "super_admin", name: "Dee Rector" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function roleOf(userId: string) {
  return (await findUserById(userId))?.role;
}

// ── Who may call these at all (§8) ──────────────────────────────────

describe("the permission gate", () => {
  it("refuses an anonymous caller and changes nothing", async () => {
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    setMockHeaders();

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_signed_in",
    });
    expect(await roleOf(target.id)).toBe("user");
    expect(await listAuditEvents()).toEqual([]);
  });

  it("refuses an ordinary signed-in user", async () => {
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    const caller = await signInAsNew({ email: "someone@cornell.edu", role: "user" });
    setMockHeaders({ cookie: caller.cookie });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_permitted",
    });
    expect(await roleOf(target.id)).toBe("user");
  });

  it("refuses a SuperMaker — `users.manage` belongs to the director alone", async () => {
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    const caller = await signInAsNew({ email: "maker@cornell.edu", role: "admin" });
    setMockHeaders({ cookie: caller.cookie });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_permitted",
    });
    expect(await listAuditEvents()).toEqual([]);
  });

  it("refuses a forged cookie rather than trusting it", async () => {
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    const director = await signInAsNew({
      email: "director@cornell.edu",
      role: "super_admin",
    });
    setMockHeaders({ cookie: director.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")) });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_signed_in",
    });
  });

  it("refuses a banned director — a ban bites on the next request", async () => {
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    const banned = await seedUser({
      email: "expired@cornell.edu",
      role: "super_admin",
      banned: true,
    });
    const signedIn = await signInAs(banned);
    setMockHeaders({ cookie: signedIn.cookie });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_signed_in",
    });
  });

  it("is bounded before it checks anything (Article 4, §8: 120/min)", async () => {
    // The limiter is a per-process singleton and an anonymous caller is keyed
    // by a hash of their IP, so this test needs an address no other test in
    // the file shares — otherwise it inherits their spent allowance.
    setMockHeaders({ "x-forwarded-for": "198.51.100.7" });

    // Anonymous, so every call is refused on the permission check — until the
    // 121st, which is refused *before* it, which is the ordering under test.
    const results: string[] = [];
    for (let i = 0; i < 121; i += 1) {
      const result = await setUserRole({ userId: "whoever", role: "admin" });
      if (!result.ok) results.push(result.error);
    }

    expect(results.slice(0, 120).every((error) => error === "not_signed_in")).toBe(true);
    expect(results[120]).toBe("rate_limited");
  });
});

// ── Changing a role (§5.2) ──────────────────────────────────────────

describe("setUserRole", () => {
  it("promotes a student to SuperMaker and writes exactly one audit event", async () => {
    const director = await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
    });
    expect(await roleOf(target.id)).toBe("admin");

    const events = await listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: director.user.id,
      action: "role.changed",
      subjectType: "user",
      subjectId: target.id,
      // Both halves: "became an admin" is unanswerable later without the from.
      detail: { from: "user", to: "admin" },
    });
  });

  it("revalidates the page so the roster shows the change", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    await setUserRole({ userId: target.id, role: "admin" });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/users");
  });

  it("treats a change to the role they already hold as a no-op with no event", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: target.id, role: "user" })).toEqual({
      ok: true,
      role: "user",
    });
    expect(await listAuditEvents()).toEqual([]);
  });

  it("refuses a role outside the vocabulary", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: target.id, role: "staff" })).toEqual({
      ok: false,
      error: "invalid_role",
    });
    expect(await roleOf(target.id)).toBe("user");
  });

  it("refuses an id that names nobody", async () => {
    await asDirector();

    expect(await setUserRole({ userId: "nobody-here", role: "admin" })).toEqual({
      ok: false,
      error: "unknown_user",
    });
  });

  it("refuses to demote an address on the super-admin floor, and says why", async () => {
    await asDirector();
    const floor = await seedUser({ email: "founder@cornell.edu", role: "super_admin" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await setUserRole({ userId: floor.id, role: "user" })).toEqual({
      ok: false,
      error: "protected_floor",
    });
    // The row is untouched, which is the half that matters: a refusal that
    // half-applied would be worse than no refusal at all.
    expect(await roleOf(floor.id)).toBe("super_admin");
    expect(await listAuditEvents()).toEqual([]);
  });

  it("still allows *promoting* a floor address — the floor is a floor, not a freeze", async () => {
    await asDirector();
    const floor = await seedUser({ email: "founder@cornell.edu", role: "super_admin" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await setUserRole({ userId: floor.id, role: "super_admin" })).toEqual({
      ok: true,
      role: "super_admin",
    });
  });

  it("refuses the last director demoting themselves (spec §10)", async () => {
    const director = await asDirector();

    expect(await setUserRole({ userId: director.user.id, role: "user" })).toEqual({
      ok: false,
      error: "last_super_admin",
    });
    expect(await roleOf(director.user.id)).toBe("super_admin");
  });

  it("allows a director to step down once somebody else holds the role", async () => {
    const director = await asDirector();
    await seedUser({ email: "successor@cornell.edu", role: "super_admin" });

    expect(await setUserRole({ userId: director.user.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
    });
    expect(await roleOf(director.user.id)).toBe("admin");
  });
});

// ── Banning (§5.2) ──────────────────────────────────────────────────

describe("setUserBanned", () => {
  it("bans with a reason, records it, and deletes the person's sessions", async () => {
    const director = await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });
    await signInAs(target);

    expect(
      await setUserBanned({ userId: target.id, banned: true, reason: "Ignored the rules" })
    ).toEqual({ ok: true, banned: true });

    const stored = await findUserById(target.id);
    expect(stored).toMatchObject({ banned: true, banReason: "Ignored the rules" });

    // The plugin deletes their sessions, so the ban bites mid-visit rather
    // than at expiry — and `resolveIdentity` would refuse them regardless.
    const db = await getDb();
    const rows = await db.select().from(session).where(eq(session.userId, target.id));
    expect(rows).toEqual([]);

    const events = await listAuditEvents();
    expect(events[0]).toMatchObject({
      actorUserId: director.user.id,
      action: "user.banned",
      subjectId: target.id,
      detail: { banned: true, reason: "Ignored the rules" },
    });
  });

  it("lifts a ban, recorded as the same action with `banned: false`", async () => {
    await asDirector();
    const target = await seedUser({
      email: "student@cornell.edu",
      role: "user",
      banned: true,
    });

    expect(await setUserBanned({ userId: target.id, banned: false })).toEqual({
      ok: true,
      banned: false,
    });
    expect((await findUserById(target.id))?.banned).toBe(false);

    const events = await listAuditEvents();
    expect(events[0]).toMatchObject({ action: "user.banned", detail: { banned: false } });
  });

  it("refuses to ban a floor address", async () => {
    await asDirector();
    const floor = await seedUser({ email: "founder@cornell.edu", role: "super_admin" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");

    expect(await setUserBanned({ userId: floor.id, banned: true })).toEqual({
      ok: false,
      error: "protected_floor",
    });
    expect((await findUserById(floor.id))?.banned).toBe(false);
  });

  it("refuses to ban yourself", async () => {
    const director = await asDirector();
    await seedUser({ email: "successor@cornell.edu", role: "super_admin" });

    expect(await setUserBanned({ userId: director.user.id, banned: true })).toEqual({
      ok: false,
      error: "self_ban",
    });
    expect((await findUserById(director.user.id))?.banned).toBe(false);
  });

  it("allows banning another director — the caller is still one", async () => {
    // There is deliberately no "last director" guard on the ban path: reaching
    // it means the *caller* holds `users.manage`, so the lab keeps one.
    await asDirector();
    const other = await seedUser({ email: "other@cornell.edu", role: "super_admin" });

    expect(await setUserBanned({ userId: other.id, banned: true })).toEqual({
      ok: true,
      banned: true,
    });
    expect((await findUserById(other.id))?.banned).toBe(true);
  });

  it("is a no-op when the account is already in that state", async () => {
    await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserBanned({ userId: target.id, banned: false })).toEqual({
      ok: true,
      banned: false,
    });
    expect(await listAuditEvents()).toEqual([]);
  });
});

// ── The floor has to reach the plugin, not just `can()` (§3.4) ──────

describe("a floor address whose row has not caught up", () => {
  /**
   * The regression this guards. `AUTH_SUPER_ADMIN_EMAILS` is applied in two
   * places — `databaseHooks.user.create.before`, which only runs at first
   * sign-in, and `identityFromSession`, which overrides the resolved role. The
   * *plugin* reads `session.user.role` off the row and sees neither. So a floor
   * address added after that person had already signed in, or a `super_admin`
   * demoted by a restored backup, reached `/admin/users` with every control
   * live (the app says they are a director) and every save returning `failed`
   * (the plugin says they are a `user`) — the exact lock-out the floor exists
   * to undo, with no hint in the message about why.
   */
  async function asFloorAddressStoredAs(role: "user" | "admin") {
    const signedIn = await signInAsNew({
      email: "founder@cornell.edu",
      role,
      name: "Fran Ounder",
    });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    setMockHeaders({ cookie: signedIn.cookie });
    return signedIn;
  }

  it("can still change a role, and the row catches up", async () => {
    const caller = await asFloorAddressStoredAs("user");
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: true,
      role: "admin",
    });
    expect(await roleOf(target.id)).toBe("admin");
    // Reconciled rather than special-cased: the table now shows the role the
    // app has been reporting all along.
    expect(await roleOf(caller.user.id)).toBe("super_admin");
  });

  it("can still ban somebody", async () => {
    await asFloorAddressStoredAs("admin");
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserBanned({ userId: target.id, banned: true })).toEqual({
      ok: true,
      banned: true,
    });
    expect((await findUserById(target.id))?.banned).toBe(true);
  });

  it("records the reconciliation as the role change it is", async () => {
    const caller = await asFloorAddressStoredAs("user");
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    await setUserRole({ userId: target.id, role: "admin" });

    const events = await listAuditEvents();
    const reconciliation = events.find((event) => event.subjectId === caller.user.id);
    // Null actor: the environment did this, not a person who clicked something.
    expect(reconciliation).toMatchObject({
      action: "role.changed",
      actorUserId: null,
      detail: { from: "user", to: "super_admin", reason: "super_admin_floor" },
    });
  });

  it("reconciles once, not on every action", async () => {
    const caller = await asFloorAddressStoredAs("user");
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    await setUserRole({ userId: target.id, role: "admin" });
    await setUserRole({ userId: target.id, role: "user" });

    const forCaller = (await listAuditEvents()).filter(
      (event) => event.subjectId === caller.user.id
    );
    expect(forCaller).toHaveLength(1);
  });

  it("leaves a director who is not on the floor exactly as they were", async () => {
    const director = await asDirector();
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    await setUserRole({ userId: target.id, role: "admin" });

    // One event, for the target. Nothing was written about the caller.
    expect((await listAuditEvents()).map((event) => event.subjectId)).toEqual([
      target.id,
    ]);
    expect(await roleOf(director.user.id)).toBe("super_admin");
  });

  it("does not promote an ordinary user who merely shares a prefix with the floor", async () => {
    // `isSuperAdminFloor` matches the whole normalized address; a reconciler
    // that matched loosely would be a privilege escalation, not a repair.
    const caller = await signInAsNew({ email: "founder2@cornell.edu", role: "user" });
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "founder@cornell.edu");
    setMockHeaders({ cookie: caller.cookie });
    const target = await seedUser({ email: "student@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: target.id, role: "admin" })).toEqual({
      ok: false,
      error: "not_permitted",
    });
    expect(await roleOf(caller.user.id)).toBe("user");
  });
});
