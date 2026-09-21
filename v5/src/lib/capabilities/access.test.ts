import { z } from "zod";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import {
  INTAKE_MINIMUM_ROLE,
  canAddEquipment,
  capabilitiesForRole,
  meetsMinimumRole,
} from "./access";
import { CAPABILITIES } from "./index";
import type { Capability, CapabilityTool } from "./types";
import type { Role } from "../auth/roles";

// The real registry is imported below; its catalog module reads `next/cache`.
vi.mock("next/cache", () => nextCacheMock());

/**
 * Who may use which capability on the chat surface (auth spec amendment
 * 2026-09-14). The rule is declared on a capability and enforced once here, so
 * these tests are the whole of the authorization logic — the chat route tests
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

const staffOnly: Capability = {
  id: "staff-only",
  minimumRole: "staff",
  promptFragment: () => "full instructions",
  lockedPromptFragment: () => "staff only, sorry",
  tools: [fakeTool("add_thing")],
};

const adminQuiet: Capability = {
  id: "admin-quiet",
  minimumRole: "admin",
  promptFragment: () => "admin instructions",
  tools: [fakeTool("admin_thing")],
};

const env = { tools: [] };

describe("meetsMinimumRole", () => {
  it("lets everyone through when there is no minimum", () => {
    for (const role of ["anonymous", "student", "staff", "admin"] as Role[]) {
      expect(meetsMinimumRole(role, undefined)).toBe(true);
    }
  });

  it("treats a missing role as anonymous, never as a pass", () => {
    expect(meetsMinimumRole(undefined, "student")).toBe(false);
    expect(meetsMinimumRole(null, "staff")).toBe(false);
  });

  it("follows the role ladder", () => {
    expect(meetsMinimumRole("student", "staff")).toBe(false);
    expect(meetsMinimumRole("staff", "staff")).toBe(true);
    expect(meetsMinimumRole("admin", "staff")).toBe(true);
    expect(meetsMinimumRole("staff", "admin")).toBe(false);
  });
});

describe("canAddEquipment", () => {
  it("requires staff", () => {
    expect(INTAKE_MINIMUM_ROLE).toBe("staff");
  });

  it.each([
    ["anonymous", false],
    ["student", false],
    ["staff", true],
    ["admin", true],
  ] as const)("%s → %s", (role, expected) => {
    expect(canAddEquipment(role)).toBe(expected);
  });

  it("is closed to a caller with no identity", () => {
    expect(canAddEquipment(null)).toBe(false);
    expect(canAddEquipment(undefined)).toBe(false);
  });
});

describe("capabilitiesForRole", () => {
  it("returns a capability with no minimum untouched, for anyone", () => {
    const [result] = capabilitiesForRole([open], "anonymous");
    expect(result).toBe(open);
  });

  it("gives a qualifying role every tool and the full instructions", () => {
    const [result] = capabilitiesForRole([staffOnly], "staff");
    expect(result.tools.map((t) => t.name)).toEqual(["add_thing"]);
    expect(result.promptFragment(env)).toBe("full instructions");
  });

  it("keeps a locked capability's place but strips its tools and says why", () => {
    const result = capabilitiesForRole([open, staffOnly, adminQuiet], "student");

    expect(result.map((c) => c.id)).toEqual(["open", "staff-only", "admin-quiet"]);
    expect(result[1].tools).toEqual([]);
    expect(result[1].promptFragment(env)).toBe("staff only, sorry");
  });

  it("adds nothing to the prompt for a locked capability with no locked fragment", () => {
    const [result] = capabilitiesForRole([adminQuiet], "staff");
    expect(result.tools).toEqual([]);
    expect(result.promptFragment(env)).toBe("");
  });
});

describe("the registry as each role sees it", () => {
  const INTAKE_TOOLS = ["research_tool", "propose_listing", "create_tool"];

  function toolNames(role: Role): string[] {
    return capabilitiesForRole(CAPABILITIES, role).flatMap((c) =>
      c.tools.map((t) => t.name)
    );
  }

  it.each(["anonymous", "student"] as const)(
    "gives %s no way to add equipment",
    (role) => {
      const names = toolNames(role);
      for (const name of INTAKE_TOOLS) expect(names).not.toContain(name);
    }
  );

  it.each(["staff", "admin"] as const)("gives %s the intake tools", (role) => {
    expect(toolNames(role)).toEqual(expect.arrayContaining(INTAKE_TOOLS));
  });

  it("leaves reporting problems and corrections open to everyone", () => {
    expect(toolNames("anonymous")).toEqual(
      expect.arrayContaining(["report_issue", "report_correction"])
    );
  });
});
