// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { ADMIN_READS_FOR_PROPOSALS, MCP_PROPOSING_TOOLS, SUPER_ADMIN_ONLY_TOOLS } from "../../../test/mcp/expected-tools";
import { mcpAccessFor } from "../../../test/utils/identities";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";

vi.mock("next/cache", () => nextCacheMock());

/**
 * What each identity is offered over MCP (MCP access spec §3.2): the listing
 * is the whole of what a model can see, so it is asserted exactly.
 */

const PUBLIC_READS = [
  "list_tools",
  "search_tools",
  "get_tool_details",
  "get_unit_details",
  "get_maintenance_history",
  "search_manual",
];

const USER_TOOLS = [...PUBLIC_READS, "report_issue", "report_correction", "list_my_reports"];

const ADMIN_TOOLS = [
  ...PUBLIC_READS,
  "report_issue",
  "create_tool",
  "report_correction",
  "list_my_reports",
  "list_intake_queue",
  "list_open_tickets",
  "update_ticket",
  "propose_change",
  // The reads MCP proposals resolve ids with (assistant–GUI parity phase 7).
  ...ADMIN_READS_FOR_PROPOSALS,
  // One proposing tool per `mcp: "propose"` action, in registry order. Never
  // a people, spend or destructive action (§3.8).
  ...MCP_PROPOSING_TOOLS,
];

function names(role: Parameters<typeof mcpAccessFor>[0], readOnly = false): string[] {
  return mcpToolsFor(CAPABILITIES, mcpAccessFor(role, readOnly)).map(({ tool }) => tool.name);
}

describe("the MCP tool list by identity", () => {
  it("offers an anonymous caller the public reads and nothing else", () => {
    expect(names("anonymous")).toEqual(PUBLIC_READS);
  });

  it("offers a student reports, their own reports list, and no staff tool", () => {
    expect(names("user")).toEqual(USER_TOOLS);
    for (const staffTool of ["create_tool", "list_intake_queue", "list_open_tickets", "update_ticket", "propose_change"]) {
      expect(names("user")).not.toContain(staffTool);
    }
  });

  it("offers a SuperMaker the staff tools, and a director those and the usage counts", () => {
    expect(names("admin")).toEqual(ADMIN_TOOLS);
    expect(names("super_admin")).toEqual([...ADMIN_TOOLS, ...SUPER_ADMIN_ONLY_TOOLS]);
  });

  it("gives a read-only token its role's reads and no writes", () => {
    expect(names("admin", true)).toEqual([...PUBLIC_READS, "list_my_reports", "list_intake_queue", "list_open_tickets", ...ADMIN_READS_FOR_PROPOSALS]);
    expect(names("user", true)).toEqual([...PUBLIC_READS, "list_my_reports"]);
  });

  it("never offers a people, spend or destructive action, or find_people, to any credential (§3.8)", () => {
    const never = [
      "find_people",
      "set_person_role",
      "set_person_title",
      "set_person_name",
      "add_person",
      "remove_person",
      "unblock_email",
      "grant_research_allowance",
      "research_pending_items",
      "find_different_image",
      "request_import_suggestions",
      "reprocess_manual",
      "queue_refresh",
      "archive_tool",
      "delete_unit",
      "remove_resource",
      "discard_pending_item",
      "remove_import_rows",
      "disconnect_mirror",
      "sync_mirror",
      "pause_mirror",
    ];
    for (const role of ["anonymous", "user", "admin", "super_admin"] as const) {
      for (const readOnly of [false, true]) {
        const listed = names(role, readOnly);
        expect(listed.filter((name) => never.includes(name)), `${role}${readOnly ? " read-only" : ""}`).toEqual([]);
      }
    }
  });

  it("gives a director a SuperMaker's MCP tools plus the usage counts: nothing about people", () => {
    expect(names("super_admin")).toEqual([...names("admin"), ...SUPER_ADMIN_ONLY_TOOLS]);
    expect(names("super_admin", true)).toEqual([...names("admin", true), ...SUPER_ADMIN_ONLY_TOOLS]);
  });

  it("never offers a chat-only tool", () => {
    for (const role of ["anonymous", "user", "admin", "super_admin"] as const) {
      const listed = names(role);
      for (const chatOnly of ["identify_tools", "start_import", "read_page", "get_record"]) {
        expect(listed).not.toContain(chatOnly);
      }
    }
  });
});
