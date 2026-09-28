// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CAPABILITIES } from "../capabilities";
import { CURATION_TOOLS } from "../capabilities/curation";
import * as corrections from "./corrections";
import * as catalog from "./catalog";
import { EXEMPT, EXEMPT_KINDS, ROUTE_BACKED } from "./exempt";
import * as imports from "./imports";
import * as insights from "./insights";
import * as intake from "./intake";
import * as manuals from "./manuals";
import * as mirror from "./mirror";
import * as refresh from "./refresh";
import * as resources from "./resources";
import * as units from "./units";
import { endpointsInSource, type GuiEndpoint } from "./parity";
import * as people from "./people";
import * as peopleAllowance from "./people-allowance";
import * as peopleRoster from "./people-roster";
import * as projects from "./projects";
import { ACTIONS } from "./registry";
import * as tickets from "./tickets";
import * as maintenanceLog from "./maintenance-log";
import { ACTION_DEFINITIONS } from "./registry";
import { actionsCapability, DEFERRED_TOOLS, proposableDefinitions } from "../capabilities/actions";
import { can, type Permission } from "../auth/permissions";
import { ROLES } from "../db/schema/vocabulary";

/**
 * The parity guard (assistant–GUI parity spec §2, §10).
 *
 * Every GUI write — an export of a `"use server"` module, an inline server
 * action, or a mutation method of an API route — is either a wrapper over a
 * registered action (`performAction(<DEFINITION>, …)` with the definition
 * imported from `lib/actions/`) or named in `EXEMPT` with its reason. A new
 * server action with neither fails here, which is how the assistant stays able
 * to do what the GUI can: the ability cannot land in one without the other.
 */

const APP = join(import.meta.dirname, "..", "..", "..");

/** Every definition module; adding one to the registry means adding it here. */
const DEFINITION_MODULES = [
  people,
  peopleRoster,
  peopleAllowance,
  tickets,
  maintenanceLog,
  corrections,
  projects,
  catalog,
  units,
  resources,
  manuals,
  intake,
  imports,
  refresh,
  mirror,
  insights,
];

