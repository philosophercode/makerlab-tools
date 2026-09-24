import { handleMcpRequest } from "../../../../lib/mcp/handler";

/**
 * `POST /api/mcp/signed-in` — the MCP endpoint for clients that sign in with
 * OAuth (MCP access spec §3.4; amendment "A second URL for sign-in").
 *
 * The same server and the same tools as `/api/mcp`, except that a caller with
 * no credential is answered **401 with `WWW-Authenticate: Bearer
 * resource_metadata=…`** instead of the public tools. That challenge is what
 * sends claude.ai or ChatGPT through "Sign in with MakerLab"; on the open URL
 * anonymous access succeeds, so they would never be asked.
 */

function handler(req: Request): Promise<Response> {
  return handleMcpRequest(req, { requireSignIn: true, resourcePath: "/api/mcp/signed-in" });
}

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
