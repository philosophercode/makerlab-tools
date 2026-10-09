import type { TriageTool } from "../../lib/actions/manual-triage";
import { chosenReady, confirmableIds, initialRows, isDecided, MAX_IDS, nextUndecided, planRowConfirm, withStatus } from "./manual-triage-state";

/** The Manuals view's decisions as data (amendment 2026-10-07 "manual triage"). */

const tool = (toolId: string, ids: string[], expiresAt = "2099-01-01T00:00:00Z"): TriageTool =>
  ({
    toolId,
    name: toolId,
    link: null,
    photo: null,
    documents: [],
    proposals: ids.map((id) => ({ id, expiresAt })),
  }) as unknown as TriageTool;

describe("manual triage state", () => {
  it("starts open, or expired when its time has passed", () => {
    expect(initialRows([tool("t1", ["a"]), tool("t2", ["b"], "2000-01-01T00:00:00Z")])).toEqual({ a: { status: "open" }, b: { status: "expired" } });
  });

  it("finds the next undecided tool after the current one, wrapping round", () => {
    const tools = [tool("t1", ["a"]), tool("t2", ["b"]), tool("t3", ["c"])];
    const rows = withStatus(initialRows(tools), ["b"], "confirmed");
    expect(nextUndecided(tools, rows, 0)).toBe(2);
    expect(nextUndecided(tools, rows, 2)).toBe(0);
    expect(nextUndecided(tools, withStatus(rows, ["a", "c"], "cancelled"), 0)).toBeNull();
  });

  it("counts a chosen or sending row as undecided", () => {
    const t = tool("t1", ["a", "b"]);
    expect(isDecided(t, { a: { status: "chosen" }, b: { status: "cancelled" } })).toBe(false);
    expect(isDecided(t, { a: { status: "sending" }, b: { status: "cancelled" } })).toBe(false);
    expect(isDecided(t, { a: { status: "conflict" }, b: { status: "cancelled" } })).toBe(true);
  });

  it("chooses a row while others are open, and sends it with the chosen ones when it is the last", () => {
    const t = tool("t1", ["a", "b", "c"]);
    let rows = initialRows([t]);
    expect(planRowConfirm(t, rows, "a")).toEqual({ choose: "a" });
    rows = withStatus(rows, ["a"], "chosen");
    rows = withStatus(rows, ["b"], "cancelled");
    expect(planRowConfirm(t, rows, "c")).toEqual({ send: ["a", "c"] });
    expect(chosenReady(t, rows)).toEqual([]);
    expect(chosenReady(t, withStatus(rows, ["c"], "cancelled"))).toEqual(["a"]);
  });

  it("confirms at most the route's limit in one request, oldest first", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
    expect(confirmableIds(tool("t1", ids), {})).toEqual(ids.slice(0, MAX_IDS));
  });
});