/** Export name → definition, for every registered definition. */
const DEFINITIONS_BY_EXPORT = new Map(
  DEFINITION_MODULES.flatMap((mod) => Object.entries(mod)).filter(([, value]) => ACTIONS.includes(value as never))
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function allEndpoints(): GuiEndpoint[] {
  return walk(join(APP, "src"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .flatMap((f) => endpointsInSource(relative(APP, f), readFileSync(f, "utf8")));
}

/**
 * The registered definition an endpoint wraps, or null. Only a thin wrapper
 * counts: an endpoint that calls the layer and also writes on its own would
 * otherwise pass as "on the layer" with a second write path beside it.
 */
function wrapped(endpoint: GuiEndpoint): string | null {
  if (!endpoint.thin || endpoint.performs.length !== 1) return null;
  const call = endpoint.performs.find((p) => p.from !== null && /(^|\/)lib\/actions\//.test(p.from) && DEFINITIONS_BY_EXPORT.has(p.name));
  return call ? call.name : null;
}

const ENDPOINTS = allEndpoints();

describe("every GUI write is an action or an explicit exemption", () => {
  it("finds the endpoints at all (a scanner that finds nothing guards nothing)", () => {
    expect(ENDPOINTS.length).toBeGreaterThan(50);
    expect(ENDPOINTS.map((e) => e.key)).toContain("src/app/admin/users/actions.ts#setUserTitle");
    expect(ENDPOINTS.map((e) => e.key)).toContain("src/app/api/flags/route.ts#POST");
  });

  it("leaves no endpoint unaccounted for", () => {
    const unaccounted = ENDPOINTS.filter((e) => !wrapped(e) && !(e.key in EXEMPT)).map((e) => e.key);
    expect(unaccounted, "Wrap it with performAction(<definition>) or add it to lib/actions/exempt.ts with a reason").toEqual([]);
  });

  it("keeps no stale exemption: every entry names an endpoint that exists and is not already a wrapper", () => {
    const keys = new Map(ENDPOINTS.map((e) => [e.key, e]));
    const stale = Object.keys(EXEMPT).filter((key) => !keys.has(key) || wrapped(keys.get(key)!));
    expect(stale, "Remove these from lib/actions/exempt.ts").toEqual([]);
  });

  it("holds only decisions: every exemption's reason is one of the kinds, never a deferral (phase 8)", () => {
    const undecided = Object.entries(EXEMPT).filter(([, reason]) => !EXEMPT_KINDS.some((kind) => reason.startsWith(kind)));
    expect(undecided).toEqual([]);
  });

  it("gives every exemption a reason", () => {
    for (const [key, reason] of Object.entries(EXEMPT)) expect(reason.trim().length, key).toBeGreaterThan(10);
  });

  it("backs every registered action with at least one GUI endpoint (parity runs both ways)", () => {
    const used = new Set(ENDPOINTS.map(wrapped).filter(Boolean));
    const orphans = [...DEFINITIONS_BY_EXPORT]
      .filter(([name, def]) => !used.has(name) && !((def as { id: string }).id in ROUTE_BACKED))
      .map(([, def]) => (def as { id: string }).id);
    expect(orphans).toEqual([]);
  });

  it("backs a route-backed action with a route that exists, is exempt with its reason, and is not a wrapper", () => {
    const keys = new Map(ENDPOINTS.map((e) => [e.key, e]));
    for (const [id, key] of Object.entries(ROUTE_BACKED)) {
      expect(ACTIONS.some((a) => a.id === id), id).toBe(true);
      expect(keys.has(key), key).toBe(true);
      expect(EXEMPT[key], key).toMatch(/Route-backed/);
    }
  });

  it("imports every registered definition from a module this guard reads", () => {
    const seen = new Set(DEFINITIONS_BY_EXPORT.values());
    expect(ACTIONS.filter((a) => !seen.has(a)).map((a) => a.id)).toEqual([]);
  });
});

describe("the registry", () => {
  it("has unique ids and tool names", () => {
    const ids = ACTIONS.map((a) => a.id);
    const tools = ACTIONS.map((a) => a.toolName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("names every action `<area>.<verb>` and every tool in snake_case", () => {
    for (const action of ACTIONS) {
      expect(action.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(action.toolName).toMatch(/^[a-z][a-z_]+$/);
    }
  });

  it("clashes with no capability tool, except the ones it is specced to replace", () => {
    // §4.9: `update_ticket` becomes the generated tool of that name in phase 2.
    const replaces = new Set(["update_ticket"]);
    const capabilityTools = new Set([
      // Every capability but the one generated from this registry.
      ...CAPABILITIES.filter((c) => c.id !== "actions").flatMap((c) => c.tools.map((t) => t.name)),
      ...CURATION_TOOLS.map((t) => t.name),
    ]);
    const clashes = ACTIONS.map((a) => a.toolName).filter((name) => capabilityTools.has(name) && !replaces.has(name));
    expect(clashes).toEqual([]);
  });

  it("never exposes a people, spend or destructive action over MCP", () => {
    for (const action of ACTIONS) {
      if (["people", "spend", "destructive"].includes(action.risk)) expect(action.mcp, action.id).toBe("never");
    }
  });

  it("commits directly over MCP for update_ticket only; everything else proposes or is absent (§11 answer 4)", () => {
    expect(ACTIONS.filter((a) => a.mcp === "direct").map((a) => a.toolName)).toEqual(["update_ticket"]);
  });

  it("describes every action the assistant may propose", () => {
    for (const action of ACTIONS.filter((a) => a.assistant === "propose")) {
      expect(action.description.length, action.id).toBeGreaterThan(20);
    }
  });
});

describe("the generated tools (phase 2)", () => {
  const generated = actionsCapability().tools;

  it("gives every proposable action a tool, a preview, or a deferral with its reason (the list only shrinks)", () => {
    const missing = ACTION_DEFINITIONS.filter(
      (def) => def.assistant === "propose" && !(def.tool && def.preview) && !(def.id in DEFERRED_TOOLS)
    ).map((def) => def.id);
    expect(missing).toEqual([]);
    const stale = Object.keys(DEFERRED_TOOLS).filter((id) => proposableDefinitions().some((def) => def.id === id));
    expect(stale, "A deferred action now has a tool: remove it from DEFERRED_TOOLS").toEqual([]);
  });

  it("names each tool after its action and gates it on the action's own permission", () => {
    for (const def of proposableDefinitions()) {
      const tool = generated.find((t) => t.name === def.toolName);
      expect(tool, def.id).toBeDefined();
      expect(tool!.requiredPermission, def.id).toBe(def.permission);
      expect(tool!.kind).toBe("write");
      expect(tool!.chatOnly, "the chat's tool draws a card").toBe(true);
    }
  });

  it("gives every action MCP may propose its own MCP tool, and no other action one (phase 7, §3.8)", () => {
    const mcpTools = generated.filter((t) => t.mcpOnly);
    const expected = proposableDefinitions().filter((def) => def.mcp === "propose");
    expect(mcpTools.map((t) => t.name).sort()).toEqual(expected.map((def) => def.toolName).sort());
    for (const def of expected) {
      const tool = mcpTools.find((t) => t.name === def.toolName)!;
      expect(tool.requiredPermission, def.id).toBe(def.permission);
      expect(tool.kind, def.id).toBe("write");
      expect(["people", "spend", "destructive"], def.id).not.toContain(def.risk);
    }
  });

  it("offers each tool to exactly the roles the GUI's endpoint lets through", () => {
    for (const def of proposableDefinitions()) {
      for (const role of ["anonymous", ...ROLES] as const) {
        const offered = can({ role }, generated.find((t) => t.name === def.toolName)!.requiredPermission as Permission);
        expect(offered, `${def.id} for ${role}`).toBe(can({ role }, def.permission));
      }
    }
  });

  it("clashes with no other chat tool: one name, one tool, on each surface", () => {
    const chatNames = [...CAPABILITIES.flatMap((c) => c.tools.filter((t) => !t.mcpOnly).map((t) => t.name)), ...CURATION_TOOLS.map((t) => t.name)];
    const dupes = chatNames.filter((name, i) => chatNames.indexOf(name) !== i);
    expect(dupes).toEqual([]);
    const mcpNames = CAPABILITIES.flatMap((c) => c.tools.filter((t) => !t.chatOnly).map((t) => t.name));
    expect(mcpNames.filter((name, i) => mcpNames.indexOf(name) !== i)).toEqual([]);
  });
});

describe("the scanner", () => {
  it("reports a new server action that owns its logic, so the guard fails on it", () => {
    const found = endpointsInSource(
      "src/app/admin/widgets/actions.ts",
      `"use server";
       import { performAction } from "../../../lib/actions/perform";
       import { WIDGETS_SPIN } from "../../../lib/actions/widgets";
       export async function spin(input: unknown) { return performAction(WIDGETS_SPIN, input, id, { surface: "gui" }); }
       export async function smash(input: unknown) { await db.delete(widgets); }
       export const twirl = async () => { await db.update(widgets); };
       async function hidden() {}
       export { hidden as renamed };`
    );
    expect(found.map((e) => e.name).sort()).toEqual(["renamed", "smash", "spin", "twirl"]);
    expect(found.find((e) => e.name === "spin")!.performs).toEqual([{ name: "WIDGETS_SPIN", from: "../../../lib/actions/widgets" }]);
    expect(found.find((e) => e.name === "smash")!.performs).toEqual([]);
  });

  it("counts only a bare `return performAction(…)` as a thin wrapper", () => {
    const found = endpointsInSource(
      "src/app/admin/widgets/actions.ts",
      `"use server";
       import { performAction } from "../../../lib/actions/perform";
       import { WIDGETS_SPIN } from "../../../lib/actions/widgets";
       export async function spin(input: unknown) { return performAction(WIDGETS_SPIN, input, await resolveIdentityFromHeaders(), { surface: "gui" }); }
       export const twirl = async (input: unknown) => performAction(WIDGETS_SPIN, input, await resolveIdentityFromHeaders(), { surface: "gui" });
       export async function mixed(input: unknown) { await db.delete(widgets); return performAction(WIDGETS_SPIN, input, id, { surface: "gui" }); }
       export async function sneaky(input: unknown) { return performAction(WIDGETS_SPIN, await db.delete(widgets), id, { surface: "gui" }); }
       export async function twice(input: unknown) { await performAction(WIDGETS_SPIN, input, id, {}); return performAction(WIDGETS_SPIN, input, id, {}); }`
    );
    const thin = Object.fromEntries(found.map((e) => [e.name, e.thin]));
    expect(thin).toEqual({ spin: true, twirl: true, mixed: false, sneaky: false, twice: false });
  });

  it("counts an inline server action's directive as no statement", () => {
    const [save] = endpointsInSource(
      "src/app/admin/widgets/page.tsx",
      `async function save(input: unknown) { "use server"; return performAction(WIDGETS_SPIN, input, await resolveIdentityFromHeaders(), {}); }`
    );
    expect(save.thin).toBe(true);
  });

  it("finds an inline server action inside a server component", () => {
    const found = endpointsInSource(
      "src/app/admin/widgets/page.tsx",
      `export default function Page() {
         async function save(form: FormData) { "use server"; await db.insert(widgets); }
         return <form action={save} />;
       }`
    );
    expect(found.map((e) => e.key)).toEqual(["src/app/admin/widgets/page.tsx#save"]);
  });

  it("finds a route's mutation methods and ignores its reads", () => {
    const found = endpointsInSource(
      "src/app/api/widgets/route.ts",
      `export async function GET() {}
       export async function POST() {}
       export const DELETE = async () => {};`
    );
    expect(found.map((e) => e.name).sort()).toEqual(["DELETE", "POST"]);
  });

  it("ignores a module that only mentions the directive in a comment", () => {
    expect(endpointsInSource("src/app/admin/widgets/action-result.ts", `/** a "use server" module may export only async functions */\nexport const PATH = "/x";`)).toEqual([]);
  });
});
