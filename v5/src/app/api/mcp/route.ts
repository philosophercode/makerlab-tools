import { handleMcpRequest } from "../../../lib/mcp/handler";

/**
 * `POST /api/mcp` — the MCP endpoint (MCP access spec §3).
 *
 * Open: with no credential it serves the public, read-only tools (the "open
 * MCP"); with `Authorization: Bearer mlt_…` (a personal access token from
 * `/account/tokens`) or an OAuth access token it acts as that person, with
 * their role's tools. A bad, revoked or expired token is a 401, never
 * anonymous. Everything is in `lib/mcp/handler.ts`, shared with
 * `/api/mcp/signed-in`.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

function handler(req: Request): Promise<Response> {
  return handleMcpRequest(req, { requireSignIn: false, resourcePath: "/api/mcp" });
}

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
