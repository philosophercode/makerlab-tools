// @vitest-environment node
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn() }));

vi.mock("../data/audit", () => audit);

import { record, warn } from "./audit-warning";

/**
 * The channel every admin write shares: a change that landed without its audit
 * event is a success with a warning, never a failure (spec §4.11, Article 4).
 *
 * The seam is mocked rather than the database, because the property under test
 * is what happens to the *caller* when the insert throws — not what the insert
 * does.
 */

const EVENT = {
  actorUserId: null,
  action: "tool.published" as const,
  subjectType: "tool",
  subjectId: "abc",
};

beforeEach(() => {
  audit.recordAuditEvent.mockReset();
});

describe("record", () => {
  it("reports success when the event landed", async () => {
    audit.recordAuditEvent.mockResolvedValue({ id: "evt" });
    expect(await record(EVENT, "inventory")).toBe(true);
  });

  it("never rejects, and names the surface in the line that is now the only copy", async () => {
    audit.recordAuditEvent.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});

    // The change it describes has already committed. Throwing here would reach
    // the island as a rejection, and every island answers a rejection by
    // restoring the previous value.
    await expect(record(EVENT, "inventory")).resolves.toBe(false);
    expect(console_).toHaveBeenCalledWith(
      "[inventory] audit write failed after the change landed",
      expect.any(Error)
    );

    console_.mockRestore();
  });
});

describe("warn", () => {
  it("adds no key at all to a success with nothing missing", () => {
    expect(warn(undefined)).toEqual({});
    expect(warn(undefined, true)).toEqual({});
  });

  it("says so when the action's own event did not land", () => {
    expect(warn(undefined, false)).toEqual({ warning: "audit_unavailable" });
  });

  it("carries a gap the gate already had, whatever the action's own event did", () => {
    // Two audit writes can go missing on one action and the admin's question is
    // the same either way: did the trail record this?
    expect(warn("audit_unavailable", true)).toEqual({ warning: "audit_unavailable" });
    expect(warn("audit_unavailable", false)).toEqual({ warning: "audit_unavailable" });
  });
});
