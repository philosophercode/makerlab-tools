import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionPayload,
  readCookie,
  serializeSessionCookie,
  shouldRefreshSession,
  signSession,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth/session-cookie";

const SECRET = "test-secret-do-not-use";
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    ...createSessionPayload(
      { sub: "google-sub-1", email: "student@cornell.edu", name: "Ada" },
      NOW
    ),
    ...overrides,
  };
}

describe("createSessionPayload", () => {
  it("stamps iat/exp 30 days apart", () => {
    const p = payload();
    expect(p.exp - p.iat).toBe(SESSION_MAX_AGE_SECONDS);
    expect(p.iat).toBe(Math.floor(NOW / 1000));
  });

  it("normalizes a missing display name to null", () => {
    const p = createSessionPayload({ sub: "s", email: "a@cornell.edu" }, NOW);
    expect(p.name).toBeNull();
  });
});

describe("signSession / verifySessionToken", () => {
  it("round-trips a payload", async () => {
    const p = payload();
    const token = await signSession(p, SECRET);
    expect(await verifySessionToken(token, SECRET, NOW)).toEqual(p);
  });

  it("is deterministic for the same payload and secret", async () => {
    const p = payload();
    expect(await signSession(p, SECRET)).toBe(await signSession(p, SECRET));
  });

  it("returns null for an absent token", async () => {
    expect(await verifySessionToken(null, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken("", SECRET, NOW)).toBeNull();
  });

  it("returns null when no secret is configured", async () => {
    const token = await signSession(payload(), SECRET);
    expect(await verifySessionToken(token, "", NOW)).toBeNull();
    expect(await verifySessionToken(token, undefined, NOW)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await signSession(payload(), "some-other-secret");
    expect(await verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it("returns null when the signature is tampered with", async () => {
    const token = await signSession(payload(), SECRET);
    const [body, sig] = token.split(".");
    const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(await verifySessionToken(`${body}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("returns null when the payload is tampered with (privilege escalation attempt)", async () => {
    const token = await signSession(payload(), SECRET);
    const sig = token.split(".")[1];
    const forged = btoa(
      JSON.stringify(payload({ email: "attacker@cornell.edu" }))
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifySessionToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("returns null for structurally malformed tokens instead of throwing", async () => {
    for (const bad of ["", ".", "nodot", "a.", ".b", "not.base64!!", "a.b.c"]) {
      await expect(verifySessionToken(bad, SECRET, NOW)).resolves.toBeNull();
    }
  });

  it("returns null once the payload has expired", async () => {
    const token = await signSession(payload(), SECRET);
    const justBefore = (payload().exp - 1) * 1000;
    const justAfter = (payload().exp + 1) * 1000;
    expect(await verifySessionToken(token, SECRET, justBefore)).not.toBeNull();
    expect(await verifySessionToken(token, SECRET, justAfter)).toBeNull();
  });

  it("returns null when the signed payload is missing required claims", async () => {
    // Signed with the right key, but not a session — must still be refused.
    const bogus = { hello: "world" } as unknown as SessionPayload;
    const token = await signSession(bogus, SECRET);
    expect(await verifySessionToken(token, SECRET, NOW)).toBeNull();
  });
});

describe("shouldRefreshSession", () => {
  it("is false for a freshly issued cookie", () => {
    expect(shouldRefreshSession(payload(), NOW)).toBe(false);
  });

  it("is true once the cookie is a day old (rolling refresh)", () => {
    expect(shouldRefreshSession(payload(), NOW + 25 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("readCookie", () => {
  it("finds a value among several cookies", () => {
    const header = `theme=dark; ${SESSION_COOKIE_NAME}=abc.def; NEXT_LOCALE=en`;
    expect(readCookie(header, SESSION_COOKIE_NAME)).toBe("abc.def");
  });

  it("returns null when the cookie or the header is absent", () => {
    expect(readCookie("theme=dark", SESSION_COOKIE_NAME)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE_NAME)).toBeNull();
    expect(readCookie("", SESSION_COOKIE_NAME)).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the target", () => {
    expect(readCookie(`x.${SESSION_COOKIE_NAME}=nope`, SESSION_COOKIE_NAME)).toBeNull();
  });
});

describe("serializeSessionCookie", () => {
  it("is HttpOnly, SameSite=Lax, path-wide", () => {
    const header = serializeSessionCookie("token-value", 100);
    expect(header).toContain(`${SESSION_COOKIE_NAME}=token-value`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=100");
  });

  it("adds Secure only in production", () => {
    expect(serializeSessionCookie("t")).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(serializeSessionCookie("t")).toContain("Secure");
  });
});
