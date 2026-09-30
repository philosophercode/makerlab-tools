import { isSuperAdminFloor, superAdminEmails } from "@/lib/auth/super-admins";

// Every helper reads process.env at call time, so `vi.stubEnv` alone is enough
// — no resetModules()/dynamic import dance (the setup file unstubs after each).

describe("superAdminEmails", () => {
  it("is empty when the variable is unset", () => {
    // The whole suite runs with no environment at all; an unset floor must be
    // "nobody", never a crash and never a default address.
    expect(superAdminEmails()).toEqual([]);
  });

  it("splits, trims and lower-cases the list", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", " IES22@Cornell.edu , niti@cornell.edu ");
    expect(superAdminEmails()).toEqual(["ies22@cornell.edu", "niti@cornell.edu"]);
  });
});

describe("isSuperAdminFloor", () => {
  it("recognises a listed address regardless of case or padding", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    expect(isSuperAdminFloor("ies22@cornell.edu")).toBe(true);
    expect(isSuperAdminFloor("  IES22@CORNELL.EDU  ")).toBe(true);
  });

  it("is false for an address that is not listed", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    expect(isSuperAdminFloor("someone-else@cornell.edu")).toBe(false);
  });

  it("is false when the variable is unset", () => {
    expect(isSuperAdminFloor("ies22@cornell.edu")).toBe(false);
  });

  it("refuses an address outside the allowed domain, even when listed", () => {
    // A typo in the floor must fail closed. The create hook would never make
    // this address a row, so honouring it here would grant the highest role to
    // an account that cannot exist.
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "attacker@gmail.com");
    expect(isSuperAdminFloor("attacker@gmail.com")).toBe(false);
  });

  it("follows a reconfigured allowed domain", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "example.edu");
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "director@example.edu, ies22@cornell.edu");
    expect(isSuperAdminFloor("director@example.edu")).toBe(true);
    expect(isSuperAdminFloor("ies22@cornell.edu")).toBe(false);
  });

  it("is false for absent input", () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    expect(isSuperAdminFloor(null)).toBe(false);
    expect(isSuperAdminFloor(undefined)).toBe(false);
    expect(isSuperAdminFloor("")).toBe(false);
  });
});
