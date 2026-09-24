// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { getDb, resetDbForTests } from "../db/client";
import { apiTokens, oauthAccessToken, oauthApplication, session, user } from "../db/schema/index";
import { createApiToken } from "../data/api-tokens";
import { seedUser, signInAs } from "../../../test/utils/session";
import { resetAuthForTests } from "./config";
import { resolveMcpCaller, resetLegacyWarningForTests } from "./mcp-caller";

/**
 * Who is calling `/api/mcp` (MCP access spec §3.1): the bearer branch first —
 * a personal access token, the retired `MCP_TOKEN`, an OAuth access token —
 * then anonymous. A bearer that does not resolve is refused, never anonymous,
 * and the session cookie is never consulted on this route.
 */

const AUTH_SECRET = "mcp-caller-test-secret";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", ...headers },
  });
}

async function tokenFor(email: string, options: { role?: "user" | "admin" | "super_admin"; readOnly?: boolean; banned?: boolean } = {}) {
  const person = await seedUser({ email, role: options.role ?? "user", banned: options.banned, name: "Pat Person" });
  const created = await createApiToken({ userId: person.id, name: "test", readOnly: Boolean(options.readOnly), expiry: "90" });
  if (!created.ok) throw new Error("expected a token");
  return { person, token: created.token, tokenId: created.summary.id };
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
  resetLegacyWarningForTests();
  const db = await getDb();
  await db.delete(apiTokens);
  await db.delete(oauthAccessToken);
  await db.delete(oauthApplication);
});

afterAll(() => resetDbForTests());

describe("no credential", () => {
  it("is anonymous, keyed by hashed IP", async () => {
    const result = await resolveMcpCaller(request());
    expect(result).toMatchObject({ ok: true, caller: { via: "anonymous", readOnly: false, identity: { role: "anonymous", userId: null } } });
    expect(result.ok && result.caller.identity.rateLimitKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it("ignores a session cookie — the MCP route reads bearers only", async () => {
    const person = await seedUser({ email: "cookie-only@cornell.edu", role: "admin" });
    const signedIn = await signInAs(person);
    const result = await resolveMcpCaller(request({ cookie: signedIn.cookie }));
    expect(result.ok && result.caller.identity.role).toBe("anonymous");
  });
});

describe("a personal access token", () => {
  it("acts as its owner, with their role, keyed by the token", async () => {
    const { person, token, tokenId } = await tokenFor("pat-user@cornell.edu", { role: "admin" });
    const result = await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    expect(result).toMatchObject({
      ok: true,
      caller: {
        via: "token",
        readOnly: false,
        tokenId,
        identity: { role: "admin", userId: person.id, email: "pat-user@cornell.edu", name: "Pat Person", rateLimitKey: `token:${tokenId}` },
      },
    });
  });

  it("wins over a session cookie on the same request", async () => {
    const admin = await seedUser({ email: "cookie-admin@cornell.edu", role: "super_admin" });
    const signedIn = await signInAs(admin);
    const { person, token } = await tokenFor("bearer-student@cornell.edu");
    const result = await resolveMcpCaller(request({ authorization: `Bearer ${token}`, cookie: signedIn.cookie }));
    expect(result.ok && result.caller.identity.userId).toBe(person.id);
    expect(result.ok && result.caller.identity.role).toBe("user");
  });

  it("carries read-only", async () => {
    const { token } = await tokenFor("pat-ro@cornell.edu", { readOnly: true, role: "admin" });
    const result = await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    expect(result.ok && result.caller.readOnly).toBe(true);
  });

  it("is refused — never anonymous — when unknown, revoked or expired", async () => {
    expect(await resolveMcpCaller(request({ authorization: `Bearer mlt_${"x".repeat(43)}` }))).toEqual({ ok: false, reason: "unknown_token" });
    expect(await resolveMcpCaller(request({ authorization: "Bearer " }))).toEqual({ ok: false, reason: "unknown_token" });
    expect(await resolveMcpCaller(request({ authorization: "Basic abc" }))).toEqual({ ok: false, reason: "unknown_token" });

    const revoked = await tokenFor("pat-revoked@cornell.edu");
    const db = await getDb();
    await db.update(apiTokens).set({ revokedAt: sql`now()` }).where(eq(apiTokens.id, revoked.tokenId));
    expect(await resolveMcpCaller(request({ authorization: `Bearer ${revoked.token}` }))).toEqual({ ok: false, reason: "token_revoked" });

    const expired = await tokenFor("pat-expired@cornell.edu");
    await db.update(apiTokens).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(apiTokens.id, expired.tokenId));
    expect(await resolveMcpCaller(request({ authorization: `Bearer ${expired.token}` }))).toEqual({ ok: false, reason: "token_expired" });
  });

  it("stops at once for a banned owner, and follows a demotion on the next call", async () => {
    const { person, token } = await tokenFor("pat-banned@cornell.edu", { role: "admin" });
    const db = await getDb();
    await db.update(user).set({ role: "user" }).where(eq(user.id, person.id));
    const demoted = await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    expect(demoted.ok && demoted.caller.identity.role).toBe("user");

    await db.update(user).set({ banned: true }).where(eq(user.id, person.id));
    expect(await resolveMcpCaller(request({ authorization: `Bearer ${token}` }))).toEqual({ ok: false, reason: "account_suspended" });
  });

  it("honours the super-admin floor, as a session does", async () => {
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "floor@cornell.edu");
    const { token } = await tokenFor("floor@cornell.edu", { role: "user", banned: true });
    const result = await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    expect(result.ok && result.caller.identity.role).toBe("super_admin");
  });

  it("never writes the token to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    const { person, token } = await tokenFor("pat-quiet@cornell.edu");
    await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    const db = await getDb();
    await db.update(user).set({ banned: true }).where(eq(user.id, person.id));
    await resolveMcpCaller(request({ authorization: `Bearer ${token}` }));
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(token.slice(12));
      spy.mockRestore();
    }
  });
});

