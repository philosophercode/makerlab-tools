// @vitest-environment node
import { z } from "zod";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { mcpAccessFor } from "../../../test/utils/identities";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import { describeMcpTools, mcpToolNamesForRole, summariseInput, tryItToolNames } from "./mcp-catalog";
import type { Capability } from "./types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The `/mcp` page's tool list (MCP access spec, amendment 2026-09-25): it is
 * the registry, and each tool's audience is what the route would do.
 */

const PUBLIC_READS = [
  "list_tools",
  "search_tools",
  "get_tool_details",
  "get_unit_details",
  "get_maintenance_history",
  "search_manual",
];

function audiences() {
  return Object.fromEntries(describeMcpTools(CAPABILITIES).map((tool) => [tool.name, tool.audience]));
}

describe("describeMcpTools", () => {
  it("lists every tool the route can register, in registry order, and no chat-only tool", () => {
    const listed = describeMcpTools(CAPABILITIES).map((tool) => tool.name);
    // Everything a director is offered is everything anyone is offered.
    expect(listed).toEqual(mcpToolsFor(CAPABILITIES, mcpAccessFor("super_admin")).map(({ tool }) => tool.name));
    for (const chatOnly of ["identify_tools", "start_import", "read_page", "get_record"]) {
      expect(listed).not.toContain(chatOnly);
    }
  });

  it("gives each tool the least-privileged audience the route admits", () => {
    const byName = audiences();
    for (const name of PUBLIC_READS) expect(byName[name]).toBe("anyone");
    for (const name of ["report_issue", "report_correction", "list_my_reports"]) expect(byName[name]).toBe("signed_in");
    for (const name of ["create_tool", "list_intake_queue", "list_open_tickets", "update_ticket", "propose_change"]) {
      expect(byName[name]).toBe("staff");
    }
  });

  it("says read or write from the tool's own declaration", () => {
    const kinds = Object.fromEntries(describeMcpTools(CAPABILITIES).map((tool) => [tool.name, tool.kind]));
    expect(kinds.search_tools).toBe("read");
    expect(kinds.report_issue).toBe("write");
    expect(kinds.update_ticket).toBe("write");
  });

  it("picks up a capability added to the registry, with no page change", () => {
    const added: Capability = {
      id: "demo",
      promptFragment: () => "",
      tools: [
        {
          name: "count_widgets",
          description: "Count the widgets.",
          inputSchema: z.object({ colour: z.enum(["red", "blue"]).optional() }),
          kind: "read",
          run: async () => 0,
        },
        {
          name: "approve_widgets",
          description: "Approve widgets.",
          inputSchema: z.object({}),
          kind: "write",
          requiredPermission: "tools.approve",
          run: async () => 0,
        },
        {
          name: "chat_widgets",
          description: "Chat only.",
          inputSchema: z.object({}),
          kind: "read",
          chatOnly: true,
          run: async () => 0,
        },
      ],
    };
    const described = describeMcpTools([...CAPABILITIES, added]);
    const widget = described.find((tool) => tool.name === "count_widgets");
    expect(widget).toMatchObject({ audience: "anyone", kind: "read", capabilityId: "demo" });
    expect(widget?.fields).toEqual([{ name: "colour", type: "string", required: false, enumValues: ["red", "blue"] }]);
    expect(described.find((tool) => tool.name === "approve_widgets")?.audience).toBe("staff");
    expect(described.find((tool) => tool.name === "chat_widgets")).toBeUndefined();
    expect(tryItToolNames([...CAPABILITIES, added]).has("count_widgets")).toBe(true);
    expect(tryItToolNames([...CAPABILITIES, added]).has("approve_widgets")).toBe(false);
  });
});

describe("summariseInput", () => {
  it("summarises the real input schemas: required fields, optional ones and descriptions", () => {
    const tools = Object.fromEntries(describeMcpTools(CAPABILITIES).map((tool) => [tool.name, tool]));
    expect(tools.search_tools.fields).toEqual([
      { name: "query", type: "string", required: true, description: "Search keyword or phrase" },
    ]);
    expect(tools.list_tools.fields.map((field) => [field.name, field.required])).toEqual([
      ["category", false],
      ["location", false],
    ]);
    const tool = tools.search_manual.fields.find((field) => field.name === "tool");
    expect(tool).toMatchObject({ type: "string", required: false });
    const status = tools.update_ticket.fields.find((field) => field.name === "status");
    expect(status?.enumValues?.length).toBeGreaterThan(1);
    expect(tools.list_open_tickets.fields).toEqual([]);
  });

  it("reads numbers and booleans", () => {
    expect(summariseInput(z.object({ limit: z.number().int(), exact: z.boolean().optional() }))).toEqual([
      { name: "limit", type: "integer", required: true },
      { name: "exact", type: "boolean", required: false },
    ]);
  });
});

describe("mcpToolNamesForRole — the page's 'You can use this' marker", () => {
  it("matches what the route offers each role", () => {
    for (const role of ["anonymous", "user", "admin", "super_admin"] as const) {
      expect([...mcpToolNamesForRole(CAPABILITIES, role)]).toEqual(
        mcpToolsFor(CAPABILITIES, mcpAccessFor(role)).map(({ tool }) => tool.name)
      );
    }
  });

  it("gives a visitor who is not signed in the public reads only", () => {
    expect([...mcpToolNamesForRole(CAPABILITIES, "anonymous")]).toEqual(PUBLIC_READS);
  });
});

describe("tryItToolNames", () => {
  it("is exactly the reads an anonymous caller is offered — never a write, never a staff tool", () => {
    expect([...tryItToolNames(CAPABILITIES)]).toEqual(PUBLIC_READS);
  });
});
