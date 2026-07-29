import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CAPABILITIES } from "../../../lib/capabilities";
import { registerAll } from "../../../lib/capabilities/mcp-adapter";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

// ── Server factory ─────────────────────────────────────────────────

/**
 * Build a fresh MCP server with every capability tool registered. The capability
 * registry (design spec §3) is the single source of truth for both the chat and
 * MCP surfaces; the MCP adapter (`registerAll`) wraps each tool's `run()` in an
 * MCP handler.
 *
 * `allowWrites` gates `kind: "write"` tools (e.g. `report_issue`, `create_tool`):
 * they are exposed over MCP **only when `MCP_TOKEN` is configured** (which
 * token-gates the whole endpoint). With no token set, the MCP surface is
 * read-only — write tools are omitted entirely (design spec §3.3 / §8).
 */
function createServer(allowWrites: boolean): McpServer {
  const server = new McpServer({ name: "makerlab", version: "1.0.0" });
  registerAll(server, CAPABILITIES, { allowWrites });
  return server;
}

// ── Route handler ──────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  // Optional bearer-token auth: if MCP_TOKEN is set, require it. If unset, the
  // endpoint is open so it works out of the box but can be locked down later.
  const expectedToken = process.env.MCP_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (bearer !== expectedToken) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
        { status: 401 }
      );
    }
  }

  // Always rate-limit. MCP callers are machines with a bearer token rather than
  // a session cookie, so in practice this resolves to the hashed-IP key.
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`mcp:${identity.rateLimitKey}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many requests. Please wait a moment." },
        id: null,
      },
      { status: 429 }
    );
  }

  // GET is used for SSE streams — not supported in stateless serverless mode.
  if (req.method === "GET") {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "SSE not supported in serverless mode" }, id: null },
      { status: 405 }
    );
  }

  // Write capabilities are only exposed when MCP_TOKEN is configured (the
  // endpoint is then token-gated end to end). Read tools stay available.
  const allowWrites = Boolean(expectedToken);
  const server = createServer(allowWrites);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Return JSON instead of SSE — required for serverless
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 }
    );
  }
}

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
