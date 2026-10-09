import type { MaintenanceQueueEntry } from "../../../lib/data/maintenance";
import type { UnitDown } from "../../../lib/data/units-down";
import { NEED_TO_KNOW_TICKETS, healthRows, needToKnow, needToKnowCount, waitingRows, waitingTotal } from "./overview-model";

/**
 * What the `/admin` overview says (admin sections spec 2026-10-07): Need to
 * know, Waiting for a decision and Inventory health, and that a read which
 * failed is said, never shown as zero or as nothing.
 */

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key} ${JSON.stringify(values)}` : key);

function ticket(overrides: Partial<MaintenanceQueueEntry>): MaintenanceQueueEntry {
  return {
    id: "t",
    title: "Lid will not close",
    description: "",
    resolution: "",
    type: "issue_report",
    priority: "high",
    status: "open",
    toolId: "laser",
    toolSlug: "trotec",
    toolName: "Trotec Speedy 400",
    unitId: null,
    unitLabel: "",
    reportedByName: "",
    reportedByEmail: "",
    reporterRemoved: false,
    assignedToUserId: null,
    assignedToName: "",
    dateReported: "2026-02-26",
    dateResolved: "",
    createdAt: new Date("2026-02-26T12:00:00Z"),
    ...overrides,
  };
}

describe("needToKnow", () => {
  it("lists open high and critical tickets, nobody on it first, then critical first", () => {
    const need = needToKnow(
      [
        ticket({ id: "high-assigned", priority: "high", assignedToUserId: "u", assignedToName: "Isaac S." }),
        ticket({ id: "high-free", priority: "high" }),
        ticket({ id: "critical-free", priority: "critical" }),
        ticket({ id: "low", priority: "low" }),
        ticket({ id: "done", priority: "critical", status: "resolved" }),
      ],
      0
    );
    expect(need.urgent?.map((row) => row.id)).toEqual(["critical-free", "high-free", "high-assigned"]);
    expect(need.urgent?.[2]).toMatchObject({ assigned: true, assignedToName: "Isaac S." });
  });

  it("caps the list and says how many more there are", () => {
    const many = Array.from({ length: NEED_TO_KNOW_TICKETS + 3 }, (_, i) => ticket({ id: `t${i}` }));
    const need = needToKnow(many, null);
    expect(need.urgent).toHaveLength(NEED_TO_KNOW_TICKETS);
    expect(need.moreUrgent).toBe(3);
  });

  it("counts open tickets that name no machine", () => {
    const need = needToKnow([ticket({ id: "a", toolId: null, toolName: "", priority: "low" }), ticket({ id: "b", priority: "low" })], 2);
    expect(need.unlinked).toBe(1);
    expect(need.overdueTasks).toBe(2);
    expect(needToKnowCount(need)).toBe(2);
  });

  it("says the tickets were unreadable rather than that nothing is urgent", () => {
    expect(needToKnow(null, 1).urgent).toBeNull();
  });
});

describe("waitingRows", () => {
  it("lists what waits on a decision, drops the zeros, and keeps an unreadable count as unreadable", () => {
    const rows = waitingRows(
      {
        intake: { identified: 0, researching: 0, researched: 2, failed: 0, series: [] },
        corrections: null,
        projects: { waiting: 0, published: 4 },
        proposals: { open: 1 },
      },
      t
    );
    expect(rows.map((row) => [row.key, row.value])).toEqual([
      ["intake", 2],
      ["corrections", null],
      ["proposals", 1],
    ]);
    expect(waitingTotal(rows)).toBe(3);
  });

  it("lists nothing the viewer's loaders did not read", () => {
    expect(waitingRows({}, t)).toEqual([]);
  });
});

describe("healthRows", () => {
  const unit = (overrides: Partial<UnitDown>): UnitDown => ({
    id: "u",
    unitLabel: "#2",
    status: "out_of_service",
    toolId: "t",
    toolName: "Ultimaker 3",
    toolSlug: "ultimaker-3",
    ...overrides,
  });

  it("names the units down under their counts, then the catalogue's gaps", () => {
    const rows = healthRows(
      [unit({}), unit({ id: "v", toolName: "Prusa MK3S+", unitLabel: "#4", status: "under_maintenance" })],
      { total: 10, published: 9, draft: 1, archived: 0, needsAttention: 3, noPhoto: 4, noManual: 0, neverReviewed: 12 },
      t
    );
    expect(rows.map((row) => [row.key, row.value, row.tone])).toEqual([
      ["outOfService", 1, "bad"],
      ["underMaintenance", 1, "warn"],
      ["neverReviewed", 12, "warn"],
      ["noPhoto", 4, "warn"],
      ["noManual", 0, "muted"],
    ]);
    expect(rows[0].detail).toBe("Ultimaker 3 #2");
    expect(rows[2].href).toBe("/admin/inventory?attention=never_reviewed");
  });

  it("says an unreadable read as unreadable", () => {
    const rows = healthRows(null, null, t);
    expect(rows.every((row) => row.value === null)).toBe(true);
  });
});
