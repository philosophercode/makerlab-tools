import type { Capability, CapabilityTool } from "./types";
import { getUsageSummaryTool } from "./usage-summary";
import { getValueReportMcpTool } from "./value-report";

/**
 * Usage insight over MCP (usage insight spec amendment 2026-09-30): the lab's
 * anonymous usage counts for a director's own AI client. Both tools are
 * `mcpOnly` reads on `insights.export`, which only super admins hold, so
 * `mcpToolAllowed` lists them for nobody else; neither carries question text.
 *
 * - `get_usage_summary` — the Insights page's Usage tab for 7 / 30 / 90 days.
 * - `get_value_report` — the MCP twin of the chat's tool (which stays in
 *   `admin-reads`, chat only, on `insights.view`).
 *
 * Last in the registry, after the proposing tools: a separate capability so
 * the super-admin-only tools sit together at the end of every MCP listing.
 * No prompt of its own — the chat never sees these tools.
 */
export const insights: Capability = {
  id: "insights",
  promptFragment: () => "",
  tools: [
    getUsageSummaryTool as unknown as CapabilityTool<unknown, unknown>,
    getValueReportMcpTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
