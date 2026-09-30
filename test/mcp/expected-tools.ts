/**
 * The MCP tool names the listing tests assert exactly (MCP access spec §3.2;
 * assistant–GUI parity spec phase 7). Shared by `capabilities/mcp-access.test.ts`
 * and `api/mcp/route.test.ts`, so a new MCP tool is one edit here.
 */

/** Assistant–GUI parity spec phase 7: the reads an MCP client needs to name ids in a proposal. */
/** Taxonomy v2 added `list_categories` and `list_category_proposals` (spec 2026-09-28 §4.6). */
export const ADMIN_READS_FOR_PROPOSALS = ["list_corrections", "list_project_queue", "get_tool_units", "list_imports", "list_categories", "list_category_proposals"];

/** Every action MCP may propose (§3.8, §11 answer 4): queue and catalogue work, nothing else. */
export const MCP_PROPOSING_TOOLS = [
  "log_completed_maintenance",
  "set_correction_status",
  "set_project_published",
  "set_tool_published",
  "mark_tool_reviewed",
  "restore_tool",
  "add_unit",
  "edit_unit",
  "retire_unit",
  "add_resource",
  "edit_resource",
  "approve_pending_items",
  "add_pending_as_unit",
  "rename_pending_item",
  "edit_pending_items",
  "edit_import_row",
  "set_import_hints",
  "merge_import_row",
  "decide_import_suggestions",
  // Taxonomy v2 (spec 2026-09-28 §4.6); merge_categories is destructive, so never over MCP.
  "propose_category",
  "decide_category_proposal",
  "edit_category",
  "retire_category",
  "recategorize_tool",
];

