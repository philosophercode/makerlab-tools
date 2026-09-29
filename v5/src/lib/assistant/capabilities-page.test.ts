// @vitest-environment node
import en from "../../../messages/en.json";
import { ASSISTANT_FORBIDDEN_ACTIONS, ASSISTANT_FORBIDDEN_CATEGORIES } from "../actions/define";
import { ACTIONS } from "../actions/registry";
import { EXA_SEARCH_TOOL } from "../ai/exa";
import { CAPABILITIES } from "../capabilities";
import { capabilitiesForIdentity } from "../capabilities/access";
import {
  ACTION_AREAS,
  AREAS,
  PAGE_ROLES,
  TOOL_AREAS,
  buildAssistantCapabilities,
  keyOf,
  summaryFor,
} from "./capabilities-page";

/**
 * `/assistant` is generated from the registries (parity spec amendment
 * 2026-09-29). These tests are what keep it that way: every registered action
 * and every capability tool is on the page exactly once, every item on the
 * deny list is under "never", every row has its human words, and who gets a
 * row is what the chat's and MCP's own gates say.
 */

const data = buildAssistantCapabilities(CAPABILITIES, ACTIONS);
const page = (en as unknown as { assistantPage: Record<string, unknown> }).assistantPage;

function has(path: string): boolean {
  let node: unknown = page;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.length > 0;
}

