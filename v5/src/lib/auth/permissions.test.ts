import {
  ADMIN_SURFACE_PERMISSIONS,
  PERMISSIONS,
  ac,
  can,
  canReachAdmin,
  isGrantedRole,
  roles,
  statement,
  type Permission,
} from "@/lib/auth/permissions";
import { IDENTITY_ROLES, type Role } from "@/lib/auth/roles";

/**
 * Spec §10's permissions unit: every role against every permission, as a table.
 * No environment, no database — the declaration is the whole subject, and a
 * change to it should either be intended and visible here, or a failure.
 */

/** The app-level permissions, in the order the spec's §3.5 sketch lists them. */
const APP_PERMISSIONS = [
  "projects.submit",
  "projects.moderate",
  "catalog.view_drafts",
  "tools.add",
  "tools.approve",
  "tools.edit",
  "tools.publish",
  "maintenance.manage",
  "feedback.manage",
  "mirror.manage",
  "users.manage",
] as const satisfies readonly Permission[];

/**
 * What each role holds, spelled out rather than derived from the declaration —
 * a test that recomputed the answer from the thing under test would pass no
 * matter what the declaration said.
 */
const EXPECTED: Record<Role, readonly Permission[]> = {
  anonymous: [],
  user: ["projects.submit"],
  admin: [
    "projects.submit",
    "projects.moderate",
    "catalog.view_drafts",
    "tools.add",
    "tools.approve",
    "tools.edit",
    "tools.publish",
    "maintenance.manage",
    "feedback.manage",
    "mirror.manage",
  ],
  super_admin: APP_PERMISSIONS,
};

