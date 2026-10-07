import { RevisionChain, toolRevisionOf } from "./revision-chain";

/**
 * The same-tool rule (amendment 2026-10-07 "manual triage"): within one
 * request, a row that stored the revision an earlier confirmed row started
 * from runs with the revision that row's write left. Nothing else is moved.
 */

const add = (toolId: string, rev: string, title = "Manual") => ({ toolId, expectedRevision: rev, resource: { title } });

describe("toolRevisionOf", () => {
  it("reads a tool and a non-empty revision, and nothing else", () => {
    expect(toolRevisionOf({ toolId: "t1", expectedRevision: "100.5" })).toEqual({ toolId: "t1", expectedRevision: "100.5" });
    expect(toolRevisionOf({ toolId: "t1", expectedRevision: "" })).toBeNull();
    expect(toolRevisionOf({ toolId: "", expectedRevision: "1" })).toBeNull();
    expect(toolRevisionOf({ logId: "x" })).toBeNull();
    expect(toolRevisionOf(null)).toBeNull();
  });
});

describe("RevisionChain", () => {
  it("runs the first row as stored and moves the next rows of the same tool to the revision our write left", () => {
    const chain = new RevisionChain();
    const first = chain.inputFor("resources.add", add("t1", "A"));
    expect(first).toEqual({ input: add("t1", "A"), chained: false });
    chain.record("resources.add", first.input, { confirmed: true, revision: "B" });

    const second = chain.inputFor("resources.edit", { toolId: "t1", expectedRevision: "A", resourceId: "r1", patch: { type: "Manual" } });
    expect(second).toEqual({ input: { toolId: "t1", expectedRevision: "B", resourceId: "r1", patch: { type: "Manual" } }, chained: true });
    chain.record("resources.edit", second.input, { confirmed: true, revision: "C" });

    expect(chain.inputFor("resources.add", add("t1", "A", "SOP"))).toEqual({ input: add("t1", "C", "SOP"), chained: true });
  });

  it("never moves a row that stored another revision, or a row of another tool", () => {
    const chain = new RevisionChain();
    chain.record("resources.add", add("t1", "A"), { confirmed: true, revision: "B" });
    expect(chain.inputFor("resources.add", add("t1", "Z"))).toEqual({ input: add("t1", "Z"), chained: false });
    expect(chain.inputFor("resources.add", add("t2", "A"))).toEqual({ input: add("t2", "A"), chained: false });
  });

  it("stops the chain for a tool once a row of it is not confirmed", () => {
    const chain = new RevisionChain();
    chain.record("resources.add", add("t1", "A"), { confirmed: true, revision: "B" });
    const refused = chain.inputFor("resources.edit", { toolId: "t1", expectedRevision: "A", resourceId: "r1", patch: {} });
    chain.record("resources.edit", refused.input, { confirmed: false });
    // The third row keeps what it stored, so it answers `conflict` for the person to see.
    expect(chain.inputFor("resources.add", add("t1", "A"))).toEqual({ input: add("t1", "A"), chained: false });
    // And a later confirmed row cannot restart it.
    chain.record("resources.add", add("t1", "B"), { confirmed: true, revision: "C" });
    expect(chain.inputFor("resources.add", add("t1", "B"))).toEqual({ input: add("t1", "B"), chained: false });
  });

  it("stops the chain when a confirmed write did not report a revision", () => {
    const chain = new RevisionChain();
    chain.record("resources.add", add("t1", "A"), { confirmed: true });
    expect(chain.inputFor("resources.add", add("t1", "A")).chained).toBe(false);
  });

  it("stops the chain when a row confirmed from a revision our last write did not leave", () => {
    const chain = new RevisionChain();
    chain.record("resources.add", add("t1", "A"), { confirmed: true, revision: "B" });
    chain.record("resources.add", add("t1", "X"), { confirmed: true, revision: "Y" });
    expect(chain.inputFor("resources.add", add("t1", "A")).chained).toBe(false);
  });

  it("leaves actions outside the chained set alone, and a confirmed one of them stops the chain", () => {
    const chain = new RevisionChain();
    chain.record("resources.add", add("t1", "A"), { confirmed: true, revision: "B" });
    const unit = { toolId: "t1", expectedRevision: "A", unitId: "u1", patch: {} };
    expect(chain.inputFor("units.edit", unit)).toEqual({ input: unit, chained: false });
    chain.record("units.edit", { ...unit, expectedRevision: "B" }, { confirmed: true, revision: "C" });
    expect(chain.inputFor("resources.add", add("t1", "A")).chained).toBe(false);
  });
});
