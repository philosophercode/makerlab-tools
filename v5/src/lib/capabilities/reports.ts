import { z } from "zod";
import { listMyReports, type MyReports } from "../data/my-reports";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `reports` capability (MCP access spec §3.2): `list_my_reports`, the
 * caller's own maintenance tickets and catalogue corrections with the status
 * staff set.
 *
 * MCP-only and signed-in only (`requiresSignIn`): an anonymous caller has no
 * reports to list, and the query is keyed by the verified user id from the
 * caller's token — never by anything in the tool input — so it can only ever
 * return the caller's own rows (§8, "PII").
 */

type ListMyReportsResult = ({ status: "ok" } & MyReports) | { status: "error"; message: string };

const listMyReportsTool: CapabilityTool<Record<string, never>, ListMyReportsResult> = {
  name: "list_my_reports",
  description:
    "List the maintenance tickets and catalog corrections you filed while signed in, newest first, with the status staff have set and any resolution. Only your own reports.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
  mcpOnly: true,
  requiresSignIn: true,
  run: async (_input, ctx: CapabilityCtx): Promise<ListMyReportsResult> => {
    const userId = ctx.identity?.userId;
    // Unreachable through the adapter (`requiresSignIn`), and a refusal rather
    // than an empty list if it is ever reached some other way.
    if (!userId) return { status: "error", message: "Sign in to list your reports." };
    try {
      return { status: "ok", ...(await listMyReports(userId)) };
    } catch (err) {
      console.error("[reports] list_my_reports failed", err instanceof Error ? err.message : "unknown error");
      return { status: "error", message: "Your reports could not be read right now. Try again shortly." };
    }
  },
};

export const reports: Capability = {
  id: "reports",
  // MCP-only: nothing for the chat prompt to say.
  promptFragment: () => "",
  tools: [listMyReportsTool as unknown as CapabilityTool<unknown, unknown>],
};
