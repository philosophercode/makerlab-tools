import {
  IDENTITY_ROLES,
  allowedEmailDomain,
  isAllowedEmail,
  isRole,
  parseEmailList,
  storedRoleOr,
} from "@/lib/auth/roles";
import { ROLES } from "@/lib/db/schema/vocabulary";

// Every helper reads process.env at call time, so `vi.stubEnv` alone is enough
// — no resetModules()/dynamic import dance (the setup file unstubs after each).

describe("the role vocabulary", () => {
  it("is the stored roles plus anonymous, in that order", () => {
    // The stored list is also what the `user_role_check` constraint is built
    // from, so this is the assertion that keeps the type and the database in
    // step. `anonymous` is never a row — it is the absence of a session.
    expect([...IDENTITY_ROLES]).toEqual(["anonymous", ...ROLES]);
    expect([...ROLES]).toEqual(["user", "admin", "super_admin"]);
  });

  it("no longer carries the env-list role names", () => {
    // `student` and `staff` are gone: a fixture or a script still using them
    // must fail loudly rather than silently resolve to nothing.
    expect(isRole("student")).toBe(false);
    expect(isRole("staff")).toBe(false);
  });

  it("resolves a stored value, and anything else, through storedRoleOr", () => {
    expect(storedRoleOr("admin")).toBe("admin");
    expect(storedRoleOr("super_admin")).toBe("super_admin");
    expect(storedRoleOr("staff")).toBe("anonymous");
    expect(storedRoleOr(null)).toBe("anonymous");
    expect(storedRoleOr(undefined)).toBe("anonymous");
  });
});

describe("allowedEmailDomain", () => {
  it("defaults to the Cornell Tech deployment's domain", () => {
    expect(allowedEmailDomain()).toBe("cornell.edu");
  });

  it("is overridable so the app stays white-labelled", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "Example.EDU");
    expect(allowedEmailDomain()).toBe("example.edu");
  });

  it("tolerates a leading @ in the configured domain", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "@example.edu");
    expect(allowedEmailDomain()).toBe("example.edu");
  });
});

describe("isAllowedEmail", () => {
  it("accepts an address on the allowed domain, case-insensitively", () => {
    expect(isAllowedEmail("abc123@cornell.edu")).toBe(true);
    expect(isAllowedEmail("  ABC123@Cornell.EDU  ")).toBe(true);
  });

  it("rejects a non-institutional address", () => {
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
  });

  it("rejects a look-alike domain that merely ends with the same letters", () => {
    // "evilcornell.edu" ends with "cornell.edu" as a substring — the @ anchor
    // is what stops it from passing.
    expect(isAllowedEmail("someone@evilcornell.edu")).toBe(false);
  });

  it("rejects a subdomain that was not configured", () => {
    expect(isAllowedEmail("someone@mail.cornell.edu")).toBe(false);
  });

  it("rejects null, undefined, and empty input", () => {
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
  });
});

describe("parseEmailList", () => {
  it("splits, trims, and lower-cases", () => {
    expect(parseEmailList(" A@cornell.edu , B@Cornell.edu ")).toEqual([
      "a@cornell.edu",
      "b@cornell.edu",
    ]);
  });

  it("drops empty entries and non-string input", () => {
    expect(parseEmailList("a@cornell.edu,,  ,")).toEqual(["a@cornell.edu"]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
  });
});
