// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { getDb, resetDbForTests } from "../db/client";
import { apiTokens, oauthAccessToken, oauthApplication, oauthConsent } from "../db/schema/index";
import { hashApiToken } from "../auth/api-token-format";
import { seedUser } from "../../../test/utils/session";
import {
  createApiToken,
  expiryFor,
  findApiTokenByHash,
  findOAuthAccessToken,
  listApiTokens,
  listConnectedApps,
  MAX_ACTIVE_TOKENS,
  revokeApiToken,
  revokeConnectedApp,
  touchApiToken,
} from "./api-tokens";

/**
 * `api_tokens` and the OAuth grant reads (MCP access spec §4.1, §5.1, §6),
 * against the demo PGlite database.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const db = await getDb();
  await db.delete(apiTokens);
  await db.delete(oauthAccessToken);
  await db.delete(oauthConsent);
  await db.delete(oauthApplication);
});

afterAll(() => resetDbForTests());

describe("creating a token", () => {
  it("answers the token once and stores only its hash and prefix", async () => {
    const person = await seedUser({ email: "tok-create@cornell.edu" });
    const created = await createApiToken({ userId: person.id, name: "  Claude   Code  ", readOnly: false, expiry: "90" });
    if (!created.ok) throw new Error("expected a token");

    expect(created.token).toMatch(/^mlt_/);
    expect(created.summary.name).toBe("Claude Code");
    expect(created.summary.prefix).toBe(created.token.slice(4, 12));

    const db = await getDb();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, created.summary.id));
    expect(row.tokenHash).toBe(hashApiToken(created.token));
    // Nothing stored is the token or contains its secret part.
    expect(JSON.stringify(row)).not.toContain(created.token.slice(4));

    // …and no later read can answer it again.
    const listed = await listApiTokens(person.id);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.token.slice(12));
    expect(listed[0]).not.toHaveProperty("tokenHash");
  });

  it("expires in 30 or 90 days, or never", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(expiryFor("30", now)?.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    expect(expiryFor("90", now)?.toISOString()).toBe("2026-12-23T12:00:00.000Z");
    expect(expiryFor("never", now)).toBeNull();

    const person = await seedUser({ email: "tok-expiry@cornell.edu" });
    const never = await createApiToken({ userId: person.id, name: "Forever", readOnly: true, expiry: "never" });
    expect(never.ok && never.summary.expiresAt).toBeNull();
    expect(never.ok && never.summary.readOnly).toBe(true);
  });

  it("refuses an empty or over-long name and an expiry outside the choices", async () => {
    const person = await seedUser({ email: "tok-invalid@cornell.edu" });
    expect(await createApiToken({ userId: person.id, name: "   ", readOnly: false, expiry: "90" })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await createApiToken({ userId: person.id, name: "x".repeat(81), readOnly: false, expiry: "90" })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(
      await createApiToken({ userId: person.id, name: "ok", readOnly: false, expiry: "365" as never })
    ).toEqual({ ok: false, reason: "invalid_field" });
  });

  it("caps live tokens per person", async () => {
    const person = await seedUser({ email: "tok-cap@cornell.edu" });
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i += 1) {
      const created = await createApiToken({ userId: person.id, name: `t${i}`, readOnly: false, expiry: "30" });
      expect(created.ok).toBe(true);
    }
    expect(await createApiToken({ userId: person.id, name: "one more", readOnly: false, expiry: "30" })).toEqual({
      ok: false,
      reason: "too_many_tokens",
    });
  });
});

describe("revoking a token", () => {
  it("stamps revoked_at, only for its owner, once", async () => {
    const owner = await seedUser({ email: "tok-owner@cornell.edu" });
    const other = await seedUser({ email: "tok-other@cornell.edu" });
    const created = await createApiToken({ userId: owner.id, name: "Laptop", readOnly: false, expiry: "90" });
    if (!created.ok) throw new Error("expected a token");

    expect(await revokeApiToken(other.id, created.summary.id)).toEqual({ ok: false, reason: "not_found" });
    const revoked = await revokeApiToken(owner.id, created.summary.id);
    expect(revoked.ok && revoked.summary.revokedAt).toBeInstanceOf(Date);
    expect(await revokeApiToken(owner.id, created.summary.id)).toEqual({ ok: false, reason: "already_revoked" });
    expect(await revokeApiToken(owner.id, "not-a-uuid")).toEqual({ ok: false, reason: "not_found" });

    const found = await findApiTokenByHash(hashApiToken(created.token));
    expect(found.found && found.revoked).toBe(true);
  });
});

describe("looking a token up", () => {
  it("finds it by hash with its owner, and reports expiry", async () => {
    const person = await seedUser({ email: "tok-lookup@cornell.edu", role: "admin", name: "Sam Staff" });
    const created = await createApiToken({ userId: person.id, name: "Laptop", readOnly: true, expiry: "30" });
    if (!created.ok) throw new Error("expected a token");

    const found = await findApiTokenByHash(hashApiToken(created.token));
    expect(found).toMatchObject({
      found: true,
      readOnly: true,
      revoked: false,
      expired: false,
      user: { id: person.id, role: "admin", name: "Sam Staff" },
    });

    const db = await getDb();
    await db.update(apiTokens).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(apiTokens.id, created.summary.id));
    const expired = await findApiTokenByHash(hashApiToken(created.token));
    expect(expired.found && expired.expired).toBe(true);

    expect(await findApiTokenByHash(hashApiToken("mlt_unknown"))).toEqual({ found: false });
  });

  it("records last use at most once a minute", async () => {
    const person = await seedUser({ email: "tok-touch@cornell.edu" });
    const created = await createApiToken({ userId: person.id, name: "Laptop", readOnly: false, expiry: "30" });
    if (!created.ok) throw new Error("expected a token");
    const db = await getDb();
    const lastUsed = async () =>
      (await db.select({ at: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.id, created.summary.id)))[0].at;

    expect(await lastUsed()).toBeNull();
    await touchApiToken(created.summary.id);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await touchApiToken(created.summary.id);
    expect((await lastUsed())?.getTime()).toBe(first?.getTime());

    await db.update(apiTokens).set({ lastUsedAt: sql`now() - interval '2 minutes'` }).where(eq(apiTokens.id, created.summary.id));
    await touchApiToken(created.summary.id);
    expect((await lastUsed())!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("connected apps (OAuth grants)", () => {
  async function seedGrant(userId: string, clientId: string, scopes = "openid profile") {
    const db = await getDb();
    await db
      .insert(oauthApplication)
      .values({ id: `app-${clientId}`, clientId, name: `App ${clientId}`, redirectUrls: "https://example.com/cb", type: "public" })
      .onConflictDoNothing();
    await db.insert(oauthAccessToken).values({
      id: `at-${clientId}-${userId}`,
      accessToken: `access-${clientId}-${userId}`,
      refreshToken: `refresh-${clientId}-${userId}`,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
      clientId,
      userId,
      scopes,
    });
  }

  it("lists a person's clients, read-only when the grant says so", async () => {
    const person = await seedUser({ email: "oauth-list@cornell.edu" });
    await seedGrant(person.id, "claude", "openid read_only");
    const apps = await listConnectedApps(person.id);
    expect(apps).toEqual([expect.objectContaining({ clientId: "claude", name: "App claude", readOnly: true })]);

    const found = await findOAuthAccessToken(`access-claude-${person.id}`);
    expect(found).toMatchObject({ found: true, clientId: "claude", scopes: ["openid", "read_only"], expired: false });
    expect(await findOAuthAccessToken("nope")).toEqual({ found: false });
  });

  it("revokes one client's tokens and consent for that person only", async () => {
    const person = await seedUser({ email: "oauth-revoke@cornell.edu" });
    const other = await seedUser({ email: "oauth-other@cornell.edu" });
    await seedGrant(person.id, "chatgpt");
    await seedGrant(other.id, "chatgpt");

    expect(await revokeConnectedApp(person.id, "chatgpt")).toEqual({ ok: true, name: "App chatgpt" });
    expect(await findOAuthAccessToken(`access-chatgpt-${person.id}`)).toEqual({ found: false });
    expect((await findOAuthAccessToken(`access-chatgpt-${other.id}`)).found).toBe(true);
    expect(await revokeConnectedApp(person.id, "chatgpt")).toEqual({ ok: false, reason: "not_found" });
  });
});
