// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { z } from "zod";
import type { Identity } from "../auth/identity";
import { can, type Permission } from "../auth/permissions";
import type { Role } from "../auth/roles";
import { CAPABILITIES, capabilitiesForIdentity, mcpToolsFor } from "../capabilities";
import { describeMcpTools } from "../capabilities/mcp-catalog";
import { curationCapability } from "../capabilities/curation";
import { probeIdentity } from "../capabilities/mcp-catalog";
import type { Capability, CapabilityTool } from "../capabilities/types";
import { getDb, resetDbForTests } from "../db/client";
import { feedback, maintenanceLogs, session, user } from "../db/schema/index";
import { seedUser } from "../../../test/utils/session";
import {
  ASSISTANT_FORBIDDEN_ACTIONS,
  assistantForbiddenReason,
  assistantMayPropose,
  assistantToolForbidden,
  defineAction,
  forbiddenCategoryOf,
} from "./define";
import { ACTION_DEFINITIONS } from "./registry";

/**
 * The assistant's limits (owner decision 2026-09-27; parity spec amendment
 * "Assistant limits"). The assistant — the chat and every MCP client — acts
 * only as the signed-in person, never past their role, and never does a short
 * list of things on any surface whatever that role is. These tests hold the
 * deny list to the registry and to the tool lists both surfaces are actually
 * offered, so a future action or capability in a forbidden category fails
 * here rather than reaching a model.
 */

const ROLES_PROBED: Role[] = ["anonymous", "user", "admin", "super_admin"];

/** The owner's list, by tool name as the model would see it. */
const TAKEN_OFF = ["remove_person", "unblock_email", "grant_research_allowance", "disconnect_mirror"];

/** Every capability either surface can compose, curation's included. */
const ALL_CAPABILITIES: Capability[] = [...CAPABILITIES, curationCapability("tool"), curationCapability("pending")];

function chatTools(role: Role): CapabilityTool<unknown, unknown>[] {
  return capabilitiesForIdentity(ALL_CAPABILITIES, probeIdentity(role)).flatMap((c) => c.tools.filter((t) => !t.mcpOnly));
}

function mcpTools(role: Role): CapabilityTool<unknown, unknown>[] {
  return mcpToolsFor(CAPABILITIES, { identity: probeIdentity(role), readOnly: false }).map(({ tool }) => tool);
}

describe("the deny list's categories", () => {
  it.each([
    ["secrets.read_env", "secrets"],
    ["settings.set_secret", "secrets"],
    ["tokens.create", "tokens"],
    ["create_token", "tokens"],
    ["hosting.deploy", "hosting"],
    ["promote_deployment", "hosting"],
    ["db.run_sql", "database"],
    ["run_sql", "database"],
    ["backups.restore", "backups"],
    ["data.push", "backups"],
    ["audit.delete_event", "audit"],
    ["edit_audit_event", "audit"],
    ["people.export_emails", "export"],
    ["download_roster_csv", "export"],
    ["messages.send", "messaging"],
    ["send_email", "messaging"],
    ["notify_people", "messaging"],
    ["people.block_email", "export"],
    ["people.ban", "people"],
  ])("forbids %s (%s)", (name, category) => {
    expect(forbiddenCategoryOf(name)).toBe(category);
    expect(assistantToolForbidden(name)).toBe(true);
  });

  it("forbids none of the tools either surface offers today (a false match would hide a real ability)", () => {
    const names = new Set([...CAPABILITIES, curationCapability("tool")].flatMap((c) => c.tools.map((t) => t.name)));
    const flagged = [...names].filter((name) => assistantToolForbidden(name));
    // Only the actions the owner took off are allowed to match, and those are
    // not tools any more.
    expect(flagged).toEqual([]);
  });
});

describe("defineAction refuses a forbidden action that is not \"never\"", () => {
  const base = {
    description: "Test.",
    permission: "users.manage" as const,
    risk: "people" as const,
    input: z.object({}),
    invalidInput: "invalid_field" as const,
    subject: () => ({ type: "user" as const, id: "u" }),
    run: async () => ({ ok: true as const, value: {} }),
  };

  it.each([
    ["people.grant_allowance", "grant_research_allowance"],
    ["people.remove", "remove_person"],
    ["people.unblock_email", "unblock_email"],
    ["people.block_email", "block_email"],
    ["mirror.disconnect", "disconnect_mirror"],
    ["secrets.set_env", "set_env"],
    ["db.query", "run_sql"],
    ["audit.edit", "edit_audit_event"],
    ["messages.send", "send_message"],
  ])("%s", (id, toolName) => {
    expect(() => defineAction({ ...base, id, toolName })).toThrow(/assistant may never offer this/);
    expect(defineAction({ ...base, id, toolName, assistant: "never", neverReason: "owner decision" }).mcp).toBe("never");
  });

  it("refuses a \"never\" action that still carries a tool", () => {
    const tool = { schema: z.object({}), toInputs: async () => ({ ok: true as const, inputs: [{}] }) };
    expect(() => defineAction({ ...base, id: "people.remove", toolName: "remove_person", assistant: "never", neverReason: "x", tool })).toThrow(
      /carries no tool/
    );
  });
});

