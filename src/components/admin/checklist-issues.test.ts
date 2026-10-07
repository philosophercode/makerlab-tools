import { issuesForTask, openIssues, type ChecklistIssue } from "./checklist-issues";

/**
 * Which open tickets a Shift checklist task offers to resolve (recurring
 * maintenance spec, amendment 2026-10-07): the ones on the same machine.
 */

const issue = (overrides: Partial<ChecklistIssue>): ChecklistIssue => ({
  id: "i",
  title: "Lens smudged",
  toolId: "laser",
  unitId: null,
  priority: "high",
  ...overrides,
});

describe("openIssues", () => {
  it("keeps open and in-progress tickets only", () => {
    const rows = [
      { id: "a", title: "A", status: "open", toolId: "t", unitId: null, priority: null },
      { id: "b", title: "B", status: "in_progress", toolId: "t", unitId: null, priority: "low" },
      { id: "c", title: "C", status: "resolved", toolId: "t", unitId: null, priority: null },
      { id: "d", title: "D", status: "closed", toolId: "t", unitId: null, priority: null },
    ];
    expect(openIssues(rows).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("leaves out a demo pass's ticket (demo pass spec 2026-10-07 §5.4)", () => {
    const rows = [
      { id: "lab", title: "Lab", status: "open", toolId: "t", unitId: null, priority: null, demo: false },
      { id: "demo", title: "Demo", status: "open", toolId: "t", unitId: null, priority: "high", demo: true },
    ];
    expect(openIssues(rows).map((row) => row.id)).toEqual(["lab"]);
  });
});

describe("issuesForTask", () => {
  const issues = [
    issue({ id: "tool-wide", unitId: null }),
    issue({ id: "unit-1", unitId: "u1" }),
    issue({ id: "unit-2", unitId: "u2" }),
    issue({ id: "other-tool", toolId: "printer" }),
  ];

  it("gives a whole-tool task every ticket on the tool", () => {
    expect(issuesForTask({ toolId: "laser", unitId: null }, issues).map((row) => row.id)).toEqual(["tool-wide", "unit-1", "unit-2"]);
  });

  it("gives a one-unit task that unit's tickets and the tool's unit-less ones", () => {
    expect(issuesForTask({ toolId: "laser", unitId: "u1" }, issues).map((row) => row.id)).toEqual(["tool-wide", "unit-1"]);
  });

  it("gives general lab upkeep none", () => {
    expect(issuesForTask({ toolId: null, unitId: null }, issues)).toEqual([]);
  });
});