function item(key: string) {
  const found = data.items.find((row) => row.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
}

describe("coverage: generated from the registries", () => {
  it("lists every registered action exactly once, as a row or under never", () => {
    const listed = [
      ...data.items.filter((row) => row.actionId).map((row) => row.actionId!),
      ...data.never.filter((row) => row.key.startsWith("action:")).map((row) => row.key.slice("action:".length)),
    ];
    for (const action of ACTIONS) {
      expect(listed.filter((id) => id === action.id), action.id).toHaveLength(1);
    }
  });

  it("lists every capability tool exactly once — its own row, or its action's", () => {
    const actionToolNames = new Set(ACTIONS.map((action) => action.toolName));
    const names = new Set(CAPABILITIES.flatMap((capability) => capability.tools.map((tool) => tool.name)));
    for (const name of names) {
      const own = data.items.filter((row) => row.key === `tool:${name}`);
      const viaAction = data.items.filter((row) => row.actionId && row.toolName === name);
      expect(own.length + viaAction.length, name).toBe(1);
      if (actionToolNames.has(name)) expect(own, `${name} folds into its action`).toHaveLength(0);
    }
  });

  it("lists every read tool as a read row, and the chat's web search", () => {
    const reads = CAPABILITIES.flatMap((capability) => capability.tools.filter((tool) => tool.kind === "read"));
    expect(reads.length).toBeGreaterThan(10);
    for (const tool of reads) expect(item(`tool:${tool.name}`).kind, tool.name).toBe("read");
    expect(item(`tool:${EXA_SEARCH_TOOL}`)).toMatchObject({ kind: "read", mcp: "none" });
  });

  it("has unique keys", () => {
    const keys = [...data.items.map((row) => row.key), ...data.never.map((row) => row.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every forbidden action, every forbidden category and the super-admin rule under never, and nowhere else", () => {
    const never = new Set(data.never.map((row) => row.key));
    expect(never.has("rule:super_admin")).toBe(true);
    for (const id of Object.keys(ASSISTANT_FORBIDDEN_ACTIONS)) {
      expect(never.has(`action:${id}`), id).toBe(true);
      expect(data.items.some((row) => row.actionId === id), id).toBe(false);
    }
    for (const [category, words] of Object.entries(ASSISTANT_FORBIDDEN_CATEGORIES)) {
      expect(data.never.find((row) => row.key === `category:${category}`)?.words, category).toEqual(words);
    }
    expect(data.never).toHaveLength(1 + Object.keys(ASSISTANT_FORBIDDEN_ACTIONS).length + Object.keys(ASSISTANT_FORBIDDEN_CATEGORIES).length);
  });

  it("never offers a forbidden tool name to anybody on either surface", () => {
    for (const row of data.never) {
      if (!row.toolName) continue;
      expect(data.items.some((r) => r.toolName === row.toolName), row.toolName).toBe(false);
    }
  });
});

describe("the human words", () => {
  it("has a label for every row and a reason for every page-only row", () => {
    for (const row of data.items) {
      expect(has(row.labelKey), row.labelKey).toBe(true);
      if (row.kind === "pageOnly") expect(row.reasonKey && has(row.reasonKey), row.key).toBe(true);
    }
  });

  it("has a label and a reason for every never line", () => {
    for (const row of data.never) {
      expect(has(`never.${row.labelKey}`), row.labelKey).toBe(true);
      expect(has(`never.${row.labelKey}Why`), `${row.labelKey}Why`).toBe(true);
    }
  });

  it("names every area and role, and every flag and kind it uses", () => {
    for (const area of AREAS) expect(has(`areas.${area}`), area).toBe(true);
    for (const role of PAGE_ROLES) expect(has(`roles.${role}`) && has(`roles.${role}Body`), role).toBe(true);
    for (const row of data.items) {
      expect(has(`kind.${row.kind}`)).toBe(true);
      for (const flag of row.flags) expect(has(`flags.${flag}`), flag).toBe(true);
      expect(has(`mcpMode.${row.mcp}`)).toBe(true);
      if (row.mcpAudience) expect(has(`audience.${row.mcpAudience}`)).toBe(true);
    }
  });

  it("maps every tool and action to an area, with no stale entries", () => {
    const toolNames = new Set([
      ...CAPABILITIES.filter((capability) => capability.id !== "actions").flatMap((capability) => capability.tools.map((tool) => tool.name)),
      EXA_SEARCH_TOOL,
    ]);
    const actionToolNames = new Set(ACTIONS.map((action) => action.toolName));
    for (const name of toolNames) if (!actionToolNames.has(name)) expect(TOOL_AREAS[name], name).toBeDefined();
    for (const name of Object.keys(TOOL_AREAS)) expect(toolNames.has(name), `stale ${name}`).toBe(true);
    for (const action of ACTIONS) expect(ACTION_AREAS[action.id.split(".")[0]], action.id).toBeDefined();
  });

  it("keys labels by the action id", () => {
    expect(keyOf("people.set_role")).toBe("people_set_role");
    expect(item("action:people.set_role").labelKey).toBe("actions.people_set_role");
  });
});

describe("who gets what: the gates' own answers", () => {
  it("offers each role in the chat exactly the tools capabilitiesForIdentity gives it", () => {
    for (const role of PAGE_ROLES) {
      const offered = new Set(
        capabilitiesForIdentity(CAPABILITIES, { role }).flatMap((capability) => capability.tools.filter((tool) => !tool.mcpOnly).map((tool) => tool.name))
      );
      offered.add(EXA_SEARCH_TOOL);
      const onPage = new Set(data.items.filter((row) => row.chat[role]).map((row) => row.toolName));
      expect([...onPage].sort(), role).toEqual([...offered].sort());
    }
  });

  it("proposes nothing to a visitor or a lab member", () => {
    for (const role of ["anonymous", "user"] as const) {
      expect(summaryFor(data, role).proposes, role).toBe(0);
    }
    expect(summaryFor(data, "anonymous").records).toBeGreaterThan(0);
  });

  it("gives people changes to a super admin only, with the super-admin note", () => {
    const setRole = item("action:people.set_role");
    expect(setRole.chat).toEqual({ anonymous: false, user: false, admin: false, super_admin: true });
    expect(setRole.flags).toEqual(expect.arrayContaining(["notSuperAdmin", "notAfterOutside"]));
    expect(setRole.mcp).toBe("none");
  });

  it("marks spend and cannot-be-undone rows, and keeps them off MCP", () => {
    expect(item("action:pending.research").flags).toContain("spend");
    expect(item("action:pending.research").mcp).toBe("none");
    expect(item("action:tools.archive").flags).toContain("typedName");
    expect(item("action:tools.archive").mcp).toBe("none");
    expect(item("action:tickets.update").flags).toContain("batch");
  });

  it("gives MCP what its gate gives: reads, filed reports, inbox proposals and the one direct write", () => {
    expect(item("tool:search_tools")).toMatchObject({ mcp: "read", mcpAudience: "anyone" });
    expect(item("tool:list_my_reports")).toMatchObject({ mcp: "read", mcpAudience: "signed_in" });
    expect(item("tool:report_issue")).toMatchObject({ kind: "record", mcp: "record", mcpAudience: "signed_in" });
    expect(item("action:pending.approve")).toMatchObject({ mcp: "inbox", mcpAudience: "staff" });
    expect(item("action:tickets.update")).toMatchObject({ kind: "propose", mcp: "direct", mcpAudience: "staff" });
    expect(item("tool:find_people")).toMatchObject({ mcp: "none", mcpAudience: null });
  });

  it("shows the GUI-only actions as page-only, offered to nobody", () => {
    const row = item("action:insights.set_value_assumptions");
    expect(row.kind).toBe("pageOnly");
    expect(Object.values(row.chat).some(Boolean)).toBe(false);
    expect(row.mcp).toBe("none");
  });
});
