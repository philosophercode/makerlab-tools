import { DEMO_SIGNUP_LIMITS, parseDemoSignup } from "./signup";

/**
 * The demo sign-up's rules (demo pass spec 2026-10-07 §5.1, §8): what the form
 * and the route both refuse, and what a valid sign-up becomes.
 */

const VALID = { name: "Ada Lovelace", email: "Ada@Example.org ", institution: "Analytical Engines Lab" };

describe("parseDemoSignup", () => {
  it("accepts the three required fields and normalises them", () => {
    const parsed = parseDemoSignup(VALID);
    expect(parsed).toEqual({
      kind: "valid",
      value: {
        name: "Ada Lovelace",
        email: "ada@example.org",
        institution: "Analytical Engines Lab",
        role: null,
        runsMakerspace: null,
        useCase: null,
        consentToContact: false,
      },
    });
  });

  it("keeps the optional answers: a role from the list, yes/no, the use, consent", () => {
    const parsed = parseDemoSignup({ ...VALID, role: "lab_manager", runsMakerspace: "yes", useCase: "  Inducting\r\n new members  ", consent: true });
    expect(parsed.kind === "valid" && parsed.value).toMatchObject({
      role: "lab_manager",
      runsMakerspace: true,
      useCase: "Inducting\n new members",
      consentToContact: true,
    });
    const no = parseDemoSignup({ ...VALID, runsMakerspace: "no" });
    expect(no.kind === "valid" && no.value.runsMakerspace).toBe(false);
  });

  it("says which required fields are missing", () => {
    expect(parseDemoSignup({ name: "  ", email: "", institution: "" })).toEqual({
      kind: "invalid",
      fields: { name: "required", email: "required", institution: "required" },
    });
  });

  it("refuses an address that is not one", () => {
    for (const email of ["ada", "ada@", "@example.org", "ada@example", "ada lovelace@example.org"]) {
      expect(parseDemoSignup({ ...VALID, email })).toEqual({ kind: "invalid", fields: { email: "invalidEmail" } });
    }
  });

  it("caps every text field", () => {
    const parsed = parseDemoSignup({
      name: "a".repeat(DEMO_SIGNUP_LIMITS.name + 1),
      email: `${"a".repeat(250)}@example.org`,
      institution: "b".repeat(DEMO_SIGNUP_LIMITS.institution + 1),
      useCase: "c".repeat(DEMO_SIGNUP_LIMITS.useCase + 1),
    });
    expect(parsed).toEqual({ kind: "invalid", fields: { name: "tooLong", email: "tooLong", institution: "tooLong", useCase: "tooLong" } });
  });

  it("refuses a role outside the list and a consent that is not a yes or no", () => {
    expect(parseDemoSignup({ ...VALID, role: "admin" })).toEqual({ kind: "invalid", fields: { role: "invalid" } });
    expect(parseDemoSignup({ ...VALID, consent: "yes" })).toEqual({ kind: "invalid", fields: { consent: "invalid" } });
  });

  it("treats a filled honeypot as a bot before checking anything else", () => {
    expect(parseDemoSignup({ website: "https://spam.example" })).toEqual({ kind: "bot" });
    expect(parseDemoSignup({ ...VALID, website: "x" })).toEqual({ kind: "bot" });
  });

  it("survives a body that is not an object", () => {
    expect(parseDemoSignup(null).kind).toBe("invalid");
    expect(parseDemoSignup("name=Ada").kind).toBe("invalid");
  });
});
