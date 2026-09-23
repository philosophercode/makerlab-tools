// @vitest-environment node
import { anonymousIdentity, hashIp, resolveIdentity } from "@/lib/auth/identity";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";
import {
  BETTER_AUTH_SESSION_COOKIE,
  seedUser,
  signInAs,
  signInAsNew,
  type SignedInSession,
} from "../../../test/utils/session";

/**
 * Node, not jsdom: every case here goes through a real session row in PGlite.
 *
 * Roles are testable without Google because sessions are rows — `signInAs`
 * seeds one and mints the cookie that addresses it (`test/utils/session.ts`,
 * self-tested against a real `auth.api.getSession()`).
 */

const SECRET = "identity-test-secret";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", SECRET);
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** A request carrying a session cookie (and an IP, for the anonymous path). */
function requestWith(
  signedIn?: SignedInSession | string | null,
  ip = "203.0.113.7"
): Request {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  const cookie = typeof signedIn === "string" ? signedIn : signedIn?.cookie;
  if (cookie) headers.cookie = `theme=dark; ${cookie}`;
  return new Request("http://localhost/api/chat", { headers });
}

describe("resolveIdentity — anonymous", () => {
  it("resolves a request with no cookie to anonymous", async () => {
    const identity = await resolveIdentity(requestWith());
    expect(identity.role).toBe("anonymous");
    expect(identity.userId).toBeNull();
    expect(identity.email).toBeNull();
    expect(identity.name).toBeNull();
    expect(identity.rateLimitKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it("resolves to anonymous when AUTH_SECRET is not configured at all", async () => {
    // A deployment with no sign-in configured still serves everyone. The
    // cookie is minted first, while the secret is still stubbed.
    const signedIn = await signInAsNew();
    vi.stubEnv("AUTH_SECRET", "");
    resetAuthForTests();

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("anonymous");
  });
});

describe("resolveIdentity — a session row", () => {
  it("resolves a signed-in student to user", async () => {
    const signedIn = await signInAsNew({
      email: "student@cornell.edu",
      name: "Ada L",
    });

    expect(await resolveIdentity(requestWith(signedIn))).toEqual({
      role: "user",
      userId: signedIn.user.id,
      email: "student@cornell.edu",
      name: "Ada L",
      image: null,
      rateLimitKey: `user:${signedIn.user.id}`,
    });
  });

  it("resolves each stored role from the row, not from the environment", async () => {
    for (const role of ["user", "admin", "super_admin"] as const) {
      const signedIn = await signInAsNew({ role });
      expect((await resolveIdentity(requestWith(signedIn))).role).toBe(role);
    }
  });

  it("sees a role change on the very next request", async () => {
    // Goal 3 of the phase, and the reason sessions moved into the database.
    const person = await seedUser({ role: "user" });
    const signedIn = await signInAs(person);
    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("user");

    const { getDb } = await import("@/lib/db/client");
    const { user } = await import("@/lib/db/schema/index");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    await db.update(user).set({ role: "admin" }).where(eq(user.id, person.id));

    // A new Request, because the old one's answer is memoized per request.
    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("admin");
  });

  it("reads the session off a multipart upload, not just a JSON post", async () => {
    // The regression: `toHeaders` used to hand Better Auth the Request's own
    // guarded `Headers`, and the library copies what it is given. A copy of a
    // guarded list whose `content-type` came from its body — which is every
    // multipart form, so every upload — can arrive without `cookie`, and the
    // signed-in person silently resolves anonymous.
    const signedIn = await signInAsNew({ email: "uploader@cornell.edu" });
    const form = new FormData();
    form.append("file", new File([new Uint8Array(3)], "lamp.png", { type: "image/png" }));
    const req = new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9", cookie: signedIn.cookie },
      body: form,
    });

    const identity = await resolveIdentity(req);

    expect(identity.userId).toBe(signedIn.user.id);
    expect(identity.role).toBe("user");
  });

  it("memoizes per request: two calls, one session lookup", async () => {
    const signedIn = await signInAsNew();
    const req = requestWith(signedIn);
    const spy = vi.spyOn(req.headers, "get");

    const [a, b] = [await resolveIdentity(req), await resolveIdentity(req)];

    expect(a).toBe(b);
    // The second call never reached the cookie, let alone the database.
    const cookieReads = spy.mock.calls.filter(([name]) => name === "cookie").length;
    expect(cookieReads).toBeLessThanOrEqual(1);
  });
});

describe("resolveIdentity — degrades to anonymous, never throws", () => {
  it("degrades on an expired session row", async () => {
    const signedIn = await signInAsNew({}, { expiresInSeconds: -60 });
    const identity = await resolveIdentity(requestWith(signedIn));
    expect(identity.role).toBe("anonymous");
    expect(identity.email).toBeNull();
  });

  it("degrades on a tampered signature", async () => {
    const signedIn = await signInAsNew();
    const tampered = signedIn.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await resolveIdentity(requestWith(tampered))).role).toBe("anonymous");
  });

  it("degrades on a cookie signed with a rotated-away secret", async () => {
    const person = await seedUser();
    const stale = await signInAs(person, { secret: "the-old-secret" });
    expect((await resolveIdentity(requestWith(stale))).role).toBe("anonymous");
  });

  it("degrades on a token naming no session row", async () => {
    const { signCookieValue } = await import("../../../test/utils/session");
    const value = await signCookieValue("no-such-session", SECRET);
    const cookie = `${BETTER_AUTH_SESSION_COOKIE}=${value}`;
    expect((await resolveIdentity(requestWith(cookie))).role).toBe("anonymous");
  });

  it("degrades on garbage in the cookie rather than 500-ing", async () => {
    for (const junk of ["", "....", "%%%", "a.b.c.d"]) {
      const cookie = `${BETTER_AUTH_SESSION_COOKIE}=${junk}`;
      expect((await resolveIdentity(requestWith(cookie))).role).toBe("anonymous");
    }
  });

  it("refuses a banned user, immediately", async () => {
    // The ban bites on the next request precisely because the row is read on
    // every request. Their cookie is still perfectly valid.
    const signedIn = await signInAsNew({ banned: true, banReason: "spam" });
    const identity = await resolveIdentity(requestWith(signedIn));
    expect(identity.role).toBe("anonymous");
    expect(identity.userId).toBeNull();
  });

  it("refuses a session for a non-institutional address", async () => {
    // The create hook refuses such a row, so one existing means a restored
    // backup or a reconfigured domain — the rule is re-checked every request.
    const signedIn = await signInAsNew({ email: "attacker@gmail.com" });
    const identity = await resolveIdentity(requestWith(signedIn));
    expect(identity.role).toBe("anonymous");
    expect(identity.email).toBeNull();
  });

  it("refuses a session for a domain that has since changed", async () => {
    const signedIn = await signInAsNew({ email: "student@cornell.edu" });
    vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "example.edu");
    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("anonymous");
  });

  it("re-throws Next's prerender signal instead of swallowing it", async () => {
    // Reading headers during a prerender throws a `digest`-carrying error that
    // marks the route dynamic. Catching it would silently prerender a route
    // that must run per request — the build proves this, but only if we keep it.
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
});

