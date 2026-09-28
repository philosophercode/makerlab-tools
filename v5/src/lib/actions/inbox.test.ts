import type { ActionProposalRecord } from "../data/action-proposals";
import type { ActionRisk } from "./define";
import { areaOrderOf, buildInbox } from "./inbox";

/**
 * The Assistant proposals inbox as data (assistant–GUI parity spec §6): open
 * proposals become the chat's cards, one per call, grouped by area in the
 * registry's order; decided ones are a reference list; a row for an action no
 * longer registered is left out.
 */

let seq = 0;
function row(overrides: Partial<ActionProposalRecord>): ActionProposalRecord {
  seq += 1;
  return {
    id: `p-${seq}`,
    groupId: `g-${seq}`,
    actionId: "tools.set_published",
    input: {},
    subjectType: "tool",
    subjectId: `t-${seq}`,
    preview: { summary: { key: "tools_publish", values: { name: `Tool ${seq}` } }, rows: [], subjectName: `Tool ${seq}` },
    surface: "mcp",
    chatId: null,
    status: "open",
    result: null,
    tainted: false,
    createdBy: "u-sam",
    decidedBy: null,
    decidedAt: null,
    expiresAt: new Date("2026-10-04T12:00:00Z"),
    createdAt: new Date(`2026-09-27T12:00:${String(seq % 60).padStart(2, "0")}Z`),
    expired: false,
    ...overrides,
  };
}

const RISKS: Record<string, ActionRisk> = {
  "tools.set_published": "catalog",
  "tickets.log_completed": "operational",
  "corrections.set_status": "operational",
};
const riskOf = (id: string) => RISKS[id];

describe("buildInbox", () => {
  it("draws one card per proposal group, its rows oldest first, with the action's risk", () => {
    const a = row({ groupId: "g-batch" });
    const b = row({ groupId: "g-batch" });
    const view = buildInbox([b, a], riskOf);
    expect(view.areas).toHaveLength(1);
    expect(view.areas[0].area).toBe("tools");
    expect(view.areas[0].cards).toEqual([
      {
        kind: "action-proposal",
        groupId: "g-batch",
        actionId: "tools.set_published",
        risk: "catalog",
        items: [a, b].map((r) => ({ id: r.id, subjectId: r.subjectId, preview: r.preview, expiresAt: "2026-10-04T12:00:00.000Z" })),
        refused: [],
      },
    ]);
    expect(view.waiting).toBe(2);
  });

  it("never puts two calls' proposals on one card, so bulk confirm never crosses a group (§6)", () => {
    const view = buildInbox([row({ groupId: "g-1" }), row({ groupId: "g-2" })], riskOf);
    expect(view.areas[0].cards.map((card) => card.groupId)).toEqual(["g-2", "g-1"]);
  });

  it("groups by area in the registry's order", () => {
    const order = areaOrderOf(["tickets.update", "tickets.log_completed", "corrections.set_status", "tools.set_published"]);
    expect(order).toEqual(["tickets", "corrections", "tools"]);
    const view = buildInbox(
      [row({ actionId: "tools.set_published" }), row({ actionId: "corrections.set_status" }), row({ actionId: "tickets.log_completed" })],
      riskOf,
      order
    );
    expect(view.areas.map((area) => area.area)).toEqual(["tickets", "corrections", "tools"]);
  });

  it("shows an expired open row on its card (the card says Expired) but does not count it as waiting", () => {
    const view = buildInbox([row({ expired: true })], riskOf);
    expect(view.areas[0].cards[0].items).toHaveLength(1);
    expect(view.waiting).toBe(0);
  });

  it("lists decided rows for reference, newest decision first, with the refusal code", () => {
    const view = buildInbox(
      [
        row({ status: "confirmed", decidedAt: new Date("2026-09-25T10:00:00Z") }),
        row({ status: "failed", result: { error: "not_permitted" }, decidedAt: new Date("2026-09-26T10:00:00Z") }),
      ],
      riskOf
    );
    expect(view.areas).toEqual([]);
    expect(view.decided.map((d) => [d.status, d.error])).toEqual([
      ["failed", "not_permitted"],
      ["confirmed", undefined],
    ]);
  });

  it("carries the tainted mark to the card", () => {
    expect(buildInbox([row({ tainted: true })], riskOf).areas[0].cards[0].tainted).toBe(true);
  });

  it("leaves out a row whose action is no longer registered: nothing could run it", () => {
    expect(buildInbox([row({ actionId: "widgets.spin" })], riskOf)).toEqual({ areas: [], decided: [], waiting: 0 });
  });
});
