import {
  ROLES,
  adminEmails,
  allowedEmailDomain,
  isAllowedEmail,
  isAtLeast,
  parseEmailList,
  roleForEmail,
  roleRank,
  staffEmails,
} from "@/lib/auth/roles";

// Every helper reads process.env at call time, so `vi.stubEnv` alone is enough
// — no resetModules()/dynamic import dance (the setup file unstubs after each).

describe("role ordering", () => {
  it("orders roles least- to most-privileged", () => {
    expect([...ROLES]).toEqual(["anonymous", "student", "staff", "admin"]);
    expect(roleRank("anonymous")).toBeLessThan(roleRank("student"));
    expect(roleRank("student")).toBeLessThan(roleRank("staff"));
    expect(roleRank("staff")).toBeLessThan(roleRank("admin"));
  });

  it("isAtLeast compares by rank, inclusive of equality", () => {
    expect(isAtLeast("admin", "staff")).toBe(true);
    expect(isAtLeast("staff", "staff")).toBe(true);
    expect(isAtLeast("student", "staff")).toBe(false);
    expect(isAtLeast("anonymous", "student")).toBe(false);
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

  it("reads the staff and admin rosters from env", () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    vi.stubEnv("AUTH_ADMIN_EMAILS", "isaac@cornell.edu");
    expect(staffEmails()).toEqual(["niti@cornell.edu"]);
    expect(adminEmails()).toEqual(["isaac@cornell.edu"]);
  });
});

describe("roleForEmail", () => {
  it("defaults a valid institutional address to student", () => {
    expect(roleForEmail("student@cornell.edu")).toBe("student");
  });

  it("promotes an address listed in AUTH_STAFF_EMAILS", () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu, other@cornell.edu");
    expect(roleForEmail("niti@cornell.edu")).toBe("staff");
  });

  it("promotes an address listed in AUTH_ADMIN_EMAILS", () => {
    vi.stubEnv("AUTH_ADMIN_EMAILS", "isaac@cornell.edu");
    expect(roleForEmail("isaac@cornell.edu")).toBe("admin");
  });

  it("prefers admin when an address is on both lists", () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "isaac@cornell.edu");
    vi.stubEnv("AUTH_ADMIN_EMAILS", "isaac@cornell.edu");
    expect(roleForEmail("isaac@cornell.edu")).toBe("admin");
  });

  it("matches roster entries case-insensitively", () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "Niti@Cornell.edu");
    expect(roleForEmail("NITI@CORNELL.EDU")).toBe("staff");
  });

  it("refuses to grant a role to an address outside the domain, even if listed", () => {
    // A roster typo must not become a privilege escalation.
    vi.stubEnv("AUTH_ADMIN_EMAILS", "attacker@gmail.com");
    expect(roleForEmail("attacker@gmail.com")).toBe("anonymous");
  });

  it("resolves an absent address to anonymous", () => {
    expect(roleForEmail(null)).toBe("anonymous");
    expect(roleForEmail("")).toBe("anonymous");
  });
});