describe("the registry", () => {
  it("marks every action on the deny list \"never\", with no tool, no preview and no MCP exposure", () => {
    const forbidden = ACTION_DEFINITIONS.filter((def) => assistantForbiddenReason(def));
    expect(forbidden.map((def) => def.id).sort()).toEqual(
      ["mirror.disconnect", "people.grant_allowance", "people.remove", "people.unblock_email"].sort()
    );
    for (const def of forbidden) {
      expect(def.assistant, def.id).toBe("never");
      expect(def.mcp, def.id).toBe("never");
      expect(def.tool, def.id).toBeUndefined();
      expect(def.preview, def.id).toBeUndefined();
      expect(assistantMayPropose(def), def.id).toBe(false);
    }
  });

  it("names on the id list only actions that exist, or the one future action it pre-empts", () => {
    const ids = new Set(ACTION_DEFINITIONS.map((def) => def.id));
    expect(Object.keys(ASSISTANT_FORBIDDEN_ACTIONS).filter((id) => !ids.has(id))).toEqual(["people.block_email"]);
  });

  it("keeps people.set_role on the assistant, for user and admin changes", () => {
    const setRole = ACTION_DEFINITIONS.find((def) => def.id === "people.set_role")!;
    expect(assistantMayPropose(setRole)).toBe(true);
    expect(setRole.mcp).toBe("never");
  });
});

describe("what each surface is offered, for every role", () => {
  it.each(ROLES_PROBED)("offers %s nothing forbidden, in the chat or over MCP", (role) => {
    for (const tools of [chatTools(role), mcpTools(role)]) {
      const names = tools.map((t) => t.name);
      expect(names.filter((name) => TAKEN_OFF.includes(name))).toEqual([]);
      expect(names.filter((name) => assistantToolForbidden(name))).toEqual([]);
    }
  });

  it("lists nothing forbidden on the public /mcp page", () => {
    const names = describeMcpTools(CAPABILITIES).map((t) => t.name);
    expect(names.filter((name) => TAKEN_OFF.includes(name) || assistantToolForbidden(name))).toEqual([]);
  });

  it.each(ROLES_PROBED)("offers %s only tools whose permission that role holds (never past the role)", (role) => {
    const identity = probeIdentity(role);
    for (const capability of capabilitiesForIdentity(ALL_CAPABILITIES, identity)) {
      for (const tool of capability.tools) {
        if (capability.requiredPermission) expect(can(identity, capability.requiredPermission), `${tool.name} for ${role}`).toBe(true);
        if (tool.requiredPermission) expect(can(identity, tool.requiredPermission as Permission), `${tool.name} for ${role}`).toBe(true);
      }
    }
    for (const { capability, tool } of mcpToolsFor(CAPABILITIES, { identity, readOnly: false })) {
      if (capability.requiredPermission) expect(can(identity, capability.requiredPermission), `${tool.name} for ${role}`).toBe(true);
      if (tool.requiredPermission) expect(can(identity, tool.requiredPermission as Permission), `${tool.name} for ${role}`).toBe(true);
    }
  });

  it("drops a forbidden capability tool on both surfaces, even for a super admin", () => {
    const run = async () => ({});
    const rogue: Capability = {
      id: "rogue",
      promptFragment: () => "",
      tools: ["send_email", "export_emails", "run_sql", "set_env", "create_token", "deploy_now", "restore_backup", "delete_audit_event", "list_tools_again"].map(
        (name) => ({ name, description: "x", inputSchema: z.object({}), kind: "write" as const, run })
      ),
    };
    const director = probeIdentity("super_admin");
    const chat = capabilitiesForIdentity([rogue], director)[0].tools.map((t) => t.name);
    const mcp = mcpToolsFor([rogue], { identity: director, readOnly: false }).map(({ tool }) => tool.name);
    expect(chat).toEqual(["list_tools_again"]);
    expect(mcp).toEqual(["list_tools_again"]);
  });
});

describe("no tool hands a model people's email addresses", () => {
  beforeEach(() => vi.stubEnv("DATABASE_URL", ""));
  afterEach(() => resetDbForTests());

  it("returns no seeded address from any read either surface offers a super admin (find_people stays masked)", async () => {
    const db = await getDb();
    await db.delete(session);
    await db.delete(user);
    const addresses = ["luis.alvarez@cornell.edu", "niti.p@cornell.edu", "casey.r@cornell.edu"];
    const people = await Promise.all(addresses.map((email, i) => seedUser({ email, name: `Person ${i}`, role: i === 0 ? "super_admin" : "admin" })));
    await db.insert(maintenanceLogs).values({ title: "Belt slipping", status: "open", reportedByEmail: addresses[1], reportedByName: "Person 1", reportedByUserId: people[1].id, assignedToUserId: people[2].id });
    await db.insert(feedback).values({ issueDescription: "Wrong wattage", status: "new", reporterEmail: addresses[2] });

    const identity: Identity = { role: "super_admin", userId: people[0].id, email: addresses[0], name: "Person 0", rateLimitKey: "k" };
    const reads = [...chatTools("super_admin"), ...mcpTools("super_admin")].filter((t) => t.kind === "read");
    const ran: string[] = [];
    for (const tool of reads) {
      const args = tool.name === "find_people" ? { query: "cornell" } : {};
      if (!tool.inputSchema.safeParse(args).success) continue;
      let output: unknown;
      try {
        output = await tool.run(args, { identity, chatId: "chat-1" });
      } catch {
        continue; // a read that needs a service this test does not stand up
      }
      ran.push(tool.name);
      const text = JSON.stringify(output);
      for (const address of addresses) expect(text, `${tool.name} returned ${address}`).not.toContain(address);
    }
    expect(ran).toEqual(expect.arrayContaining(["find_people", "list_open_tickets", "list_corrections"]));
  });
});
