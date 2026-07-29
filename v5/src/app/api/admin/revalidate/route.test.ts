import { nextCacheMock } from "../../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { revalidateTag } from "next/cache";
import {
  SESSION_COOKIE_NAME,
  createSessionPayload,
  signSession,
} from "../../../../lib/auth/session-cookie";
import { POST } from "./route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/revalidate", {
    method: "POST",
    headers,
  });
}

describe("POST /api/admin/revalidate", () => {
  it("returns 503 with {ok:false} when ADMIN_REVALIDATE_SECRET is unset", async () => {
    // The route treats an empty string as unset (`if (!secret)`).
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");

    const res = await POST(makeRequest({ "x-admin-secret": "anything" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 403 {ok:false, error:'forbidden'} when the x-admin-secret header is missing", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 403 {ok:false, error:'forbidden'} when the x-admin-secret header is wrong", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest({ "x-admin-secret": "wrong" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 200 {ok:true, tags:[…]} and revalidates every cached tag when the secret matches", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest({ "x-admin-secret": "s3cret" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // Both catalog and projects are cached under their own tag, so one admin
    // revalidate has to invalidate both.
    expect(body).toEqual({ ok: true, tags: ["catalog", "projects"] });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog", "minutes");
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("projects", "minutes");
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledTimes(2);
  });
});

/**
 * The session branch (ops hardening spec §3.2, as-built amendment 2026-07-29).
 *
 * Real `resolveIdentity`, real roles, real limiter — the only thing minted here
 * is a session cookie, signed the way the auth callback signs one. No network
 * (Article 3).
 */
const AUTH_SECRET = "revalidate-route-test-secret";

// The limiter is a per-process singleton keyed by identity, so anonymous cases
// that would otherwise share the `unknown` IP bucket get their own address.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `198.51.100.${counter}`;
}

async function cookieFor(sub: string, email: string) {
  const token = await signSession(
    createSessionPayload({ sub, email, name: "Test Person" }),
    AUTH_SECRET
  );
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function sessionRequest(cookie?: string, ip = uniqueIp()) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return makeRequest(headers);
}

describe("POST /api/admin/revalidate — staff session", () => {
  beforeEach(() => {
    // The `next/cache` mock is a module-factory mock, so `restoreAllMocks`
    // leaves its call log alone; each test needs a clean one.
    vi.mocked(revalidateTag).mockClear();
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    // Unset on purpose: a staff session must not depend on the shared secret
    // being configured, because the browser can never send it.
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");
  });

  it("accepts a staff session with no secret header at all", async () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    const cookie = await cookieFor("sub-staff", "niti@cornell.edu");

    const res = await POST(sessionRequest(cookie));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tags: ["catalog", "projects"] });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog", "minutes");
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("projects", "minutes");
  });

  it("accepts an admin session", async () => {
    vi.stubEnv("AUTH_ADMIN_EMAILS", "isaac@cornell.edu");
    const cookie = await cookieFor("sub-admin", "isaac@cornell.edu");

    expect((await POST(sessionRequest(cookie))).status).toBe(200);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledTimes(2);
  });

  it("refuses a signed-in student — signing in is not staff", async () => {
    const cookie = await cookieFor("sub-student", "ada@cornell.edu");

    const res = await POST(sessionRequest(cookie));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller with no cookie and no header", async () => {
    const res = await POST(sessionRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("refuses a tampered session cookie rather than trusting its claims", async () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    const cookie = await cookieFor("sub-forge", "niti@cornell.edu");
    const [name, token] = cookie.split("=");
    const [payload, signature] = token.split(".");
    const forged = `${name}=${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    const res = await POST(sessionRequest(forged));

    expect(res.status).toBe(403);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("still honours the secret header for callers that have no session", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "webhook-secret");

    const res = await POST(
      makeRequest({
        "x-forwarded-for": uniqueIp(),
        "x-admin-secret": "webhook-secret",
      })
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledTimes(2);
  });

  it("is bounded: the ceiling refuses with Retry-After", async () => {
    vi.stubEnv("AUTH_STAFF_EMAILS", "niti@cornell.edu");
    const cookie = await cookieFor("sub-flood", "niti@cornell.edu");
    const ip = uniqueIp();

    for (let i = 0; i < 30; i += 1) {
      expect((await POST(sessionRequest(cookie, ip))).status).toBe(200);
    }

    const res = await POST(sessionRequest(cookie, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
