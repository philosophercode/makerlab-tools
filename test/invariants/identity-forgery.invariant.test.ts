// @vitest-environment node
import { fc, IO_RUNS } from "./fc";
import { resetAuthForTests } from "@/lib/auth/config";
import { resolveIdentity } from "@/lib/auth/identity";
import { resetDbForTests } from "@/lib/db/client";
import {
  BETTER_AUTH_SESSION_COOKIE,
  signCookieValue,
  signInAsNew,
  type SignedInSession,
} from "../utils/session";

/**
 * INVARIANT 2 — nothing a client sends can promote it.
 *
 * `resolveIdentity(req)` is the only source of a role. Whatever headers and
 * cookies arrive — garbage, a tampered real session cookie, a cookie signed
 * with the wrong secret, role-looking headers — it never throws, and it
 * answers either the anonymous identity or exactly the person whose untouched
 * session it was. It never answers a role the caller did not legitimately hold.
 */

const AUTH_SECRET = "identity-forgery-invariant-secret";

let admin: SignedInSession;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  admin = await signInAsNew({ role: "super_admin" });
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("DEMO_ADMIN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

let ip = 0;
function request(headers: Record<string, string>): Request {
  ip = (ip + 1) % 250;
  return new Request("https://makerlab.example/api/identity", {
    headers: { "x-forwarded-for": `203.0.113.${ip + 1}`, ...headers },
  });
}

/** Header-safe strings: Request rejects CR, LF and NUL outright. */
const headerText = fc.string({ maxLength: 200 }).map((s) => s.replace(/[\r\n\0]/g, ""));

/** A real session cookie with one character changed, inserted or removed. */
function tamper(cookie: string) {
  const value = cookie.slice(BETTER_AUTH_SESSION_COOKIE.length + 1);
  return fc
    .tuple(fc.nat({ max: value.length - 1 }), fc.constantFrom("flip", "drop", "insert"), fc.string({ minLength: 1, maxLength: 1 }))
    .map(([i, op, ch]) => {
      const c = ch.replace(/[\r\n\0;]/g, "x");
      let next = value;
      if (op === "flip") next = value.slice(0, i) + (value[i] === "A" ? "B" : "A") + value.slice(i + 1);
      if (op === "drop") next = value.slice(0, i) + value.slice(i + 1);
      if (op === "insert") next = value.slice(0, i) + c + value.slice(i);
      return `${BETTER_AUTH_SESSION_COOKIE}=${next}`;
    })
    // Cookie parsing trims whitespace and percent-decodes, so an edit that
    // normalises back to the original signed value is not a forgery.
    .filter((forged) => normalise(forged) !== normalise(cookie));
}

function normalise(cookie: string): string {
  let value = cookie.slice(BETTER_AUTH_SESSION_COOKIE.length + 1).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return value;
  }
  // The signature is base64 of a 32-byte HMAC: its last character before the
  // "=" carries two unused bits, so "…A=" and "…B=" are the same signature.
  // Compare what the signature decodes to, when it is well-formed base64.
  const dot = value.lastIndexOf(".");
  const sig = value.slice(dot + 1);
  if (dot > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(sig)) {
    return `${value.slice(0, dot)}.${Buffer.from(sig, "base64").toString("hex")}`;
  }
  return value;
}

describe("invariant: forged credentials resolve to anonymous", () => {
  it("arbitrary cookie and role-looking headers never yield a role", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          cookie: fc.oneof(
            headerText,
            headerText.map((v) => `${BETTER_AUTH_SESSION_COOKIE}=${v}`),
            fc.constant("role=super_admin; is_admin=true")
          ),
          extra: fc.constantFrom("x-user-role", "x-role", "x-admin", "x-demo-admin", "x-user-id"),
          extraValue: fc.constantFrom("super_admin", "admin", "1", "true", admin.user.id),
        }),
        async ({ cookie, extra, extraValue }) => {
          const identity = await resolveIdentity(request({ cookie, [extra]: extraValue }));
          expect(identity.role).toBe("anonymous");
          expect(identity.userId).toBeNull();
        }
      ),
      { numRuns: IO_RUNS * 2 }
    );
  });

  it("a tampered real session cookie is anonymous, never another role", async () => {
    // Sanity: the untouched cookie is the director — the property is not vacuous.
    expect((await resolveIdentity(request({ cookie: admin.cookie }))).role).toBe("super_admin");

    await fc.assert(
      fc.asyncProperty(tamper(admin.cookie), async (forged) => {
        const identity = await resolveIdentity(request({ cookie: forged }));
        expect(identity.role).toBe("anonymous");
      }),
      { numRuns: IO_RUNS * 2 }
    );
  });

  it("the right token signed with any other secret is anonymous", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s !== AUTH_SECRET),
        async (secret) => {
          const value = await signCookieValue(admin.token, secret);
          const identity = await resolveIdentity(request({ cookie: `${BETTER_AUTH_SESSION_COOKIE}=${value}` }));
          expect(identity.role).toBe("anonymous");
        }
      ),
      { numRuns: IO_RUNS }
    );
  });
});
