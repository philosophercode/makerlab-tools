import { redirectBlockedSignIn } from "../../../../lib/auth/blocked-sign-in";
import { AUTH_BASE_PATH, getAuth, hasGoogleEnv } from "../../../../lib/auth/config";
import { anonymousIdentity } from "../../../../lib/auth/identity";
import { allowedEmails } from "../../../../lib/auth/roles";
import { checkRateLimit } from "../../../../lib/rate-limit";

/**
 * `GET|POST /api/auth/*` — the Better Auth handler (data platform design spec
 * §3.4).
 *
 * The route decides nothing. It rate-limits, then hands the request to the
 * configured instance; the domain check, the session row, and the
 * rejected-domain redirect all live in `lib/auth/config.ts`.
 *
 * Two things can be unconfigured, and they are now separate. Without
 * `AUTH_SECRET` there is no instance at all. With a secret but no Google client
 * there *is* one — the E2E suite runs exactly that way, with seeded sessions
 * and no OAuth — but the social sign-in endpoint has nothing to start, so it
 * answers 503 rather than a library error. 503 is what `sign-in-client.ts`
 * reads as "this deployment has no sign-in set up" and renders as such.
 *
 * Either way the deployment still serves the catalogue and the assistant:
 * sign-in unlocks, it does not gate the front door.
 *
 * **The one thing the route does decide is that some plugin HTTP endpoints are
 * not part of the public surface:** the admin plugin's (see
 * {@link isPluginAdminPath}), and two of the mcp plugin's (see
 * {@link isUnexposedMcpPath}). It also refuses to redeem an authorization code
 * that is still waiting for the person's consent (see
 * {@link refusePendingConsentCode}).
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

const NOT_CONFIGURED = { error: "Sign-in is not configured." };

const ADMIN_NOT_EXPOSED = {
  error: "Account administration is not available over this API. Use /admin/users.",
  code: "admin_api_not_exposed",
};

const MCP_ENDPOINT_NOT_EXPOSED = {
  error: "This endpoint is not available over this API. Consent is given on /oauth/consent.",
  code: "mcp_endpoint_not_exposed",
};

async function handle(req: Request): Promise<Response> {
  // Always by IP: the whole point of these endpoints is that the caller has no
  // session yet (Article 4 — limit inbound before any outbound to Google).
  const identity = await anonymousIdentity(req);
  const { allowed, retryAfterSeconds } = await checkRateLimit("auth", identity);
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  // Before the instance is even asked for: this refusal does not depend on
  // configuration, and an unconfigured deployment should answer it the same way.
  if (isPluginAdminPath(req)) {
    return Response.json(ADMIN_NOT_EXPOSED, { status: 403 });
  }
  if (isUnexposedMcpPath(req)) {
    return Response.json(MCP_ENDPOINT_NOT_EXPOSED, { status: 403 });
  }

  const consentRedirect = forceConsent(req);
  if (consentRedirect) return consentRedirect;

  const auth = await getAuth();
  if (!auth) return Response.json(NOT_CONFIGURED, { status: 503 });
  if (isSocialSignIn(req) && !hasGoogleEnv()) {
    return Response.json(NOT_CONFIGURED, { status: 503 });
  }
  const pendingRefusal = await refusePendingConsentCode(req, auth);
  if (pendingRefusal) return pendingRefusal;

  // A blocked address (auth spec amendment 2026-09-25), or one outside the
  // domain (amendment 2026-10-07), comes back from the OAuth callback as Better
  // Auth's generic error redirect; it is sent to the page that says why instead.
  // With no named exceptions the provider sends `hd`, and its own claim check
  // is where a personal account is refused (`config.ts`).
  return redirectBlockedSignIn(await auth.handler(req), {
    hostedDomainOnly: allowedEmails().length === 0,
  });
}

/**
 * Every MCP OAuth authorization asks the person first (MCP access spec §3.4).
 *
 * The `mcp` plugin only shows its consent page when the client sends
 * `prompt=consent`; otherwise it issues a code to any registered client for
 * whoever holds a session. Registration is open (dynamic client registration
 * is how claude.ai and ChatGPT connect), so without this a page could send a
 * signed-in person's browser through `/mcp/authorize` to a redirect URI of its
 * own choosing and walk away with a grant. So an authorization request whose
 * `prompt` is not exactly `consent` is sent back to itself with `prompt=consent`
 * — one redirect, before the plugin ever sees it.
 *
 * **Exactly, not "contains".** The plugin tests `query.prompt === "consent"`;
 * any other value — `none`, `CONSENT`, `login consent`, `none consent`, or the
 * parameter given twice — skips its consent page and sends the code straight to
 * the redirect URI. So every other value, and every repeat, is replaced rather
 * than added to (security fix 2026-10-05).
 */
function forceConsent(req: Request): Response | null {
  if (req.method !== "GET") return null;
  if (normalizedPath(req) !== `${AUTH_BASE_PATH}/mcp/authorize`) return null;
  const url = new URL(req.url);
  const prompt = url.searchParams.getAll("prompt");
  if (prompt.length === 1 && prompt[0] === "consent") return null;
  url.searchParams.delete("prompt");
  url.searchParams.set("prompt", "consent");
  return Response.redirect(url.toString(), 302);
}

