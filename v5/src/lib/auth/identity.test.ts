import { anonymousIdentity, hashIp, resolveIdentity } from "@/lib/auth/identity";
import {
  SESSION_COOKIE_NAME,
  createSessionPayload,
  signSession,
  type SessionPayload,
} from "@/lib/auth/session-cookie";

const SECRET = "identity-test-secret";

function stubAuthSecret(secret = SECRET) {
  vi.stubEnv("AUTH_SECRET", secret);
}

/** A request carrying a session cookie (and an IP, for the anonymous path). */
function requestWith(token?: string, ip = "203.0.113.7"): Request {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (token) headers.cookie = `theme=dark; ${SESSION_COOKIE_NAME}=${token}`;
  return new Request("http://localhost/api/chat", { headers });
}

async function tokenFor(
  email: string,
  overrides: Partial<SessionPayload> = {},
  secret = SECRET
): Promise<string> {
  const payload = {
    ...createSessionPayload({ sub: "google-sub-1", email, name: "Ada L" }),
    ...overrides,
  };
  return signSession(payload, secret);
}

describe("resolveIdentity — anonymous", () => {
  it("resolves a request with no cookie to anonymous", async () => {
    stubAuthSecret();
    const identity = await resolveIdentity(requestWith());
    expect(identity.role).toBe("anonymous");
    expect(identity.userId).toBeNull();
    expect(identity.email).toBeNull();
    expect(identity.name).toBeNull();
    expect(identity.rateLimitKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it("resolves to anonymous when AUTH_SECRET is not configured at all", async () => {
    // A deployment with no sign-in configured still serves everyone.
    const token = await tokenFor("student@cornell.edu");
    const identity = await resolveIdentity(requestWith(token));
    expect(identity.role).toBe("anonymous");
  });
});

describe("resolveIdentity — valid session", () => {
  it("resolves a valid institutional cookie to a student", async () => {
    stubAuthSecret();
    const identity = await resolveIdentity(
      requestWith(await tokenFor("student@cornell.edu"))
    );
    expect(identity).toEqual({
      role: "student",
      userId: "google-sub-1",
      email: "student@cornell.edu",
      name: "Ada L",
      rateLimitKey: "user:google-sub-1",
    });
  });

  it("resolves a staff address to staff", async () => {
    stubAuthSecret();
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    const identity = await resolveIdentity(
      requestWith(await tokenFor("niti@cornell.edu"))
    );
    expect(identity.role).toBe("staff");
    expect(identity.email).toBe("niti@cornell.edu");
  });

  it("resolves an admin address to admin", async () => {
    stubAuthSecret();
    vi.stubEnv("AUTH_ADMIN_EMAILS", "isaac@cornell.edu");
    const identity = await resolveIdentity(
      requestWith(await tokenFor("isaac@cornell.edu"))
    );
    expect(identity.role).toBe("admin");
  });
});

describe("resolveIdentity — degrades to anonymous, never throws", () => {
  it("degrades on an expired cookie", async () => {
    stubAuthSecret();
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await tokenFor("student@cornell.edu", {
      iat: past - 3600,
      exp: past,
    });
    const identity = await resolveIdentity(requestWith(token));
    expect(identity.role).toBe("anonymous");
    expect(identity.email).toBeNull();
  });

  it("degrades on a tampered signature", async () => {
    stubAuthSecret();
    const token = await tokenFor("student@cornell.edu");
    const [body, sig] = token.split(".");
    const tampered = `${body}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
    const identity = await resolveIdentity(requestWith(tampered));
    expect(identity.role).toBe("anonymous");
    expect(identity.userId).toBeNull();
  });

  it("degrades on a cookie signed with a rotated-away secret", async () => {
    stubAuthSecret("the-new-secret");
    const token = await tokenFor("student@cornell.edu", {}, "the-old-secret");
    expect((await resolveIdentity(requestWith(token))).role).toBe("anonymous");
  });

  it("degrades on garbage in the cookie rather than 500-ing", async () => {
    stubAuthSecret();
    for (const junk of ["", "....", "%%%", "a.b.c.d"]) {
      const identity = await resolveIdentity(requestWith(junk));
      expect(identity.role).toBe("anonymous");
    }
  });

  it("re-throws Next's prerender signal instead of swallowing it", async () => {
    // Reading headers during a prerender throws a `digest`-carrying error that
    // marks the route dynamic. Catching it would silently prerender a route
    // that must run per request — the build proves this, but only if we keep it.
    stubAuthSecret();
    const signal = Object.assign(new Error("bail out"), {
      digest: "NEXT_PRERENDER_INTERRUPTED",
    });
    const req = {
      headers: {
        get() {
          throw signal;
        },
      },
    } as unknown as Request;

    await expect(resolveIdentity(req)).rejects.toBe(signal);
  });

  it("refuses a validly-signed cookie carrying a non-institutional address", async () => {
    // Only reachable if AUTH_SECRET leaked or the callback regressed — either
    // way the domain rule is re-checked on every request, not just at sign-in.
    stubAuthSecret();
    const token = await tokenFor("attacker@gmail.com");
    const identity = await resolveIdentity(requestWith(token));
    expect(identity.role).toBe("anonymous");
    expect(identity.email).toBeNull();
  });

  it("refuses a validly-signed cookie for a domain that has since changed", async () => {
    stubAuthSecret();
    const token = await tokenFor("student@cornell.edu");
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "example.edu");
    expect((await resolveIdentity(requestWith(token))).role).toBe("anonymous");
  });
});

describe("rateLimitKey", () => {
  it("is stable across requests for the same signed-in user", async () => {
    stubAuthSecret();
    const token = await tokenFor("student@cornell.edu");
    const a = await resolveIdentity(requestWith(token, "1.1.1.1"));
    const b = await resolveIdentity(requestWith(token, "2.2.2.2"));
    // Same user from two networks is one bucket — the ceiling must not be
    // escapable by changing IP, nor unreachable by roaming.
    expect(a.rateLimitKey).toBe(b.rateLimitKey);
    expect(a.rateLimitKey).toBe("user:google-sub-1");
  });

  it("is stable across requests for the same anonymous IP", async () => {
    stubAuthSecret();
    const a = await resolveIdentity(requestWith(undefined, "198.51.100.4"));
    const b = await resolveIdentity(requestWith(undefined, "198.51.100.4"));
    expect(a.rateLimitKey).toBe(b.rateLimitKey);
  });

  it("differs between two anonymous IPs", async () => {
    stubAuthSecret();
    const a = await resolveIdentity(requestWith(undefined, "198.51.100.4"));
    const b = await resolveIdentity(requestWith(undefined, "198.51.100.5"));
    expect(a.rateLimitKey).not.toBe(b.rateLimitKey);
  });

  it("never contains the raw IP — the limiter store holds no personal data", async () => {
    stubAuthSecret();
    const identity = await resolveIdentity(requestWith(undefined, "198.51.100.4"));
    expect(identity.rateLimitKey).not.toContain("198.51.100.4");
    expect(identity.rateLimitKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it("separates the signed-in and anonymous key spaces", async () => {
    stubAuthSecret();
    const signedIn = await resolveIdentity(
      requestWith(await tokenFor("student@cornell.edu"))
    );
    const anon = await resolveIdentity(requestWith());
    expect(signedIn.rateLimitKey.startsWith("user:")).toBe(true);
    expect(anon.rateLimitKey.startsWith("ip:")).toBe(true);
  });
});

describe("hashIp", () => {
  it("is a hex sha256 digest, not the input", async () => {
    const hashed = await hashIp("203.0.113.7", SECRET);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.7");
  });

  it("is salted by the secret, so rotation re-buckets everyone", async () => {
    const a = await hashIp("203.0.113.7", "secret-a");
    const b = await hashIp("203.0.113.7", "secret-b");
    expect(a).not.toBe(b);
  });

  it("is deterministic", async () => {
    expect(await hashIp("203.0.113.7", SECRET)).toBe(
      await hashIp("203.0.113.7", SECRET)
    );
  });
});

describe("anonymousIdentity", () => {
  it("buckets a request with no IP headers under a single 'unknown' key", async () => {
    stubAuthSecret();
    const identity = await anonymousIdentity(new Request("http://localhost/"));
    expect(identity.role).toBe("anonymous");
    expect(identity.rateLimitKey).toBe(`ip:${await hashIp("unknown", SECRET)}`);
  });
});
