// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";
import { nextHeadersMock } from "../mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { fc, RUNS } from "./fc";
import { ACTION_DEFINITIONS } from "@/lib/actions/registry";
import { CAPABILITIES } from "@/lib/capabilities";

/**
 * INVARIANT 18 — every input schema the model or a client can reach refuses
 * garbage without throwing.
 *
 * Tool arguments are written by a model (chat) or by any MCP client; action
 * inputs by a browser. Every capability tool's `inputSchema` and every
 * action's `input` must answer `safeParse` for any value — never throw — and
 * whatever it accepts must be an object (or nothing, for an action that takes
 * no input), never a primitive that slipped through to `run()`.
 */

const schemas = [
  ...CAPABILITIES.flatMap((c) => c.tools.map((t) => ({ name: `tool ${t.name}`, schema: t.inputSchema }))),
  ...ACTION_DEFINITIONS.map((d) => ({ name: `action ${d.id}`, schema: d.input })),
];

const garbage = fc.oneof(
  fc.anything({ maxDepth: 3, withNullPrototype: true, withBigInt: true, withDate: true, withMap: true, withSet: true }),
  fc.jsonValue({ maxDepth: 3 }),
  fc.constantFrom(null, undefined, "", 0, NaN, [], "{}", { __proto__: { admin: true } }, { constructor: { prototype: {} } })
);

describe("invariant: input schemas refuse garbage without throwing", () => {
  it("finds the schemas", () => {
    expect(schemas.length).toBeGreaterThan(50);
  });

  it("safeParse never throws, and only objects get through", () => {
    fc.assert(
      fc.property(fc.constantFrom(...schemas), garbage, ({ name, schema }, value) => {
        let result: { success: boolean; data?: unknown } | undefined;
        expect(() => {
          result = schema.safeParse(value);
        }, name).not.toThrow();
        // An action with no input may accept `undefined`; anything else accepted is an object.
        if (result!.success && result!.data !== undefined) {
          expect(typeof result!.data, `${name} accepted ${fc.stringify(value)}`).toBe("object");
          expect(result!.data, name).not.toBeNull();
        }
      }),
      { numRuns: RUNS * 5 }
    );
  });
});
