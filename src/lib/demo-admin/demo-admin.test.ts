import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { visitorIdentity, type Identity } from "@/lib/auth/identity";
import { PERMISSIONS, can, canReachAdmin, canView } from "@/lib/auth/permissions";
import { surfacesFor } from "@/lib/admin/surfaces";
import { canActOnPendingTool } from "@/lib/intake/access";
import { canSeeMap } from "@/lib/map/access";
import { audienceFor } from "@/lib/usage/events";
import { DEMO_ACTOR_ID, demoAdminEnabled, demoAdminMode, demoAdminReadOnly, hasNoSession, isDemoTraffic } from "@/lib/demo-admin/config";
import { emailFor, maskEmail, maskEmailsFor } from "@/lib/demo-admin/mask-email";
import { isSamplePerson, samplePeople } from "@/lib/demo-admin/sample-people";
import { UsersTable } from "@/components/admin/UsersTable";
import type { RosterRow } from "@/components/admin/UsersRoster";
import type { UserRecord } from "@/lib/data/users";

/**
 * Demo admin mode (demo admin spec 2026-10-11): who the demo identity is,
 * what it may see, the little it may write, and what it never sees.
 */

const anonymous: Identity = { role: "anonymous", userId: null, email: null, name: null, rateLimitKey: "ip:abc" };
const demo: Identity = { role: "demo_admin", userId: null, email: null, name: "Demo visitor", rateLimitKey: "ip:abc" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the flag", () => {
  it("is off unless DEMO_ADMIN is 1 or true", () => {
    vi.stubEnv("DEMO_ADMIN", "");
    expect(demoAdminEnabled()).toBe(false);
    vi.stubEnv("DEMO_ADMIN", "yes");
    expect(demoAdminEnabled()).toBe(false);
    vi.stubEnv("DEMO_ADMIN", "1");
    expect(demoAdminEnabled()).toBe(true);
    vi.stubEnv("DEMO_ADMIN", "true");
    expect(demoAdminEnabled()).toBe(true);
  });

  it("reads DEMO_ADMIN=view as the read-only public mode, and 1 or true as the booth", () => {
    for (const [raw, mode] of [["", "off"], ["yes", "off"], ["1", "booth"], ["TRUE", "booth"], ["view", "view"], [" View ", "view"], ["viewer", "off"]] as const) {
      vi.stubEnv("DEMO_ADMIN", raw);
      expect(demoAdminMode(), raw).toBe(mode);
      expect(demoAdminEnabled(), raw).toBe(mode !== "off");
      expect(demoAdminReadOnly(), raw).toBe(mode === "view");
    }
  });

  it("makes a visitor with no session the same demo identity in view mode, marked read-only", () => {
    vi.stubEnv("DEMO_ADMIN", "view");
    expect(visitorIdentity(anonymous)).toEqual({ ...demo, readOnly: true });
    vi.stubEnv("DEMO_ADMIN", "1");
    expect(visitorIdentity(anonymous)).not.toHaveProperty("readOnly");
  });

  it("leaves a visitor with no session anonymous when off — exactly as before", () => {
    vi.stubEnv("DEMO_ADMIN", "");
    expect(visitorIdentity(anonymous)).toBe(anonymous);
  });

  it("makes a visitor with no session the demo identity when on, keeping the per-IP key and no user id", () => {
    vi.stubEnv("DEMO_ADMIN", "1");
    const identity = visitorIdentity(anonymous);
    expect(identity).toEqual({ role: "demo_admin", userId: null, email: null, name: "Demo visitor", rateLimitKey: "ip:abc" });
    expect(hasNoSession(identity)).toBe(true);
  });
});

describe("what the demo identity may see", () => {
  it("reaches /admin and every surface but the personal ones", () => {
    expect(canReachAdmin(demo)).toBe(true);
    const keys = surfacesFor(demo).map((surface) => surface.key);
    expect(keys).toEqual(expect.arrayContaining(["maintenance", "inventory", "intake", "users", "insights", "taxonomy", "settings"]));
    expect(keys).not.toContain("mirror");
    expect(keys).not.toContain("proposals");
    expect(canView(demo, "users.manage")).toBe(true);
    expect(canView(demo, "insights.view")).toBe(true);
  });

  it("sees the floor map", () => {
    expect(canSeeMap(demo)).toBe(true);
    expect(canSeeMap(anonymous)).toBe(false);
  });
});

describe("what the demo identity may do", () => {
  it("may add equipment", () => {
    expect(can(demo, "tools.add")).toBe(true);
  });

  it.each([
    "tools.edit",
    "tools.approve",
    "tools.publish",
    "taxonomy.manage",
    "mirror.manage",
    "users.manage",
    "insights.configure",
    "insights.view",
    "insights.export",
    "catalog.export",
    "projects.moderate",
    "maintenance.manage",
    "feedback.manage",
    "shifts.set",
    "chat.illustrate",
    "user.set-role",
    "user.update",
    "session.revoke",
  ] as const)("may not %s", (permission) => {
    expect(can(demo, permission)).toBe(false);
  });

  it("works only the demo's own pending items", () => {
    expect(canActOnPendingTool(demo, { createdBy: DEMO_ACTOR_ID })).toBe(true);
    expect(canActOnPendingTool(demo, { createdBy: "someone-real" })).toBe(false);
    expect(canActOnPendingTool(demo, { createdBy: null })).toBe(false);
  });

  it("is demo traffic: out of the lab's numbers", () => {
    expect(isDemoTraffic(demo)).toBe(true);
    expect(isDemoTraffic(anonymous)).toBe(false);
    expect(audienceFor("demo_admin")).toBe("demo");
  });
});

