// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET as AUTH_GET, POST as AUTH_POST } from "../../app/api/auth/[...all]/route";
import { GET as AUTHORIZATION_SERVER } from "../../app/.well-known/oauth-authorization-server/route";
import { GET as PROTECTED_RESOURCE } from "../../app/.well-known/oauth-protected-resource/[[...resource]]/route";
import { POST as MCP_POST } from "../../app/api/mcp/route";
import { POST as SIGNED_IN_POST } from "../../app/api/mcp/signed-in/route";
import { decideConsent } from "../account/oauth-consent";
import { getDb, resetDbForTests } from "../db/client";
import { auditEvents, oauthAccessToken, oauthApplication, oauthConsent } from "../db/schema/index";
import { signInAsNew, type SignedInSession } from "../../../test/utils/session";
import { resetAuthForTests } from "./config";

/**
 * "Sign in with MakerLab" end to end (MCP access spec §3.4, Phase 3): the
 * discovery documents, dynamic client registration, the forced consent step,
 * read-only chosen on the consent page, the PKCE token exchange, and the MCP
 * route acting as the person who consented — all through the real Better Auth
 * `mcp` plugin on the demo PGlite database. Google is never involved: the
 * person is signed in with a seeded session, as every auth test here does.
 */

const BASE = "http://localhost";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-oauth-test-secret-0123456789");
  vi.stubEnv("AUTH_BASE_URL", BASE);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  resetAuthForTests();
  setMockHeaders();
  const db = await getDb();
  await db.delete(oauthAccessToken);
  await db.delete(oauthConsent);
  await db.delete(oauthApplication);
  await db.delete(auditEvents);
});

afterAll(() => resetDbForTests());

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function register(name = "Claude"): Promise<string> {
  const res = await AUTH_POST(
    new Request(`${BASE}/api/auth/mcp/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
      body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", client_name: name }),
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()).client_id;
}

function authorizeUrl(clientId: string, challenge: string, prompt?: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: "openid profile email offline_access",
    state: "state-123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(prompt ? { prompt } : {}),
  });
  return `${BASE}/api/auth/mcp/authorize?${query}`;
}

/** Walk registration → authorize → consent for `person`, answering the consent page's buttons. */
async function consentFlow(person: SignedInSession, options: { accept: boolean; readOnly: boolean }) {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const res = await AUTH_GET(
    new Request(authorizeUrl(clientId, challenge, "consent"), { headers: { cookie: person.cookie, "x-forwarded-for": "192.0.2.10" } })
  );
  expect(res.status).toBe(302);
  const consentPage = new URL(res.headers.get("location") ?? "", BASE);
  expect(consentPage.pathname).toBe("/oauth/consent");
  const consentCode = consentPage.searchParams.get("consent_code") ?? "";

  setMockHeaders({ cookie: person.cookie, "x-forwarded-for": "192.0.2.10" });
  const headers = new Headers({ cookie: person.cookie });
  const decision = await decideConsent({ consentCode, accept: options.accept, readOnly: options.readOnly }, headers);
  return { clientId, verifier, consentCode, decision };
}

async function exchange(clientId: string, code: string, verifier: string) {
  const res = await AUTH_POST(
    new Request(`${BASE}/api/auth/mcp/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "192.0.2.10" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }),
    })
  );
  return { status: res.status, body: await res.json() };
}

async function mcpToolNames(accessToken: string, post = MCP_POST, url = `${BASE}/api/mcp`): Promise<string[]> {
  const res = await post(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
        "x-forwarded-for": "192.0.2.11",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()).result.tools as Array<{ name: string }>).map((t) => t.name);
}

