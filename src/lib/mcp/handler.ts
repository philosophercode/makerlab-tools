import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CAPABILITIES } from "../capabilities";
import { registerAll } from "../capabilities/mcp-adapter";
import { authBaseUrl } from "../auth/config";
import { resolveMcpCaller, type McpAuthRefusal, type McpCaller } from "../auth/mcp-caller";
import { checkRateLimit } from "../rate-limit";

/**
 * The MCP endpoint (MCP access spec §3, §5.2), shared by its two URLs:
 *
 * - **`/api/mcp`** — open. No credential gets the public reads; a personal
 *   access token or an OAuth access token gets that person's tools.
 * - **`/api/mcp/signed-in`** — the same server, but a caller with no
 *   credential is answered 401 with a `WWW-Authenticate` header pointing at the
 *   OAuth protected-resource metadata. That 401 is what makes an OAuth-capable
 *   client (claude.ai, ChatGPT) start the sign-in flow; on the open URL it
 *   would never see one, because anonymous access succeeds there (spec
 *   amendment "A second URL for sign-in").
 *
 * Order, each step only as far as the last one earned (Article 4): resolve the
 * caller (a bad token is a 401, never anonymous), rate-limit by identity, then
 * build a server holding only the tools this caller may use. Stateless JSON:
 * no sessions, no SSE — what works on serverless.
 */

export interface McpHandlerOptions {
  /** Answer an anonymous caller 401 + `WWW-Authenticate` instead of the public tools. */
  requireSignIn: boolean;
  /** The path this handler serves — the protected resource the metadata names. */
  resourcePath: string;
}

/** JSON-RPC error codes the route answers outside a method call. */
const UNAUTHORIZED = -32001;
const SERVER_ERROR = -32000;

/** What a refused bearer is told (§3.1 names the categories). */
const REFUSAL_MESSAGES: Record<McpAuthRefusal, string> = {
  unknown_token: "Unauthorized: unknown token.",
  token_revoked: "Unauthorized: token revoked. Create a new one on /account/tokens.",
  token_expired: "Unauthorized: token expired. Create a new one on /account/tokens, or sign in again.",
  account_suspended: "Unauthorized: account suspended.",
  unavailable: "The sign-in service is unavailable right now. Try again shortly.",
};

export async function handleMcpRequest(req: Request, options: McpHandlerOptions): Promise<Response> {
  const resourceMetadata = `${authBaseUrl()}/.well-known/oauth-protected-resource${options.resourcePath}`;

  const auth = await resolveMcpCaller(req);
  if (!auth.ok) {
    if (auth.reason === "unavailable") {
      return rpcError(503, SERVER_ERROR, REFUSAL_MESSAGES.unavailable, { "Retry-After": "30" });
    }
    return rpcError(401, UNAUTHORIZED, REFUSAL_MESSAGES[auth.reason], {
      "WWW-Authenticate": `Bearer error="invalid_token", error_description="${auth.reason}", resource_metadata="${resourceMetadata}"`,
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    });
  }
  const caller = auth.caller;

  if (options.requireSignIn && caller.via !== "token" && caller.via !== "oauth") {
    return rpcError(401, UNAUTHORIZED, "Unauthorized: sign in to use this URL. For the public tools, use /api/mcp.", {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"`,
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    });
  }

  const signedIn = caller.via === "token" || caller.via === "oauth";
  const limit = await checkRateLimit(signedIn ? "mcpSignedIn" : "mcp", caller.identity);
  if (!limit.allowed) {
    return rpcError(429, SERVER_ERROR, "Too many requests. Please wait a moment.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  // GET is used for SSE streams — not supported in stateless serverless mode.
  if (req.method === "GET") {
    return rpcError(405, SERVER_ERROR, "SSE not supported in serverless mode");
  }

  const server = createServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // JSON instead of SSE — required for serverless
  });
  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch {
    return rpcError(500, -32603, "Internal server error");
  }
}

/**
 * A fresh server holding exactly the tools `caller` may use. The capability
 * registry is the single source of truth for both the chat and MCP (design
 * spec §3); `registerAll` filters it by the caller's identity (§3.2).
 */
function createServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: "makerlab", version: "1.0.0" },
    { instructions: instructionsFor(caller) }
  );
  registerAll(server, CAPABILITIES, {
    access: { identity: caller.identity, readOnly: caller.readOnly },
    // The per-identity write ceiling (§5.2), on top of the request limit.
    beforeWrite: async () => {
      const decision = await checkRateLimit("mcpWrite", caller.identity);
      return decision.allowed ? null : "Too many changes in a minute. Wait a moment and try again.";
    },
  });
  return server;
}

/** What the server tells a client about who it is talking as. */
function instructionsFor(caller: McpCaller): string {
  const base =
    "MakerLab Tools: the lab's equipment catalogue — tools, units, availability, maintenance history and manuals.";
  if (caller.via === "anonymous" || caller.via === "legacy_token") {
    return `${base} You are connected without signing in, so only the public read-only tools are available. Maintenance history carries no reporter names.`;
  }
  const scope = caller.readOnly ? " This connection is read-only." : "";
  return `${base} You are acting as a signed-in lab member with the role "${caller.identity.role}"; the tools listed are exactly the ones that role allows.${scope} Nothing you do publishes or edits the catalogue: new tools are drafts and catalogue changes are proposals a person accepts in the app.`;
}

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}