describe("an OAuth access token", () => {
  async function grant(userId: string, scopes: string, expiresInMs = 3600_000) {
    const db = await getDb();
    await db
      .insert(oauthApplication)
      .values({ id: "app-claude", clientId: "claude-client", name: "Claude", redirectUrls: "https://claude.ai/cb", type: "public" })
      .onConflictDoNothing();
    const accessToken = `oauth-${userId}-${scopes.replace(/\s/g, "-")}`;
    await db.insert(oauthAccessToken).values({
      id: `at-${accessToken}`,
      accessToken,
      refreshToken: `rt-${accessToken}`,
      accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
      refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
      clientId: "claude-client",
      userId,
      scopes,
    });
    return accessToken;
  }

  it("acts as the person who granted it; read_only narrows it", async () => {
    const person = await seedUser({ email: "oauth-person@cornell.edu", role: "admin" });
    const full = await grant(person.id, "openid profile");
    const readOnly = await grant(person.id, "openid read_only");

    const a = await resolveMcpCaller(request({ authorization: `Bearer ${full}` }));
    expect(a).toMatchObject({ ok: true, caller: { via: "oauth", readOnly: false, identity: { role: "admin", userId: person.id, rateLimitKey: `user:${person.id}` } } });
    const b = await resolveMcpCaller(request({ authorization: `Bearer ${readOnly}` }));
    expect(b.ok && b.caller.readOnly).toBe(true);
  });

  it("is refused when expired or unknown", async () => {
    const person = await seedUser({ email: "oauth-expired@cornell.edu" });
    const expired = await grant(person.id, "openid", -1000);
    expect(await resolveMcpCaller(request({ authorization: `Bearer ${expired}` }))).toEqual({ ok: false, reason: "token_expired" });
    expect(await resolveMcpCaller(request({ authorization: "Bearer not-a-real-access-token" }))).toEqual({ ok: false, reason: "unknown_token" });
  });
});

describe("the retired MCP_TOKEN", () => {
  it("still works for one release, as the anonymous, read-only identity, and warns once", async () => {
    vi.stubEnv("MCP_TOKEN", "legacy-shared-secret");
    const warn = vi.spyOn(console, "warn");
    const first = await resolveMcpCaller(request({ authorization: "Bearer legacy-shared-secret" }));
    await resolveMcpCaller(request({ authorization: "Bearer legacy-shared-secret" }));
    expect(first).toMatchObject({ ok: true, caller: { via: "legacy_token", readOnly: true, identity: { role: "anonymous", userId: null } } });
    const deprecations = warn.mock.calls.filter((call) => String(call[0]).includes("MCP_TOKEN is deprecated"));
    expect(deprecations).toHaveLength(1);
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain("legacy-shared-secret");
    warn.mockRestore();
  });
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(session);
});
