"use server";

import { headers } from "next/headers";
import { runTryIt, type TryItArguments, type TryItResult } from "../../lib/mcp/try-it";

/**
 * `/mcp`'s "Try it" (MCP access spec, amendment 2026-09-25). A server action
 * is a POST endpoint reachable without the page, so it trusts nothing the page
 * sent: `runTryIt` checks the tool against the derived list of public reads and
 * runs it through the MCP handler as an anonymous caller — this request's
 * cookie is never passed on — under the handler's anonymous rate limit.
 */
export async function runMcpTryIt(input: { tool: string; arguments: TryItArguments }): Promise<TryItResult> {
  return runTryIt(input, await headers());
}