// Amendment "A read-only public admin" (2026-10-22).
describe("the read-only public demo (DEMO_ADMIN=view)", () => {
  it("holds no permission at all", () => {
    vi.stubEnv("DEMO_ADMIN", "view");
    for (const permission of PERMISSIONS) expect(can(demo, permission), permission).toBe(false);
  });

  it("sees what the booth demo sees", () => {
    vi.stubEnv("DEMO_ADMIN", "view");
    expect(canReachAdmin(demo)).toBe(true);
    expect(canView(demo, "users.manage")).toBe(true);
    expect(canView(demo, "insights.view")).toBe(true);
    expect(canView(demo, "catalog.view_drafts")).toBe(true);
  });

  // In the browser DEMO_ADMIN is unset; the identity's `readOnly` carries the mode there.
  it("holds nothing in the browser either, where only the identity says read-only", () => {
    vi.stubEnv("DEMO_ADMIN", "");
    for (const permission of PERMISSIONS) expect(can({ ...demo, readOnly: true }, permission), permission).toBe(false);
    expect(can(demo, "tools.add")).toBe(true);
  });

  it("works no pending item, not even one the booth demo left behind", () => {
    vi.stubEnv("DEMO_ADMIN", "view");
    expect(canActOnPendingTool(demo, { createdBy: DEMO_ACTOR_ID })).toBe(false);
  });

  it("leaves a real role exactly as it was", () => {
    vi.stubEnv("DEMO_ADMIN", "view");
    expect(can({ role: "super_admin" }, "tools.publish")).toBe(true);
    expect(can({ role: "user" }, "projects.submit")).toBe(true);
  });
});

describe("addresses", () => {
  it("masks to the first character and the domain", () => {
    expect(maskEmail("isaac@cornell.edu")).toBe("i***@cornell.edu");
    expect(maskEmail("not-an-address")).toBe("***");
    expect(maskEmail(null)).toBeNull();
  });

  it("masks for the demo identity only", () => {
    expect(emailFor(demo, "ada@cornell.edu")).toBe("a***@cornell.edu");
    expect(emailFor({ role: "super_admin" }, "ada@cornell.edu")).toBe("ada@cornell.edu");
    const rows = [{ id: "1", reportedByEmail: "ada@cornell.edu" }];
    expect(maskEmailsFor(demo, rows, "reportedByEmail")[0].reportedByEmail).toBe("a***@cornell.edu");
    expect(maskEmailsFor({ role: "admin" }, rows, "reportedByEmail")).toBe(rows);
  });
});

describe("the People page", () => {
  const real: UserRecord = {
    id: "u1",
    email: "director@cornell.edu",
    name: "Real Director",
    role: "super_admin",
    banned: false,
    banReason: null,
    title: null,
    firstSignedInAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
  const noop = async () => ({ ok: false as const, error: "not_permitted" as const });

  function rosterRows(users: UserRecord[], isDemo: boolean): { rows: RosterRow[]; readOnly?: boolean } {
    const element = UsersTable({
      users,
      demo: isDemo,
      currentUserId: null,
      setRole: noop,
      removeUser: noop as never,
      setTitle: noop as never,
      setName: noop as never,
    }) as ReactElement<{ rows: RosterRow[]; readOnly?: boolean }>;
    return element.props;
  }

  it("has twenty sample people: fifteen users, five admins, no super admin, none real", () => {
    const people = samplePeople();
    expect(people).toHaveLength(20);
    expect(people.filter((person) => person.role === "user")).toHaveLength(15);
    expect(people.filter((person) => person.role === "admin")).toHaveLength(5);
    expect(people.every((person) => person.email.endsWith("@example.edu") && isSamplePerson(person.id))).toBe(true);
  });

  it("hands a demo viewer's browser masked addresses, tagged samples and a read-only roster", () => {
    const { rows, readOnly } = rosterRows([real, ...samplePeople()], true);
    expect(readOnly).toBe(true);
    expect(rows.every((row) => row.email.includes("***@"))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("director@cornell.edu");
    expect(rows.filter((row) => row.sample)).toHaveLength(20);
    expect(rows.find((row) => row.id === "u1")?.sample).toBeUndefined();
  });

  it("is unchanged for a real viewer", () => {
    const { rows, readOnly } = rosterRows([real], false);
    expect(readOnly).toBe(false);
    expect(rows[0].email).toBe("director@cornell.edu");
    expect(rows[0].sample).toBeUndefined();
  });
});
