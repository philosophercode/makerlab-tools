import { nextCacheMock } from "../../../test/mocks/next-cache";
import type { Identity } from "../auth/identity";
import type { Role } from "../auth/roles";
import { staff, staffPromptFragment } from "./staff";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The staff capability's chat instructions (MCP access spec amendment
 * 2026-09-25). Which *tools* reach the chat is `access.test.ts`; this pins what
 * the prompt tells the model about them, and that nobody else hears it.
 */

function identity(role: Role): Identity {
  return role === "anonymous"
    ? { role, userId: null, email: null, name: null, rateLimitKey: "ip" }
    : { role, userId: `u-${role}`, email: `${role}@cornell.edu`, name: "Niti Parikh", rateLimitKey: `u-${role}` };
}

const prompt = (role: Role) => staffPromptFragment({ tools: [], identity: identity(role) });

describe("staffPromptFragment", () => {
  it.each(["anonymous", "user"] as const)("says nothing to %s", (role) => {
    expect(prompt(role)).toBe("");
  });

  it("says nothing when no identity is known", () => {
    expect(staffPromptFragment({ tools: [] })).toBe("");
  });

  it.each(["admin", "super_admin"] as const)("gives %s both queues", (role) => {
    const text = prompt(role);
    expect(text).toContain("### Maintenance queue");
    expect(text).toContain("### Intake queue");
    expect(text).toContain("list_open_tickets");
    expect(text).toContain("list_intake_queue");
  });

  it("requires the exact change to be stated and confirmed before update_ticket", () => {
    const text = prompt("admin");
    expect(text).toMatch(/state the exact change and ask for confirmation/);
    expect(text).toMatch(/only after an explicit yes in a later message/);
    // The fields the confirmation must name.
    for (const field of ["status", "priority", "assignee", "resolution note"]) expect(text).toContain(field);
    expect(text).toMatch(/`me`.*`nobody`/);
  });

  it("claims a change only on an updated result, and never shows emails", () => {
    const text = prompt("admin");
    expect(text).toContain('status: "updated"');
    expect(text).toMatch(/email addresses are never shown/);
  });

  it("never puts the caller's email in the prompt", () => {
    expect(prompt("admin")).not.toContain("@cornell.edu");
  });

  it("is the capability's prompt fragment", () => {
    expect(staff.promptFragment).toBe(staffPromptFragment);
  });
});

describe("the staff tools' descriptions", () => {
  const byName = Object.fromEntries(staff.tools.map((tool) => [tool.name, tool]));

  it("are on both surfaces except propose_change, which stays MCP-only", () => {
    expect(byName.list_open_tickets.mcpOnly).toBeFalsy();
    expect(byName.update_ticket.mcpOnly).toBeFalsy();
    expect(byName.list_intake_queue.mcpOnly).toBeFalsy();
    expect(byName.propose_change.mcpOnly).toBe(true);
  });

  it("tell an MCP client to confirm before update_ticket, too", () => {
    expect(byName.update_ticket.description).toMatch(/wait for them to confirm/);
  });

  it("never describe a tool as MCP-only on the public /mcp list", () => {
    for (const tool of staff.tools) expect(tool.description).not.toMatch(/MCP[- ]only/i);
  });
});