describe("the declaration", () => {
  it("covers every app resource the spec names", () => {
    expect(Object.keys(statement)).toEqual(
      expect.arrayContaining([
        "projects",
        "catalog",
        "tools",
        "maintenance",
        "feedback",
        "mirror",
        "users",
      ])
    );
  });

  it("includes the admin plugin's own resources", () => {
    // Not decoration: the plugin authorizes `set-role` against
    // `{ user: ["set-role"] }`. Without these, every admin endpoint would
    // refuse everybody, super admins included.
    expect(statement).toHaveProperty("user");
    expect(statement).toHaveProperty("session");
    expect(ac.statements).toBe(statement);
  });

  it("derives PERMISSIONS from the statement", () => {
    for (const permission of APP_PERMISSIONS) {
      expect(PERMISSIONS).toContain(permission);
    }
    expect(PERMISSIONS).toContain("user.set-role");
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("declares exactly the three stored roles", () => {
    expect(Object.keys(roles)).toEqual(["user", "admin", "super_admin"]);
    expect(isGrantedRole("anonymous")).toBe(false);
    expect(isGrantedRole(null)).toBe(false);
  });
});

describe("can(role, permission)", () => {
  for (const role of IDENTITY_ROLES) {
    for (const permission of APP_PERMISSIONS) {
      const expected = EXPECTED[role].includes(permission);
      it(`${role} ${expected ? "holds" : "does not hold"} ${permission}`, () => {
        expect(can({ role }, permission)).toBe(expected);
      });
    }
  }

  it("gives super_admin every app permission", () => {
    for (const permission of APP_PERMISSIONS) {
      expect([permission, can({ role: "super_admin" }, permission)]).toEqual([
        permission,
        true,
      ]);
    }
  });

  it("gives super_admin the account-management actions /admin/users performs", () => {
    for (const permission of [
      "user.list",
      "user.get",
      "user.set-role",
      "user.ban",
      "user.update",
      "session.list",
      "session.revoke",
    ] as const) {
      expect([permission, can({ role: "super_admin" }, permission)]).toEqual([
        permission,
        true,
      ]);
    }
  });

  it("withholds the plugin actions v5 deliberately never performs", () => {
    // Impersonation: v5 never signs in as somebody else, and a capability
    // nobody holds is one nobody can be tricked into using. Create / delete /
    // set-password / set-email: accounts come from Google sign-in and nowhere
    // else, and there is no password to set.
    for (const permission of [
      "user.impersonate",
      "user.impersonate-admins",
      "user.create",
      "user.delete",
      "user.set-password",
      "user.set-email",
      "session.delete",
    ] as const) {
      expect([permission, can({ role: "super_admin" }, permission)]).toEqual([
        permission,
        false,
      ]);
    }
  });

  it("gives an admin no account-management power", () => {
    // The difference between `admin` and `super_admin` is exactly this: a
    // SuperMaker runs the catalogue, a director decides who is who.
    expect(can({ role: "admin" }, "users.manage")).toBe(false);
    expect(can({ role: "admin" }, "user.set-role")).toBe(false);
    expect(can({ role: "admin" }, "user.ban")).toBe(false);
  });

  it("gives anonymous nothing at all", () => {
    for (const permission of PERMISSIONS) {
      expect(can({ role: "anonymous" }, permission)).toBe(false);
    }
  });

  it("treats an absent subject as holding nothing", () => {
    expect(can(null, "projects.submit")).toBe(false);
    expect(can(undefined, "projects.submit")).toBe(false);
    expect(can({ role: null }, "projects.submit")).toBe(false);
    expect(can({ role: undefined }, "projects.submit")).toBe(false);
  });

  it("treats a role outside the vocabulary as holding nothing", () => {
    // A restored backup from the env-list era, or a hand-written UPDATE.
    expect(can({ role: "staff" as Role }, "tools.add")).toBe(false);
    expect(can({ role: "root" as Role }, "tools.add")).toBe(false);
  });

  it("returns false for a malformed permission rather than throwing", () => {
    // A typo in a gate must fail closed, and must not 500 the page it guards.
    const malformed = ["", ".", "tools", "tools.", ".add", "tools.nope", "nope.manage"];
    for (const value of malformed) {
      expect(() => can({ role: "super_admin" }, value as Permission)).not.toThrow();
      expect(can({ role: "super_admin" }, value as Permission)).toBe(false);
    }
  });

  it("does not read the environment", () => {
    // The floor lives in `super-admins.ts`; the declaration is pure. A role
    // env var must not be able to grant anything here.
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    expect(can({ role: "user" }, "users.manage")).toBe(false);
  });
});

// ── The admin surface (spec §6) ─────────────────────────────────────

describe("canReachAdmin", () => {
  it("lets a SuperMaker and a director in", () => {
    // Both see the header link and get past `/admin`'s layout; what each can
    // actually open is the individual page's own check.
    expect(canReachAdmin({ role: "admin" })).toBe(true);
    expect(canReachAdmin({ role: "super_admin" })).toBe(true);
  });

  it("keeps everyone else out", () => {
    // Signing in unlocks submitting a project; it opens no admin surface.
    expect(canReachAdmin({ role: "user" })).toBe(false);
    expect(canReachAdmin({ role: "anonymous" })).toBe(false);
    expect(canReachAdmin(null)).toBe(false);
    expect(canReachAdmin(undefined)).toBe(false);
    expect(canReachAdmin({ role: undefined })).toBe(false);
  });

  it("is exactly 'holds one of the listed permissions', with no list of its own", () => {
    // The helper exists so the header and the layout cannot disagree about
    // what an admin surface is. This is the assertion that keeps it honest.
    for (const role of ["anonymous", "user", "admin", "super_admin"] as const) {
      const expected = ADMIN_SURFACE_PERMISSIONS.some((permission) =>
        can({ role }, permission)
      );
      expect(canReachAdmin({ role })).toBe(expected);
    }
  });

  it("lists only permissions that exist in the statement", () => {
    for (const permission of ADMIN_SURFACE_PERMISSIONS) {
      expect(PERMISSIONS).toContain(permission);
    }
  });
});
