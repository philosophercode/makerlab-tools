// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

const auditFailure = vi.hoisted(() => ({ on: false }));
vi.mock("../data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/audit")>();
  return {
    ...actual,
    recordAuditEvent: (...args: Parameters<typeof actual.recordAuditEvent>) =>
      auditFailure.on ? Promise.reject(new Error("audit down")) : actual.recordAuditEvent(...args),
  };
});

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../auth/config";
import { hashApiToken } from "../auth/api-token-format";
import { getDb, resetDbForTests } from "../db/client";
import { apiTokens, auditEvents, oauthAccessToken, oauthApplication } from "../db/schema/index";
import { signInAsNew } from "../../../test/utils/session";
import { createToken, revokeApp, revokeToken } from "./token-actions";

/**
 * `/account/tokens`' actions (MCP access spec §5.1, §4.2): each gates itself,
 * the token is answered once, and create and revoke are audited with the
 * display prefix — never the token.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "token-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  auditFailure.on = false;
  setMockHeaders();
  const db = await getDb();
  await db.delete(apiTokens);
  await db.delete(auditEvents);
  await db.delete(oauthAccessToken);
  await db.delete(oauthApplication);
});

afterAll(() => resetDbForTests());

async function signIn(email: string) {
  const signedIn = await signInAsNew({ email });
  setMockHeaders({ cookie: signedIn.cookie, "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` });
  return signedIn;
}

describe("createToken", () => {
  it("refuses an anonymous caller", async () => {
    expect(await createToken({ name: "x", expiry: "90", readOnly: false })).toEqual({ ok: false, error: "not_signed_in" });
  });

  it("creates the token, answers it once, and audits token.created without it", async () => {
    const me = await signIn("actions-create@cornell.edu");
    const result = await createToken({ name: "Laptop", expiry: "30", readOnly: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.token).toMatch(/^mlt_/);
    expect(result.summary).toMatchObject({ name: "Laptop", readOnly: true });
    expect(result.warning).toBeUndefined();

    const db = await getDb();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, result.summary.id));
    expect(row).toMatchObject({ userId: me.user.id, tokenHash: hashApiToken(result.token) });

    const [event] = await db.select().from(auditEvents);
    expect(event).toMatchObject({
      action: "token.created",
      actorUserId: me.user.id,
      subjectType: "api_token",
      subjectId: result.summary.id,
      detail: { kind: "token", name: "Laptop", prefix: result.summary.prefix, readOnly: true },
    });
    expect(JSON.stringify(event)).not.toContain(result.token.slice(12));
  });

  it("refuses an expiry outside the choices", async () => {
    await signIn("actions-invalid@cornell.edu");
    expect(await createToken({ name: "x", expiry: "forever", readOnly: false })).toEqual({ ok: false, error: "invalid_field" });
  });

  it("reports a lost audit event as a warning on a success — the token exists", async () => {
    await signIn("actions-audit-down@cornell.edu");
    auditFailure.on = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createToken({ name: "Laptop", expiry: "90", readOnly: false });
    expect(result).toMatchObject({ ok: true, warning: "audit_unavailable" });
  });

  it("never logs the token", async () => {
    await signIn("actions-quiet@cornell.edu");
    const spies = (["log", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level));
    const result = await createToken({ name: "Laptop", expiry: "90", readOnly: false });
    if (!result.ok) throw new Error(result.error);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(result.token.slice(12));
  });
});

describe("revokeToken", () => {
  it("revokes the caller's own token and audits token.revoked", async () => {
    const me = await signIn("actions-revoke@cornell.edu");
    const created = await createToken({ name: "Laptop", expiry: "90", readOnly: false });
    if (!created.ok) throw new Error(created.error);

    expect(await revokeToken(created.summary.id)).toEqual({ ok: true });
    expect(await revokeToken(created.summary.id)).toEqual({ ok: false, error: "already_revoked" });

    const db = await getDb();
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "token.revoked"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: me.user.id, subjectId: created.summary.id, detail: { prefix: created.summary.prefix } });
  });

  it("cannot revoke somebody else's token", async () => {
    await signIn("actions-owner@cornell.edu");
    const created = await createToken({ name: "Laptop", expiry: "90", readOnly: false });
    if (!created.ok) throw new Error(created.error);
    await signIn("actions-intruder@cornell.edu");
    expect(await revokeToken(created.summary.id)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("revokeApp", () => {
  it("disconnects an OAuth client for the caller and audits it", async () => {
    const me = await signIn("actions-app@cornell.edu");
    const db = await getDb();
    await db.insert(oauthApplication).values({ id: "app-x", clientId: "client-x", name: "Claude", redirectUrls: "https://claude.ai/cb", type: "public" });
    await db.insert(oauthAccessToken).values({
      id: "at-x",
      accessToken: "access-x",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      clientId: "client-x",
      userId: me.user.id,
      scopes: "openid",
    });
    expect(await revokeApp("client-x")).toEqual({ ok: true });
    expect(await db.select().from(oauthAccessToken)).toHaveLength(0);
    const [event] = await db.select().from(auditEvents);
    expect(event).toMatchObject({ action: "token.revoked", subjectType: "oauth_client", subjectId: "client-x", detail: { kind: "oauth", name: "Claude" } });
  });
});
