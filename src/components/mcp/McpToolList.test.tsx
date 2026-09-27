import { nextCacheMock } from "../../../test/mocks/next-cache";
import { render, screen, within } from "../../../test/utils/render";
import { CAPABILITIES } from "../../lib/capabilities";
import { describeMcpTools, mcpToolNamesForRole } from "../../lib/capabilities/mcp-catalog";
import type { Role } from "../../lib/auth/roles";
import { McpToolList } from "./McpToolList";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The tool list on `/mcp` (MCP access spec, amendment 2026-09-25): the
 * registry grouped by audience, with the viewer's own tools marked.
 */

const tools = describeMcpTools(CAPABILITIES);

function renderAs(role: Role) {
  return render(<McpToolList tools={tools} usable={mcpToolNamesForRole(CAPABILITIES, role)} viewerRole={role} />);
}

function group(name: string) {
  return screen.getByRole("region", { name });
}

function toolNamesIn(region: HTMLElement): string[] {
  return within(region)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"))
    .filter((name): name is string => Boolean(name));
}

it("groups every tool under Anyone, Signed-in lab members and Staff", () => {
  renderAs("anonymous");
  expect(toolNamesIn(group("Anyone"))).toEqual([
    "list_tools",
    "search_tools",
    "get_tool_details",
    "get_unit_details",
    "get_maintenance_history",
    "search_manual",
  ]);
  expect(toolNamesIn(group("Signed-in lab members"))).toEqual(["report_issue", "report_correction", "list_my_reports"]);
  expect(toolNamesIn(group("Staff"))).toEqual([
    "create_tool",
    "list_intake_queue",
    "list_open_tickets",
    "update_ticket",
    "propose_change",
  ]);
});

it("says read or write for each tool", () => {
  renderAs("anonymous");
  expect(within(screen.getByRole("listitem", { name: "search_tools" })).getByText("Read")).toBeInTheDocument();
  expect(within(screen.getByRole("listitem", { name: "report_issue" })).getByText("Write")).toBeInTheDocument();
});

it.each([
  ["anonymous", 6, "report_issue"],
  ["user", 9, "update_ticket"],
  ["admin", 14, null],
] as const)("marks the tools a %s viewer can use", (role, count, notUsable) => {
  renderAs(role);
  expect(screen.getAllByText("You can use this")).toHaveLength(count);
  expect(within(screen.getByRole("listitem", { name: "search_tools" })).getByText("You can use this")).toBeInTheDocument();
  if (notUsable) {
    expect(within(screen.getByRole("listitem", { name: notUsable })).queryByText("You can use this")).toBeNull();
  }
});

it("tells the viewer what the marker means for their role", () => {
  renderAs("anonymous");
  expect(screen.getByText(/You're not signed in/)).toBeInTheDocument();
});

it("summarises each tool's inputs from its schema", () => {
  renderAs("anonymous");
  const search = screen.getByRole("listitem", { name: "search_tools" });
  expect(within(search).getByText("Inputs (1)")).toBeInTheDocument();
  expect(within(search).getByText("query")).toBeInTheDocument();
  expect(within(search).getByText(/string · required/)).toBeInTheDocument();
  expect(within(screen.getByRole("listitem", { name: "list_open_tickets" })).getByText("No inputs.")).toBeInTheDocument();
});
