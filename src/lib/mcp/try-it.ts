import "server-only";

import { CAPABILITIES } from "../capabilities";
import { tryItToolNames } from "../capabilities/mcp-catalog";
import { authBaseUrl } from "../auth/config";
import { handleMcpRequest } from "./handler";

/**
 * "Try it" on the public `/mcp` page (MCP access spec, amendment 2026-09-25):
 * run one public read the way an MCP client would, **as an anonymous caller**.
 *
 * The call goes through `handleMcpRequest`, the MCP route's own function, with
 * a JSON-RPC `tools/call` request built here. That request carries only the
 * content headers and the visitor's forwarded IP — **never a cookie and never
 * `Authorization`** — so whoever is signed in to the page, the server sees
 * nobody: public manuals only, no reporter names, no drafts, no staff tools.
 * The handler's anonymous `mcp` tier (30 a minute per IP) applies, the same
 * bucket as calling `/api/mcp` directly.
 *
 * Nothing from the page is trusted: the tool must be one of the derived
 * `tryItToolNames` (a `read` offered to an anonymous caller), so a write is
 * refused here before any call, and the arguments must be a small flat object.
 */

/** The largest arguments object accepted, as JSON. */
export const TRY_IT_MAX_INPUT_CHARS = 2000;

export type TryItRefusal = "not_runnable" | "invalid_input";

export type TryItArguments = Record<string, string | number | boolean>;

export type TryItResult =
  | {
      ok: true;
      /** The HTTP status the MCP handler answered. */
      status: number;
      /** How long the handler took, in milliseconds. */
      durationMs: number;
      /** The JSON-RPC response body, parsed (or its text, when it was not JSON). */
      response: unknown;
    }
  | { ok: false; error: TryItRefusal };

/** The only request headers carried over: the visitor's address, for the rate limit. */
const FORWARDED_IP_HEADERS = ["x-forwarded-for", "x-real-ip"] as const;

interface HeaderSource {
  get(name: string): string | null;
}

export async function runTryIt(input: unknown, requestHeaders: HeaderSource): Promise<TryItResult> {
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;
  if (!tryItToolNames(CAPABILITIES).has(parsed.tool)) return { ok: false, error: "not_runnable" };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  for (const name of FORWARDED_IP_HEADERS) {
    const value = requestHeaders.get(name);
    if (value) headers[name] = value;
  }

  const request = new Request(`${authBaseUrl()}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: parsed.tool, arguments: parsed.arguments },
    }),
  });

  const started = performance.now();
  const res = await handleMcpRequest(request, { requireSignIn: false, resourcePath: "/api/mcp" });
  const text = await res.text();
  const durationMs = Math.round(performance.now() - started);

  let response: unknown = text;
  try {
    response = JSON.parse(text);
  } catch {
    // Not JSON: show the text as it came.
  }
  return { ok: true, status: res.status, durationMs, response };
}

function parseInput(
  input: unknown
): { ok: true; tool: string; arguments: TryItArguments } | { ok: false; error: TryItRefusal } {
  if (!isPlainObject(input) || typeof input.tool !== "string") return { ok: false, error: "invalid_input" };
  const args = input.arguments ?? {};
  if (!isPlainObject(args)) return { ok: false, error: "invalid_input" };

  const clean: TryItArguments = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" || typeof value === "boolean") clean[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else return { ok: false, error: "invalid_input" };
  }
  if (JSON.stringify(clean).length > TRY_IT_MAX_INPUT_CHARS) return { ok: false, error: "invalid_input" };
  return { ok: true, tool: input.tool, arguments: clean };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
