import { getAuth } from "../../../lib/auth/config";
import { anonymousIdentity } from "../../../lib/auth/identity";
import { checkRateLimit } from "../../../lib/rate-limit";
import { DISCOVERY_HEADERS } from "../../../lib/mcp/discovery";

/**
 * `GET /.well-known/oauth-authorization-server` — OAuth authorization server
 * metadata (RFC 8414) for MCP clients (MCP access spec §3.4).
 *
 * The document is the Better Auth `mcp` plugin's own (`getMcpOAuthConfig`):
 * the authorize, token and dynamic-registration endpoints under `/api/auth/mcp`,
 * PKCE with S256. The plugin serves it under `/api/auth/.well-known/…`; MCP
 * clients look for it at the origin, so it is re-served here. With sign-in not
 * configured there is no authorization server, and the answer is 404.
 */
export async function GET(req: Request): Promise<Response> {
  const limit = await checkRateLimit("auth", await anonymousIdentity(req));
  if (!limit.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const auth = await getAuth();
  if (!auth) return Response.json({ error: "Sign-in is not configured." }, { status: 404, headers: DISCOVERY_HEADERS });
  const metadata = await auth.api.getMcpOAuthConfig();
  if (!metadata) return Response.json({ error: "Sign-in is not configured." }, { status: 404, headers: DISCOVERY_HEADERS });
  return Response.json(metadata, { headers: DISCOVERY_HEADERS });
}
