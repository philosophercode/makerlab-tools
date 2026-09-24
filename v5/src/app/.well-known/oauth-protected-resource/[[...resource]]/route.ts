import { anonymousIdentity } from "../../../../lib/auth/identity";
import { DISCOVERY_HEADERS, protectedResourceMetadata } from "../../../../lib/mcp/discovery";
import { checkRateLimit } from "../../../../lib/rate-limit";

/**
 * `GET /.well-known/oauth-protected-resource[/api/mcp[/signed-in]]` — OAuth
 * protected resource metadata (RFC 9728) for the MCP endpoints (MCP access
 * spec §3.4). The 401 that `/api/mcp/signed-in` answers an anonymous caller
 * points here; the document names this deployment as the authorization server.
 * The bare path answers for `/api/mcp/signed-in`, the URL that asks for sign-in.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ resource?: string[] }> }
): Promise<Response> {
  const limit = await checkRateLimit("auth", await anonymousIdentity(req));
  if (!limit.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const { resource } = await params;
  const metadata = protectedResourceMetadata(resource?.length ? `/${resource.join("/")}` : "");
  if (!metadata) return Response.json({ error: "Not an MCP resource." }, { status: 404, headers: DISCOVERY_HEADERS });
  return Response.json(metadata, { headers: DISCOVERY_HEADERS });
}
