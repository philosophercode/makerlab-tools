// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

const gate = vi.hoisted(() => ({ authorizeAdminAction: vi.fn() }));
vi.mock("../admin/action-gate", () => gate);

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Identity } from "../auth/identity";
import { defineAction, type ActionDefinition } from "./define";
import { performAction } from "./perform";

/**
 * `performAction`'s own contract (assistant–GUI parity spec §3.3, §10): the
 * order of the steps, and what each one's failure answers. The gate itself is
 * `authorizeAdminAction`, tested in `admin/action-gate.test.ts` against real
 * sessions; here it is a stub, so each step can be made to refuse in turn.
 * The definitions' own rules are tested through the server actions they back
 * (`app/admin/{users,maintenance,corrections,projects}/*.test.ts`), unchanged.
 */

const DIRECTOR: Identity = {
  role: "super_admin",
  userId: "11111111-1111-4111-8111-111111111111",
  email: "d@cornell.edu",
  name: "Director",
  rateLimitKey: "user:1",
};

type TestError = "invalid_thing" | "too_red";

function testAction(
  overrides: Partial<ActionDefinition<{ n: number }, { n: number }, TestError, { was: number }>> = {}
) {
  return defineAction<{ n: number }, { n: number }, TestError, { was: number }>({
    id: "test.set_n",
    toolName: "set_test_n",
    description: "Test.",
    permission: "tools.edit",
    risk: "operational",
    input: z.object({ n: z.number() }),
    invalidInput: "invalid_thing",
    subject: () => ({ type: "tool", id: "t" }),
    run: async (input) => ({ ok: true, value: { n: input.n }, committed: { was: 0 } }),
    revalidate: ["/admin/test"],
    ...overrides,
  });
}

beforeEach(() => {
  gate.authorizeAdminAction.mockReset().mockImplementation(async (_permission: string, identity: Identity) => ({ ok: true, identity }));
  vi.mocked(revalidatePath).mockReset();
});

it("gates on the definition's permission with the identity the surface resolved", async () => {
  await performAction(testAction(), { n: 1 }, DIRECTOR, { surface: "gui" });
  expect(gate.authorizeAdminAction).toHaveBeenCalledWith("tools.edit", DIRECTOR);
});

it("answers the gate's refusal before reading the input at all", async () => {
  gate.authorizeAdminAction.mockResolvedValue({ ok: false, error: "rate_limited" });
  const run = vi.fn();
  const result = await performAction(testAction({ run }), { n: "not a number" }, DIRECTOR, { surface: "gui" });
  expect(result).toEqual({ ok: false, error: "rate_limited" });
  expect(run).not.toHaveBeenCalled();
});

it("answers the action's own invalid-input code, not a generic one", async () => {
  const run = vi.fn();
  expect(await performAction(testAction({ run }), { n: "x" }, DIRECTOR, { surface: "gui" })).toEqual({
    ok: false,
    error: "invalid_thing",
  });
  expect(run).not.toHaveBeenCalled();
});

it("stops at the check's refusal, and runs nothing", async () => {
  const run = vi.fn();
  const check = vi.fn().mockResolvedValue("too_red");
  expect(await performAction(testAction({ check, run }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({
    ok: false,
    error: "too_red",
  });
  expect(run).not.toHaveBeenCalled();
});

it("spreads the success value, then commits and refreshes", async () => {
  const afterCommit = vi.fn().mockResolvedValue(undefined);
  const result = await performAction(testAction({ afterCommit }), { n: 7 }, DIRECTOR, { surface: "assistant", proposalId: "p1" });
  expect(result).toEqual({ ok: true, n: 7 });
  expect(afterCommit).toHaveBeenCalledWith({ n: 7 }, { was: 0 }, { identity: DIRECTOR, surface: "assistant", proposalId: "p1" });
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/test");
});

it("records nothing and refreshes nothing for a no-op success", async () => {
  const afterCommit = vi.fn();
  const run = vi.fn().mockResolvedValue({ ok: true, value: { n: 1 } });
  expect(await performAction(testAction({ run, afterCommit }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({ ok: true, n: 1 });
  expect(afterCommit).not.toHaveBeenCalled();
  expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
});

it("turns a thrown run — or a thrown check — into `failed`", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const run = vi.fn().mockRejectedValue(new Error("db down"));
  expect(await performAction(testAction({ run }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({ ok: false, error: "failed" });
  const check = vi.fn().mockRejectedValue(new Error("db down"));
  expect(await performAction(testAction({ check }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({ ok: false, error: "failed" });
  quiet.mockRestore();
});

it("passes a run's refusal through as its code", async () => {
  const run = vi.fn().mockResolvedValue({ ok: false, error: "too_red" });
  expect(await performAction(testAction({ run }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({ ok: false, error: "too_red" });
});

it("keeps the success when afterCommit throws, and names the gap", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const afterCommit = vi.fn().mockRejectedValue(new Error("audit down"));
  expect(await performAction(testAction({ afterCommit }), { n: 2 }, DIRECTOR, { surface: "gui" })).toEqual({
    ok: true,
    n: 2,
    warning: "audit_unavailable",
  });
  quiet.mockRestore();
});

it("keeps the success when the refresh cannot be scheduled", async () => {
  const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockImplementation(() => {
    throw new Error("outside a request");
  });
  expect(await performAction(testAction(), { n: 3 }, DIRECTOR, { surface: "assistant" })).toEqual({ ok: true, n: 3 });
  quiet.mockRestore();
});

it("runs afterGate before the input is read, and its warning rides on the answer", async () => {
  const afterGate = vi.fn().mockResolvedValue({ ok: true, warning: "audit_unavailable" });
  const afterCommit = vi.fn().mockResolvedValue(undefined);
  expect(await performAction(testAction({ afterGate, afterCommit }), { n: 4 }, DIRECTOR, { surface: "gui" })).toEqual({
    ok: true,
    n: 4,
    warning: "audit_unavailable",
  });
  // Even an invalid input answers after the reconciliation ran, as the People page always did.
  afterGate.mockClear();
  await performAction(testAction({ afterGate }), { n: "x" }, DIRECTOR, { surface: "gui" });
  expect(afterGate).toHaveBeenCalledTimes(1);
});

it("stops at afterGate's refusal", async () => {
  const afterGate = vi.fn().mockResolvedValue({ ok: false, error: "failed" });
  const run = vi.fn();
  expect(await performAction(testAction({ afterGate, run }), { n: 1 }, DIRECTOR, { surface: "gui" })).toEqual({ ok: false, error: "failed" });
  expect(run).not.toHaveBeenCalled();
});

it("carries run's own warning when its audit is inside its statement", async () => {
  const run = vi.fn().mockResolvedValue({ ok: true, value: { n: 5 }, committed: { was: 1 }, warning: "audit_unavailable" });
  expect(await performAction(testAction({ run }), { n: 5 }, DIRECTOR, { surface: "gui" })).toEqual({
    ok: true,
    n: 5,
    warning: "audit_unavailable",
  });
});
