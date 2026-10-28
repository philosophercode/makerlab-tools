// @vitest-environment node
import labFile from "../../../lab/lab.config";
import { allowedEmailDomain } from "../auth/roles";
import { localized } from "./config";
import { labConfigIssues } from "./schema";

/** The shipped config with one field changed, by path. */
function withField(path: string, value: unknown): unknown {
  const copy = structuredClone(labFile) as Record<string, unknown>;
  const keys = path.split(".");
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[keys.at(-1)!] = value;
  return copy;
}

describe("the lab config schema (lab config spec §4, §12)", () => {
  it("accepts the shipped Cornell file", () => {
    expect(labConfigIssues(labFile)).toEqual([]);
  });

  it.each([
    ["brand.colors.primary", "orange", "brand.colors.primary: must be a hex colour"],
    ["place.timezone", "Mars/Base", "place.timezone: must be an IANA timezone"],
    ["web.siteUrl", "not a url", "web.siteUrl: must be an http(s) URL"],
    ["web.siteUrl", "ftp://example.org", "web.siteUrl: must be an http(s) URL"],
    ["access.emailDomain", "@cornell.edu", "access.emailDomain: must be a domain"],
    ["contact.demoEmail", "nobody", "contact.demoEmail: must be an email address"],
    ["email.replyTo", "nobody", "email.replyTo: must be an email address"],
    ["locale.default", "xx", "locale.default: must be one of the supported locales"],
    ["brand.logo", "lab/logo.svg", "brand.logo: must be a path under public/"],
    ["identity.labName", "  ", "identity.labName: must not be empty"],
    ["about.title", { es: "Sin inglés" }, "about.title:"],
    ["about.title", { en: "English", xx: "Unknown" }, "about.title:"],
  ])("rejects %s = %j, naming the field", (path, value, message) => {
    const issues = labConfigIssues(withField(path, value));
    expect(issues.some((issue) => issue.startsWith(message))).toBe(true);
  });

  it("rejects a field the schema does not know", () => {
    expect(labConfigIssues(withField("identity.motto", "Make things"))).toEqual([
      expect.stringContaining("identity: Unrecognized key"),
    ]);
  });

  it("refuses anything shaped like a secret", () => {
    const issues = labConfigIssues(withField("web.apiKey", "sk-123"));
    expect(issues).toContain(
      "web.apiKey: looks like a secret. Keys and tokens belong in environment variables, never in lab.config.ts"
    );
  });

  it("pins the sign-in domain: a careless edit of the shipped file fails CI (§8)", () => {
    expect(labFile.access.emailDomain).toBe("cornell.edu");
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "");
    expect(allowedEmailDomain()).toBe("cornell.edu");
    vi.unstubAllEnvs();
  });
});

describe("localized", () => {
  it("gives the locale's own words, else the English", () => {
    const text = { en: "The open lab floor", es: "El espacio abierto" };
    expect(localized(text, "es")).toBe("El espacio abierto");
    expect(localized(text, "ja")).toBe("The open lab floor");
    expect(localized("One language", "ja")).toBe("One language");
  });
});
