/**
 * `/assistant`'s body (parity spec amendment 2026-09-29): the viewer's own
 * column highlighted, every row labelled in words (never a raw key), the
 * deny list under "never" with its reasons, and the MCP column.
 */
import { ACTIONS } from "../../lib/actions/registry";
import { buildAssistantCapabilities } from "../../lib/assistant/capabilities-page";
import { CAPABILITIES } from "../../lib/capabilities";
import { render, screen, within } from "../../../test/utils/render";
import { AssistantCapabilities } from "./AssistantCapabilities";

const data = buildAssistantCapabilities(CAPABILITIES, ACTIONS);

function row(container: HTMLElement, key: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-item="${key}"]`);
  if (!found) throw new Error(`no row ${key}`);
  return found;
}

describe("AssistantCapabilities", () => {
  it("renders one row per item, each labelled in words", () => {
    const { container } = render(<AssistantCapabilities data={data} viewerRole="anonymous" />);
    const rows = container.querySelectorAll("[data-item]");
    expect(rows).toHaveLength(data.items.length);
    for (const el of rows) {
      const label = el.querySelector("th")?.textContent ?? "";
      expect(label, el.getAttribute("data-item") ?? "").not.toMatch(/^(tools|actions)\./);
    }
    expect(within(row(container, "tool:search_tools")).getByText("Find equipment (“what can cut acrylic?”)")).toBeInTheDocument();
  });

  it("highlights the viewer's own column and says what it can do for them", () => {
    const { container } = render(<AssistantCapabilities data={data} viewerRole="admin" />);
    const current = container.querySelector('th[aria-current="true"]');
    expect(current).toHaveAttribute("data-role", "admin");
    expect(current).toHaveTextContent("You");
    expect(screen.getByText("You're signed in as an admin. Your column is highlighted below.")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=for-you]")).toHaveTextContent(/prepare \d+ kinds of change for you to confirm/);
  });

  it("tells a visitor that sign-in unlocks more, and proposes them nothing", () => {
    const { container } = render(<AssistantCapabilities data={data} viewerRole="anonymous" />);
    const forYou = container.querySelector<HTMLElement>("[data-slot=for-you]")!;
    expect(forYou).toHaveTextContent("prepare no changes for you to confirm");
    expect(forYou).toHaveTextContent("Signing in unlocks");
  });

  it("marks credits, the typed name and the MCP inbox on the rows that carry them", () => {
    const { container } = render(<AssistantCapabilities data={data} viewerRole="super_admin" />);
    expect(row(container, "action:pending.research")).toHaveTextContent("spends research credits");
    expect(row(container, "action:tools.archive")).toHaveTextContent("can't be undone — type the name to confirm");
    expect(row(container, "action:pending.approve").querySelector("[data-mcp=inbox]")).toHaveTextContent("Inbox");
    expect(row(container, "action:tickets.update").querySelector("[data-mcp=direct]")).toHaveTextContent("Direct");
  });

  it("lists the deny list under never, each with its reason", () => {
    render(<AssistantCapabilities data={data} viewerRole="super_admin" />);
    const never = screen.getByRole("region", { name: "Never, on any surface, whatever your role" });
    expect(within(never).getAllByRole("listitem")).toHaveLength(data.never.length);
    expect(never).toHaveTextContent("Make someone a super admin, or change a super admin's role");
    expect(never).toHaveTextContent("Grant research allowances");
    expect(never).toHaveTextContent("Disconnect the Notion mirror");
    expect(never).toHaveTextContent("Send emails or messages");
    expect(never).toHaveTextContent("It never speaks for the lab outside the app.");
    expect(never).toHaveTextContent("Refused in any tool's name:");
  });

  it("links the MCP page", () => {
    render(<AssistantCapabilities data={data} viewerRole="user" />);
    expect(screen.getByRole("link", { name: "The MCP server: connect your own AI" })).toHaveAttribute("href", "/mcp");
  });
});
