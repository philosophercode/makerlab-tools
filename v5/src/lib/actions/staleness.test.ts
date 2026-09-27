import type { ActionPreview } from "./define";
import { driftedFields } from "./staleness";

/** The confirm-time comparison (assistant–GUI parity spec §3.3 step 4): field by field, `before` against now. */

const preview = (rows: ActionPreview["rows"]): ActionPreview => ({ summary: { key: "k", values: {} }, rows, subjectName: "S" });

describe("driftedFields", () => {
  it("finds nothing when every shown field still holds what the card said", () => {
    const stored = preview([{ field: "role", before: "admin", after: "user", format: "role" }]);
    expect(driftedFields(stored, preview([{ field: "role", before: "admin", after: "user", format: "role" }]))).toEqual([]);
  });

  it("names a field whose value moved, with what it is now", () => {
    const stored = preview([
      { field: "status", before: "open", after: "resolved", format: "ticketStatus" },
      { field: "resolution", before: null, after: "Belt" },
    ]);
    const fresh = preview([
      { field: "status", before: "resolved", after: "resolved", format: "ticketStatus" },
      { field: "resolution", before: null, after: "Belt" },
    ]);
    expect(driftedFields(stored, fresh)).toEqual([{ field: "status", was: "open", now: "resolved", format: "ticketStatus" }]);
  });

  it("leaves a vanished subject to the action's own not-found answer", () => {
    expect(driftedFields(preview([{ field: "title", before: "A", after: "B" }]), null)).toEqual([]);
  });

  it("treats a field missing from the fresh preview as now empty", () => {
    expect(driftedFields(preview([{ field: "title", before: "A", after: "B" }]), preview([]))).toEqual([{ field: "title", was: "A", now: null }]);
  });
});