describe("discovery", () => {
  it("serves the authorization server metadata at the origin, with PKCE and registration", async () => {
    const res = await AUTHORIZATION_SERVER(new Request(`${BASE}/.well-known/oauth-authorization-server`));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/api/auth/mcp/authorize`,
      token_endpoint: `${BASE}/api/auth/mcp/token`,
      registration_endpoint: `${BASE}/api/auth/mcp/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("serves protected-resource metadata for both MCP URLs, and nothing else", async () => {
    const at = (resource?: string[]) =>
      PROTECTED_RESOURCE(new Request(`${BASE}/.well-known/oauth-protected-resource`), { params: Promise.resolve({ resource }) });
    const signedIn = await (await at(["api", "mcp", "signed-in"])).json();
    expect(signedIn).toMatchObject({ resource: `${BASE}/api/mcp/signed-in`, authorization_servers: [BASE], bearer_methods_supported: ["header"] });
    expect(signedIn.scopes_supported).toContain("read_only");
    expect((await (await at(["api", "mcp"])).json()).resource).toBe(`${BASE}/api/mcp`);
    expect((await (await at()).json()).resource).toBe(`${BASE}/api/mcp/signed-in`);
    expect((await at(["api", "chat"])).status).toBe(404);
  });

  it("answers 404 when sign-in is not configured", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    resetAuthForTests();
    const res = await AUTHORIZATION_SERVER(new Request(`${BASE}/.well-known/oauth-authorization-server`));
    expect(res.status).toBe(404);
  });
});

describe("authorizing an MCP client", () => {
  it("always asks for consent: a request without prompt=consent is sent back with it", async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const res = await AUTH_GET(new Request(authorizeUrl(clientId, challenge), { headers: { "x-forwarded-for": "192.0.2.10" } }));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("prompt")).toBe("consent");
  });

  it("sends somebody who is not signed in to the sign-in page, carrying the request", async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const res = await AUTH_GET(new Request(authorizeUrl(clientId, challenge, "consent"), { headers: { "x-forwarded-for": "192.0.2.10" } }));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/oauth/sign-in");
    expect(location.searchParams.get("client_id")).toBe(clientId);
  });

  it("issues a token after consent that acts as the person, with their role", async () => {
    const person = await signInAsNew({ email: "oauth-flow@cornell.edu", role: "user", name: "Olive OAuth" });
    const { clientId, verifier, decision } = await consentFlow(person, { accept: true, readOnly: false });
    if (!decision.ok) throw new Error(decision.error);
    const back = new URL(decision.redirectURI);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("state-123");

    const { status, body } = await exchange(clientId, back.searchParams.get("code") ?? "", verifier);
    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();

    const names = await mcpToolNames(body.access_token);
    expect(names).toContain("report_issue");
    expect(names).toContain("list_my_reports");
    expect(names).not.toContain("update_ticket");
    // The URL that asks for sign-in accepts the same token.
    expect(await mcpToolNames(body.access_token, SIGNED_IN_POST, `${BASE}/api/mcp/signed-in`)).toContain("list_my_reports");

    const db = await getDb();
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "token.created"));
    expect(event).toMatchObject({ actorUserId: person.user.id, subjectType: "oauth_client", subjectId: clientId, detail: { kind: "oauth", name: "Claude", readOnly: false } });
  });

  it("narrows the grant to read-only when chosen on the consent page", async () => {
    const person = await signInAsNew({ email: "oauth-ro@cornell.edu", role: "admin" });
    const { clientId, verifier, decision } = await consentFlow(person, { accept: true, readOnly: true });
    if (!decision.ok) throw new Error(decision.error);
    const { body } = await exchange(clientId, new URL(decision.redirectURI).searchParams.get("code") ?? "", verifier);
    expect(body.scope.split(" ")).toContain("read_only");

    const names = await mcpToolNames(body.access_token);
    expect(names).toContain("list_open_tickets");
    expect(names).not.toContain("update_ticket");
    expect(names).not.toContain("report_issue");
  });

  it("sends a denial back to the app as access_denied, and grants nothing", async () => {
    const person = await signInAsNew({ email: "oauth-deny@cornell.edu" });
    const { decision } = await consentFlow(person, { accept: false, readOnly: false });
    if (!decision.ok) throw new Error(decision.error);
    expect(new URL(decision.redirectURI).searchParams.get("error")).toBe("access_denied");
    const db = await getDb();
    expect(await db.select().from(oauthAccessToken)).toHaveLength(0);
  });

  it("does not let somebody else answer a person's consent request", async () => {
    const owner = await signInAsNew({ email: "oauth-owner@cornell.edu" });
    const clientId = await register();
    const { challenge } = pkce();
    const res = await AUTH_GET(
      new Request(authorizeUrl(clientId, challenge, "consent"), { headers: { cookie: owner.cookie, "x-forwarded-for": "192.0.2.10" } })
    );
    const consentCode = new URL(res.headers.get("location") ?? "", BASE).searchParams.get("consent_code") ?? "";

    const intruder = await signInAsNew({ email: "oauth-intruder@cornell.edu" });
    setMockHeaders({ cookie: intruder.cookie, "x-forwarded-for": "192.0.2.12" });
    const decision = await decideConsent({ consentCode, accept: true, readOnly: false }, new Headers({ cookie: intruder.cookie }));
    expect(decision).toEqual({ ok: false, error: "expired" });
  });
});