/**
 * True for the two mcp plugin endpoints the app never calls over HTTP
 * (security audit 2026-10-23):
 *
 * - **`/oauth2/consent`** finishes a pending authorization for *whoever's*
 *   consent code it is given. It checks that the caller has a session, not
 *   that the session is the code's owner, and it skips the read-only option and
 *   the `token.created` audit. Consent is given on `/oauth/consent`, whose
 *   server action (`decideConsent`) checks all three and calls
 *   `auth.api.oAuthConsent` in process.
 * - **`/mcp/get-session`** returns the whole token row to the holder of an
 *   access token, refresh token included, so a leaked one-hour token could
 *   renew itself indefinitely. The app resolves tokens itself
 *   (`findOAuthAccessToken`).
 *
 * Decoded and lower-cased, like {@link isPluginAdminPath}.
 */
function isUnexposedMcpPath(req: Request): boolean {
  const path = normalizedPath(req).replace(/\/+$/, "");
  return path === `${AUTH_BASE_PATH}/oauth2/consent` || path === `${AUTH_BASE_PATH}/mcp/get-session`;
}

type AuthInstance = NonNullable<Awaited<ReturnType<typeof getAuth>>>;

/**
 * Refuse `POST /mcp/token` for a code that still awaits consent (security
 * audit 2026-10-23).
 *
 * The plugin keeps the consent page's `consent_code` as an ordinary
 * authorization-code row marked `requireConsent`, and its token endpoint
 * never reads that mark. The client already holds its own id, redirect URI and
 * PKCE verifier, so without this check a pending code would be a grant before
 * the person pressed Allow. Allowing re-keys the row under a new code without
 * the mark, so the real exchange is untouched. The body is read from a clone;
 * the plugin still gets the original.
 */
async function refusePendingConsentCode(req: Request, auth: AuthInstance): Promise<Response | null> {
  if (req.method !== "POST") return null;
  if (normalizedPath(req).replace(/\/+$/, "") !== `${AUTH_BASE_PATH}/mcp/token`) return null;
  let code = "";
  try {
    const type = req.headers.get("content-type") ?? "";
    const text = await req.clone().text();
    const body: unknown = type.includes("json") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
    const value = (body as { code?: unknown } | null)?.code;
    code = typeof value === "string" ? value : "";
  } catch {
    return null; // The plugin answers a body it cannot read.
  }
  if (!code) return null;
  const row = await (await auth.$context).internalAdapter.findVerificationValue(code);
  let pending = false;
  try {
    pending = Boolean(row && (JSON.parse(row.value) as { requireConsent?: unknown }).requireConsent);
  } catch {
    pending = false;
  }
  if (!pending) return null;
  return Response.json(
    { error: "invalid_grant", error_description: "This authorization is still waiting for consent." },
    { status: 400 }
  );
}

/** True for `POST /api/auth/sign-in/social`, the one endpoint Google gates. */
function isSocialSignIn(req: Request): boolean {
  return normalizedPath(req) === `${AUTH_BASE_PATH}/sign-in/social`;
}

/**
 * True for anything the admin plugin mounts — `/api/auth/admin/set-role`,
 * `/admin/ban-user`, `/admin/update-user`, and the rest.
 *
 * **Those endpoints are a second, weaker way to do everything `/admin/users`
 * does.** The plugin authorizes them against the *stored* `user.role` and
 * nothing else: no audit event is written (`recordAuditEvent` has exactly two
 * call sites, both in `app/admin/users/actions.ts`), the super-admin floor is
 * not consulted, the "last super admin" guard does not exist, and they are
 * outside `ADMIN_ACTION_TIER`. A director's session cookie — borrowed laptop,
 * XSS, an exfiltrated cookie — would therefore be able to change roles from the
 * browser console leaving no trace in `audit_events`, which is the one hole an
 * audit trail must not have (spec §4.11).
 *
 * So the app does not expose them. v5 calls `auth.api.setRole` / `banUser` /
 * `unbanUser` **in process**, from the server actions that carry the guarantees;
 * `auth.api.*` never travels through this handler, so refusing the HTTP paths
 * costs the application nothing. Nothing in the app or the E2E suite calls
 * `/api/auth/admin/*` — there is no Better Auth *client* in the codebase at all.
 *
 * 403 rather than 404 on purpose (Article 4): the endpoint is real and the
 * caller is told why it will not answer, instead of being told a comfortable
 * lie about what exists.
 */
function isPluginAdminPath(req: Request): boolean {
  const prefix = `${AUTH_BASE_PATH}/admin`;
  // Decoded and lower-cased before comparing, so `%61dmin` and `/ADMIN/` are
  // the same path to this check as they may be to the router underneath. There
  // is nothing else under `/api/auth` named `admin`, so matching loosely here
  // can only ever over-refuse an endpoint that does not exist.
  return normalizedPath(req).startsWith(prefix);
}

/**
 * The request's pathname, percent-decoded and lower-cased. `""` for a URL that
 * will not parse or will not decode — neither can reach a real endpoint, and a
 * path this function cannot read is not one to wave through.
 */
function normalizedPath(req: Request): string {
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return "";
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return "";
  }
  return pathname.toLowerCase();
}

export const GET = handle;
export const POST = handle;
