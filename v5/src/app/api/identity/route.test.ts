/**
 * `GET /api/identity` — the projection the header reads (auth design spec §6).
 *
 * Uses the real `resolveIdentity` and the real limiter; the only thing minted
 * here is a session cookie, signed exactly the way the callback signs one. No
 * network, no OAuth (Article 3).
 */
import {
  SESSION_COOKIE_NAME,
  createSessionPayload,
  signSession,
} from "@/lib/auth/session-cookie";
import { GET } from "@/app/api/identity/route";

const AUTH_SECRET = "identity-route-test-secret";

// The in-memory limiter is a per-process singleton keyed by identity, so every
// test needs its own IP.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `203.0.113.${counter}`;
}

async function cookieFor(sub: string, email: string, name: string | null) {
  const token = await signSession(
    createSessionPayload({ sub, email, name }),
    AUTH_SECRET
  );
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function identityRequest({ ip = uniqueIp(), cookie }: { ip?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/identity", { headers });
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
});

describe("GET /api/identity", () => {
  it("answers 200 with the anonymous role when there is no cookie", async () => {
    const res = await GET(identityRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "anonymous", name: null });
  });

  it("returns the role and display name of a signed-in student", async () => {
    const cookie = await cookieFor("sub-1", "ada@cornell.edu", "Ada Lovelace");

    const res = await GET(identityRequest({ cookie }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "student", name: "Ada Lovelace" });
  });

  it("reflects the staff role from AUTH_STAFF_EMAILS", async () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    const cookie = await cookieFor("sub-2", "niti@cornell.edu", "Niti");

    expect((await (await GET(identityRequest({ cookie }))).json()).role).toBe("staff");
  });

  it("never returns the email address — the header only needs a name", async () => {
    const cookie = await cookieFor("sub-3", "ada@cornell.edu", "Ada Lovelace");

    const body = await (await GET(identityRequest({ cookie }))).json();

    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("userId");
    expect(JSON.stringify(body)).not.toContain("cornell.edu");
  });

  it("degrades to anonymous on a tampered cookie rather than throwing", async () => {
    const cookie = await cookieFor("sub-4", "ada@cornell.edu", "Ada");
    const [name, token] = cookie.split("=");
    const [payload, signature] = token.split(".");
    const forged = `${name}=${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    const res = await GET(identityRequest({ cookie: forged }));

    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("anonymous");
  });

  it("degrades to anonymous on an expired cookie", async () => {
    const token = await signSession(
      createSessionPayload(
        { sub: "sub-5", email: "ada@cornell.edu", name: "Ada" },
        Date.now() - 60_000,
        1 // one-second lifetime, already spent
      ),
      AUTH_SECRET
    );

    const res = await GET(
      identityRequest({ cookie: `${SESSION_COOKIE_NAME}=${token}` })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("anonymous");
  });

  it("is never cached — it is per-request and per-person", async () => {
    const res = await GET(identityRequest());
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("is bounded: the ceiling refuses with Retry-After", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 120; i += 1) {
      expect((await GET(identityRequest({ ip }))).status).toBe(200);
    }

    const res = await GET(identityRequest({ ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
