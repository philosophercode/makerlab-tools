// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { fc, RUNS } from "./fc";
import { assistantToolForbidden } from "@/lib/actions/define";
import { can, type Permission } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/roles";
import { CAPABILITIES, mcpToolsFor } from "@/lib/capabilities";
import { capabilitiesForIdentity } from "@/lib/capabilities/access";
import { identityFor } from "../utils/identities";

/**
 * INVARIANT 9 — the assistant (chat and MCP) can only ever do what its
 * caller could do in the GUI.
 *
 * For any caller — every role, the demo identity in every mode, read-only and
 * read-write MCP connections — the tools handed to the model satisfy, checked
 * straight from each tool's own metadata rather than from the filter under test:
 *
 * - Its capability's and its own `requiredPermission` are held (`can()`).
 * - Nothing on the assistant deny list is ever offered.
 * - Over MCP: no write tool without a signed-in person, none on a read-only
 *   connection, and nothing marked `chatOnly`.
 * - Offered tool sets are monotonic up the role ladder, and the demo
 *   identity's set is a subset of a director's.
 */

const ROLES: Role[] = ["anonymous", "user", "admin", "super_admin", "demo_admin"];
const LADDER: Role[] = ["anonymous", "user", "admin", "super_admin"];

const holds = (subject: { role: Role; readOnly?: boolean }, p: Permission | undefined) => !p || can(subject, p);

function chatTools(role: Role, readOnly = false) {
  const subject = { ...identityFor(role), readOnly };
  return capabilitiesForIdentity(CAPABILITIES, subject).flatMap((cap) => {
    const original = CAPABILITIES.find((c) => c.id === cap.id)!;
    return cap.tools.map((tool) => ({ capability: original, tool }));
  });
}

function mcpTools(role: Role, readOnly: boolean) {
  return mcpToolsFor(CAPABILITIES, { identity: identityFor(role), readOnly });
}

const caller = fc.record({
  role: fc.constantFrom(...ROLES),
  readOnly: fc.boolean(),
  demo: fc.constantFrom("", "1", "view"),
});

beforeEach(() => vi.stubEnv("DEMO_ADMIN", ""));

describe("invariant: assistant tools never exceed the caller's permissions", () => {
  it("has tools to check", () => {
    expect(CAPABILITIES.flatMap((c) => c.tools).length).toBeGreaterThan(20);
  });

  it("chat: every offered tool's permissions are held and none is denied", () => {
    fc.assert(
      fc.property(caller, ({ role, readOnly, demo }) => {
        vi.stubEnv("DEMO_ADMIN", demo);
        const subject = { role, readOnly };
        for (const { capability, tool } of chatTools(role, readOnly)) {
          expect(holds(subject, capability.requiredPermission), `${role}: ${tool.name}`).toBe(true);
          expect(holds(subject, tool.requiredPermission), `${role}: ${tool.name}`).toBe(true);
          expect(assistantToolForbidden(tool.name), tool.name).toBe(false);
        }
      }),
      { numRuns: RUNS }
    );
  });

  // MCP callers are resolved from bearer credentials only (`auth/mcp-caller.ts`):
  // the demo identity never reaches MCP, so the ladder is the real roles.
  it("MCP: no writes for anonymous callers or read-only connections, and permissions held", () => {
    fc.assert(
      fc.property(caller.filter((c) => c.role !== "demo_admin"), ({ role, readOnly, demo }) => {
        vi.stubEnv("DEMO_ADMIN", demo);
        const signedIn = role !== "anonymous";
        for (const { capability, tool } of mcpTools(role, readOnly)) {
          const label = `${role}${readOnly ? " (read-only)" : ""}: ${tool.name}`;
          expect(tool.chatOnly, label).not.toBe(true);
          expect(assistantToolForbidden(tool.name), label).toBe(false);
          expect(holds({ role }, capability.requiredPermission), label).toBe(true);
          expect(holds({ role }, tool.requiredPermission), label).toBe(true);
          if (tool.kind === "write") {
            expect(signedIn, `${label} is a write for nobody`).toBe(true);
            expect(readOnly, `${label} is a write on a read-only connection`).toBe(false);
          }
        }
      }),
      { numRuns: RUNS }
    );
  });

  it("offered tool sets grow up the role ladder; the demo's are within a director's", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: LADDER.length - 2 }), fc.boolean(), fc.constantFrom("", "1", "view"), (i, readOnly, demo) => {
        vi.stubEnv("DEMO_ADMIN", demo);
        const names = (list: { tool: { name: string } }[]) => new Set(list.map((t) => t.tool.name));
        const lowerChat = names(chatTools(LADDER[i]));
        const higherChat = names(chatTools(LADDER[i + 1]));
        for (const n of lowerChat) expect(higherChat.has(n), `chat ${n}: ${LADDER[i]} ⊄ ${LADDER[i + 1]}`).toBe(true);
        const lowerMcp = names(mcpTools(LADDER[i], readOnly));
        const higherMcp = names(mcpTools(LADDER[i + 1], readOnly));
        for (const n of lowerMcp) expect(higherMcp.has(n), `mcp ${n}: ${LADDER[i]} ⊄ ${LADDER[i + 1]}`).toBe(true);

        const director = names(chatTools("super_admin"));
        for (const n of names(chatTools("demo_admin", demo === "view"))) expect(director.has(n), `demo chat ${n}`).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });
});
