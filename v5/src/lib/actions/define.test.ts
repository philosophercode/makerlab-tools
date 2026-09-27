import { z } from "zod";
import { defaultMcpExposure, defineAction, type ActionRisk } from "./define";

/** The rules `defineAction` refuses at module load (assistant–GUI parity spec §3.2, §3.8). */

function base(risk: ActionRisk) {
  return {
    id: "test.x",
    toolName: "test_x",
    description: "Test.",
    permission: "tools.edit" as const,
    risk,
    input: z.object({}),
    invalidInput: "invalid_field" as const,
    subject: () => ({ type: "tool" as const, id: "t" }),
    run: async () => ({ ok: true as const, value: {} }),
  };
}

it("defaults to proposing, one subject, and MCP by risk", () => {
  const def = defineAction(base("catalog"));
  expect(def.assistant).toBe("propose");
  expect(def.maxBatch).toBe(1);
  expect(def.mcp).toBe("propose");
});

it("gives each risk the MCP exposure §3.8 names, narrowed by §11 answer 4 (never direct)", () => {
  expect(defaultMcpExposure("operational")).toBe("propose");
  expect(defaultMcpExposure("catalog")).toBe("propose");
  expect(defaultMcpExposure("people")).toBe("never");
  expect(defaultMcpExposure("spend")).toBe("never");
  expect(defaultMcpExposure("destructive")).toBe("never");
});

it("refuses a destructive batch", () => {
  expect(() => defineAction({ ...base("destructive"), maxBatch: 2 })).toThrow(/never batches/);
});

it("refuses a people, spend or destructive action over MCP, whatever it asks for", () => {
  for (const risk of ["people", "spend", "destructive"] as const) {
    expect(() => defineAction({ ...base(risk), mcp: "propose" })).toThrow(/never exposed over MCP/);
  }
});

it("refuses assistant \"never\" without its reason", () => {
  expect(() => defineAction({ ...base("catalog"), assistant: "never" })).toThrow(/neverReason/);
  expect(defineAction({ ...base("catalog"), assistant: "never", neverReason: "a form, not a sentence" }).assistant).toBe("never");
});

it("caps a batch at 20", () => {
  expect(() => defineAction({ ...base("operational"), maxBatch: 21 })).toThrow(/1–20/);
});

it("refuses a direct MCP exposure for anything but the grandfathered update_ticket", () => {
  expect(() => defineAction({ ...base("operational"), mcp: "direct" })).toThrow(/proposals only/);
  expect(defineAction({ ...base("operational"), id: "tickets.update", mcp: "direct" }).mcp).toBe("direct");
});
