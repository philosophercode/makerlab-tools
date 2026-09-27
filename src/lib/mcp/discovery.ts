import "server-only";

import { authBaseUrl, READ_ONLY_SCOPE } from "../auth/config";
import { siteConfig } from "../site-config";

/**
 * OAuth discovery for the MCP endpoints (MCP access spec §3.4; RFC 9728).
 *
 * Each MCP URL is a protected resource with its own metadata document, at
 * `/.well-known/oauth-protected-resource<path>`. Both name this deployment's
 * origin as the authorization server — the Better Auth `mcp` plugin — whose
 * own metadata `/.well-known/oauth-authorization-server` re-serves.
 */

/** The MCP paths that are protected resources. */
export const MCP_RESOURCE_PATHS = ["/api/mcp", "/api/mcp/signed-in"] as const;

/** CORS for the discovery documents: a browser-based client reads them cross-origin. */
export const DISCOVERY_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Cache-Control": "public, max-age=300",
};

export interface ProtectedResourceMetadata {
  resource: string;
  resource_name: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
}

/** The metadata for `path`, or null when it is not one of ours. */
export function protectedResourceMetadata(path: string): ProtectedResourceMetadata | null {
  const normalized = path.replace(/\/+$/, "") || "/api/mcp/signed-in";
  if (!(MCP_RESOURCE_PATHS as readonly string[]).includes(normalized)) return null;
  const origin = authBaseUrl();
  return {
    resource: `${origin}${normalized}`,
    resource_name: siteConfig.name,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email", "offline_access", READ_ONLY_SCOPE],
  };
}
