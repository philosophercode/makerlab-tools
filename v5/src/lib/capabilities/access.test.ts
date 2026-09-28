import { z } from "zod";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import {
  INTAKE_PERMISSION,
  canAddEquipment,
  capabilitiesForIdentity,
  meetsRequiredPermission,
} from "./access";
import { CAPABILITIES } from "./index";
import { toAiTools } from "./chat-adapter";
import type { Capability, CapabilityTool } from "./types";
import { IDENTITY_ROLES, type Role } from "../auth/roles";

// The real registry is imported below; its catalog module reads `next/cache`.
vi.mock("next/cache", () => nextCacheMock());

/**
 * Who may use which capability on the chat surface (spec §3.5). The rule is
 * declared on a capability as a *permission* and enforced once here, so these
 * tests are the whole of the chat's authorization logic — the chat route tests
 * only confirm the route composes through it.
 */

function fakeTool(name: string): CapabilityTool<unknown, unknown> {
  return {
    name,
    description: name,
    inputSchema: z.object({}),
    kind: "read",
    run: async () => null,
  };
}

const open: Capability = {
  id: "open",
  promptFragment: () => "open instructions",
  tools: [fakeTool("look_up")],
};

const adminOnly: Capability = {
  id: "admin-only",
  requiredPermission: "tools.add",
  promptFragment: () => "full instructions",
  lockedPromptFragment: () => "staff only, sorry",
  tools: [fakeTool("add_thing")],
};

const superAdminQuiet: Capability = {
  id: "super-admin-quiet",
  requiredPermission: "users.manage",
  promptFragment: () => "director instructions",
  tools: [fakeTool("director_thing")],
};

const env = { tools: [] };

/** A subject carrying just a role, which is all `access.ts` reads. */
function as(role: Role) {
  return { role };
}

describe("meetsRequiredPermission", () => {
  it("lets everyone through when a capability requires nothing", () => {
    for (const role of IDENTITY_ROLES) {
      expect(meetsRequiredPermission(as(role), undefined)).toBe(true);
    }
  });

  it("treats a missing subject as anonymous, never as a pass", () => {
    expect(meetsRequiredPermission(undefined, "projects.submit")).toBe(false);
    expect(meetsRequiredPermission(null, "tools.add")).toBe(false);
    expect(meetsRequiredPermission({ role: undefined }, "tools.add")).toBe(false);
  });

  it("asks the declaration rather than comparing role names", () => {
    expect(meetsRequiredPermission(as("user"), "tools.add")).toBe(false);
    expect(meetsRequiredPermission(as("admin"), "tools.add")).toBe(true);
    expect(meetsRequiredPermission(as("super_admin"), "tools.add")).toBe(true);
    // An admin runs the catalogue but does not decide who is who — there is no
    // ladder to climb here, only what the declaration grants.
    expect(meetsRequiredPermission(as("admin"), "users.manage")).toBe(false);
    expect(meetsRequiredPermission(as("super_admin"), "users.manage")).toBe(true);
  });
});

describe("canAddEquipment", () => {
  it("is the tools.add permission", () => {
    expect(INTAKE_PERMISSION).toBe("tools.add");
  });

  it.each([
    ["anonymous", false],
    ["user", false],
    ["admin", true],
    ["super_admin", true],
  ] as const)("%s → %s", (role, expected) => {
    expect(canAddEquipment(as(role))).toBe(expected);
  });

  it("is closed to a caller with no identity", () => {
    expect(canAddEquipment(null)).toBe(false);
    expect(canAddEquipment(undefined)).toBe(false);
  });
});

describe("capabilitiesForIdentity", () => {
  it("returns a capability with no requirement untouched, for anyone", () => {
    const [result] = capabilitiesForIdentity([open], as("anonymous"));
    expect(result).toBe(open);
  });

  it("gives a qualifying caller every tool and the full instructions", () => {
    const [result] = capabilitiesForIdentity([adminOnly], as("admin"));
    expect(result.tools.map((t) => t.name)).toEqual(["add_thing"]);
    expect(result.promptFragment(env)).toBe("full instructions");
  });

  it("keeps a locked capability's place but strips its tools and says why", () => {
    const result = capabilitiesForIdentity(
      [open, adminOnly, superAdminQuiet],
      as("user")
    );

    expect(result.map((c) => c.id)).toEqual([
      "open",
      "admin-only",
      "super-admin-quiet",
    ]);
    expect(result[1].tools).toEqual([]);
    expect(result[1].promptFragment(env)).toBe("staff only, sorry");
  });

  it("adds nothing to the prompt for a locked capability with no locked fragment", () => {
    const [result] = capabilitiesForIdentity([superAdminQuiet], as("admin"));
    expect(result.tools).toEqual([]);
    expect(result.promptFragment(env)).toBe("");
  });
});

describe("the registry as each role sees it", () => {
  const INTAKE_TOOLS = ["identify_tools"];
  /** Gone from the chat: two retired in Phase 6, one moved to MCP only. */
  const NEVER_IN_CHAT = ["create_tool", "research_tool", "propose_listing"];

  /** The tools the chat would hand the model for `role` — what the route composes. */
  function toolNames(role: Role): string[] {
    return Object.keys(toAiTools(capabilitiesForIdentity(CAPABILITIES, as(role)), {}));
  }

  it.each(["anonymous", "user"] as const)(
    "gives %s no way to add equipment",
    (role) => {
      const names = toolNames(role);
      for (const name of INTAKE_TOOLS) expect(names).not.toContain(name);
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "gives %s the intake tools",
    (role) => {
      expect(toolNames(role)).toEqual(expect.arrayContaining(INTAKE_TOOLS));
    }
  );

  it.each(["anonymous", "user", "admin", "super_admin"] as const)(
    "never gives %s create_tool, research_tool or propose_listing in the chat",
    (role) => {
      const names = toolNames(role);
      for (const name of NEVER_IN_CHAT) expect(names).not.toContain(name);
    }
  );

  /** The staff queue tools, in the chat since 2026-09-25 (MCP access spec amendment). */
  const STAFF_QUEUE_TOOLS = ["list_open_tickets", "update_ticket", "list_intake_queue"];

  it.each(["anonymous", "user"] as const)("gives %s none of the staff queue tools", (role) => {
    const names = toolNames(role);
    for (const name of STAFF_QUEUE_TOOLS) expect(names).not.toContain(name);
  });

  it.each(["admin", "super_admin"] as const)("gives %s the staff queue tools", (role) => {
    expect(toolNames(role)).toEqual(expect.arrayContaining(STAFF_QUEUE_TOOLS));
  });

  it("gates each staff queue tool on its own permission", () => {
    const tools = Object.fromEntries(CAPABILITIES.flatMap((c) => c.tools).map((t) => [t.name, t]));
    expect(tools.list_open_tickets.requiredPermission).toBe("maintenance.manage");
    expect(tools.update_ticket.requiredPermission).toBe("maintenance.manage");
    expect(tools.list_intake_queue.requiredPermission).toBe("tools.approve");
  });

  it.each(["anonymous", "user", "admin", "super_admin"] as const)(
    "never hands %s the staff capability's MCP-only propose_change",
    (role) => {
      // Curation's own propose_change is composed per page by the route, not
      // by the registry, so the registry alone must never offer one.
      expect(toolNames(role)).not.toContain("propose_change");
    }
  );

  it("leaves reporting problems and corrections open to everyone", () => {
    expect(toolNames("anonymous")).toEqual(
      expect.arrayContaining(["report_issue", "report_correction"])
    );
  });
});
