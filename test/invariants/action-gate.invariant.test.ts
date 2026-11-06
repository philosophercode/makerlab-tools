// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";
import { nextHeadersMock } from "../mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { fc, RUNS } from "./fc";
import { PERMISSIONS, can } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/roles";
import { performAction } from "@/lib/actions/perform";
import { ACTION_DEFINITIONS, type AnyActionDefinition } from "@/lib/actions/registry";
import { identityFor } from "../utils/identities";

/**
 * INVARIANT 17 — no write in the action layer runs for someone who may not do it.
 *
 * Every GUI write, assistant proposal and MCP action goes through
 * `performAction`. For every registered action, any caller who lacks its
 * permission, on any surface, with any input: the answer is a refusal, and
 * none of the action's own steps (`afterGate`, `check`, `run`) is ever called.
 * Every action names a real permission, so no gate is a typo that passes.
 */

const ROLES: Role[] = ["anonymous", "user", "admin", "super_admin", "demo_admin"];

/** The action with every step replaced by a spy, so nothing real can run. */
function spied(def: AnyActionDefinition) {
  const steps = { afterGate: vi.fn(), check: vi.fn(), run: vi.fn(), beforeRun: vi.fn() };
  const fake = {
    ...def,
    afterGate: def.afterGate ? steps.afterGate : undefined,
    check: steps.check,
    run: steps.run,
  } as AnyActionDefinition;
  return { fake, steps };
}

let rlKey = 0;

describe("invariant: action-layer writes are gated", () => {
  it("has actions to check, each on a real permission", () => {
    expect(ACTION_DEFINITIONS.length).toBeGreaterThan(20);
    for (const def of ACTION_DEFINITIONS) expect(PERMISSIONS, def.id).toContain(def.permission);
  });

  it("a caller without the permission is refused before any step runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ACTION_DEFINITIONS),
        fc.constantFrom(...ROLES),
        fc.constantFrom("gui", "assistant", "mcp" as const),
        fc.constantFrom("", "1", "view"),
        fc.jsonValue({ maxDepth: 2 }),
        async (def, role, surface, demo, input) => {
          vi.stubEnv("DEMO_ADMIN", demo);
          const identity = { ...identityFor(role), rateLimitKey: `inv-action:${rlKey++}` };
          if (can(identity, def.permission)) return;
          const { fake, steps } = spied(def);
          const result = await performAction(fake, input, identity, { surface, beforeRun: steps.beforeRun });
          expect(result.ok, `${def.id} as ${role}`).toBe(false);
          for (const [name, spy] of Object.entries(steps)) expect(spy, `${def.id}.${name} ran for ${role}`).not.toHaveBeenCalled();
        }
      ),
      { numRuns: RUNS }
    );
  });
});