describe("resolveIdentity — the super-admin floor", () => {
  it("resolves the floor address as super_admin whatever its row says", async () => {
    // Spec §10: the last super admin demotes themselves. The floor is what
    // makes that recoverable without a database console.
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    const signedIn = await signInAsNew({ email: "ies22@cornell.edu", role: "user" });

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("super_admin");
  });

  it("does not raise anyone else", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    const signedIn = await signInAsNew({ email: "someone@cornell.edu", role: "user" });

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("user");
  });

  it("resolves a floor address whose row is banned", async () => {
    // "Whatever its row says" includes `banned`. The floor is the lock-out
    // guarantee, and a ban that resolved anonymous made it a recovery for
    // exactly half of what `super-admins.ts` promises — with the ban being the
    // half nobody can undo from the UI, because the app refuses to ban a floor
    // address in the first place.
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    const signedIn = await signInAsNew({
      email: "ies22@cornell.edu",
      role: "user",
      banned: true,
      banReason: "a restored backup said so",
    });

    const identity = await resolveIdentity(requestWith(signedIn));
    expect(identity.role).toBe("super_admin");
    expect(identity.userId).toBe(signedIn.user.id);
  });

  it("still refuses a banned address the floor does not name", async () => {
    // The override is the floor's, not a hole in the ban.
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "ies22@cornell.edu");
    const signedIn = await signInAsNew({
      email: "someone@cornell.edu",
      role: "admin",
      banned: true,
    });

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("anonymous");
  });

  it("does not rescue a banned floor address that is out of domain", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "attacker@gmail.com");
    const signedIn = await signInAsNew({ email: "attacker@gmail.com", banned: true });

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("anonymous");
  });

  it("does not rescue a floor address that is out of domain", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "attacker@gmail.com");
    const signedIn = await signInAsNew({ email: "attacker@gmail.com" });

    expect((await resolveIdentity(requestWith(signedIn))).role).toBe("anonymous");
  });
});

describe("rateLimitKey", () => {
  it("is stable across requests for the same signed-in user", async () => {
    const signedIn = await signInAsNew();
    const a = await resolveIdentity(requestWith(signedIn, "1.1.1.1"));
    const b = await resolveIdentity(requestWith(signedIn, "2.2.2.2"));
    // Same user from two networks is one bucket — the ceiling must not be
    // escapable by changing IP, nor unreachable by roaming.
    expect(a.rateLimitKey).toBe(b.rateLimitKey);
    expect(a.rateLimitKey).toBe(`user:${signedIn.user.id}`);
  });

  it("is stable across requests for the same anonymous IP", async () => {
    const a = await resolveIdentity(requestWith(null, "198.51.100.4"));
    const b = await resolveIdentity(requestWith(null, "198.51.100.4"));
    expect(a.rateLimitKey).toBe(b.rateLimitKey);
  });

  it("differs between two anonymous IPs", async () => {
    const a = await resolveIdentity(requestWith(null, "198.51.100.4"));
    const b = await resolveIdentity(requestWith(null, "198.51.100.5"));
    expect(a.rateLimitKey).not.toBe(b.rateLimitKey);
  });

  it("never contains the raw IP — the limiter store holds no personal data", async () => {
    const identity = await resolveIdentity(requestWith(null, "198.51.100.4"));
    expect(identity.rateLimitKey).not.toContain("198.51.100.4");
    expect(identity.rateLimitKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it("separates the signed-in and anonymous key spaces", async () => {
    const signedIn = await resolveIdentity(requestWith(await signInAsNew()));
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
    const identity = await anonymousIdentity(new Request("http://localhost/"));
    expect(identity.role).toBe("anonymous");
    expect(identity.rateLimitKey).toBe(`ip:${await hashIp("unknown", SECRET)}`);
  });
});
