import {
  categoriesPage,
  flagsPage,
  locationsPage,
  maintenanceLogsPage,
  projectsPage,
  resourcesPage,
  toolsPage,
  unitsPage,
} from "../../../test/fixtures/notion";
import {
  pageToCategory,
  pageToFlag,
  pageToLocation,
  pageToMaintenanceLog,
  pageToProject,
  pageToResource,
  pageToTool,
  pageToUnit,
  type NotionPage,
} from "../notion";
import { UnmappedOptionError } from "./vocabulary-map";
import {
  isoDate,
  toCategoryRow,
  toFeedbackRow,
  toLocationRow,
  toMaintenanceRow,
  toProjectRow,
  toResourceRow,
  toToolRow,
  toUnitRow,
} from "./mappers";

const asPage = (fixture: unknown) => fixture as NotionPage;

describe("isoDate", () => {
  it("keeps a plain date, trims a datetime, rejects anything else", () => {
    expect(isoDate("2024-09-01")).toBe("2024-09-01");
    expect(isoDate("2024-09-01T10:00:00.000Z")).toBe("2024-09-01");
    expect(isoDate("Sept 1")).toBeNull();
    expect(isoDate("")).toBeNull();
  });
});

describe("row mappers over the Notion fixtures", () => {
  it("maps a category and a location, keeping the Notion page id and created time", () => {
    const category = toCategoryRow(pageToCategory(asPage(categoriesPage)));
    expect(category.row).toMatchObject({ name: "Resin", group: "3D Printing", notionPageId: "cat-1" });
    expect(category.row.createdAt).toEqual(new Date("2024-08-12T10:00:00.000Z"));

    const location = toLocationRow(pageToLocation(asPage(locationsPage)));
    expect(location.row).toMatchObject({ room: "MakerLab", zone: "Resin Bench", mapTag: "ML-RESIN-01" });
    expect(location.warnings).toEqual([]);
  });

  it("maps a tool with resolved relations and empty strings as null", () => {
    const { row, warnings } = toToolRow(pageToTool(asPage(toolsPage)), {
      slug: "form-4",
      categoryId: "cat-uuid",
      locationId: "loc-uuid",
    });
    expect(row).toMatchObject({
      slug: "form-4",
      name: "Form 4",
      categoryId: "cat-uuid",
      locationId: "loc-uuid",
      materials: ["Standard resin", "Tough resin"],
      trainingRequired: true,
      published: true,
      notionPageId: "tool-1",
    });
    expect(warnings).toEqual([]);
  });

  it("warns when a tool's relation could not be resolved", () => {
    const { row, warnings } = toToolRow(pageToTool(asPage(toolsPage)), {
      slug: "form-4",
      categoryId: null,
      locationId: null,
    });
    expect(row.categoryId).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it("maps a unit's vocabulary and date, and defaults status when blank", () => {
    const { row, warnings } = toUnitRow(pageToUnit(asPage(unitsPage)), { toolId: "tool-uuid" });
    expect(row).toMatchObject({
      toolId: "tool-uuid",
      unitLabel: "Form 4 #1",
      serialNumber: "ML-F4-001",
      status: "available",
      condition: "excellent",
      dateAcquired: "2024-08-12",
    });
    expect(warnings).toEqual([]);

    const blank = pageToUnit(asPage({ ...unitsPage, properties: { unit_label: unitsPage.properties.unit_label } }));
    const mapped = toUnitRow(blank, { toolId: null });
    expect(mapped.row.status).toBe("available");
    expect(mapped.row.condition).toBeNull();
    expect(mapped.warnings).toContain("unit Form 4 #1 (unit-1) is not linked to a tool");
  });

  it("keeps an unparseable acquisition date in the notes rather than dropping it", () => {
    const record = pageToUnit(asPage(unitsPage));
    record.fields.date_acquired = "Fall 2023";
    const { row, warnings } = toUnitRow(record, { toolId: "tool-uuid" });
    expect(row.dateAcquired).toBeNull();
    expect(row.notes).toContain("Date acquired: Fall 2023");
    expect(warnings.some((w) => w.includes("not a date"))).toBe(true);
  });

  it("throws on a unit status the vocabulary does not know", () => {
    const record = pageToUnit(asPage(unitsPage));
    record.fields.status = "Broken" as never;
    expect(() => toUnitRow(record, { toolId: null })).toThrow(UnmappedOptionError);
  });

  it("maps a resource", () => {
    const { row } = toResourceRow(pageToResource(asPage(resourcesPage)), { toolId: "tool-uuid" });
    expect(row).toMatchObject({ title: "Form 4 SOP", type: "SOP", url: "https://example.com/form4-sop", published: true });
  });

  it("maps a maintenance log, taking the reporter email from the raw page and snapshots from refs", () => {
    const record = { ...pageToMaintenanceLog(asPage(maintenanceLogsPage)), reporterEmail: "ada@cornell.edu" };
    const { row, warnings } = toMaintenanceRow(record, {
      unitId: "unit-uuid",
      toolId: "tool-uuid",
      toolName: "Form 4",
      unitLabel: "Form 4 #1",
    });
    expect(row).toMatchObject({
      title: "Resin tank cloudy",
      type: "issue_report",
      priority: "medium",
      status: "open",
      description: "The resin tank looks cloudy after the last print.",
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
      assignedToName: "Lab Staff",
      dateReported: "2024-09-01",
      dateResolved: null,
      toolName: "Form 4",
      unitLabel: "Form 4 #1",
    });
    expect(warnings).toEqual([]);
  });

  it("splits a composed ticket description back into columns", () => {
    const record = { ...pageToMaintenanceLog(asPage(maintenanceLogsPage)), reporterEmail: null };
    record.fields.description =
      "**What happened**\nBelt slipping.\n\n**Reported by**\nGrace Hopper\n\n**Date reported**\n2024-10-02\n\n**Priority**\nHigh";
    record.fields.reported_by = "";
    record.fields.priority = undefined;
    record.fields.date_reported = "";
    const { row } = toMaintenanceRow(record, { unitId: null, toolId: null, toolName: null, unitLabel: null });
    expect(row.description).toBe("Belt slipping.");
    expect(row.reportedByName).toBe("Grace Hopper");
    expect(row.dateReported).toBe("2024-10-02");
    expect(row.priority).toBe("high");
  });

  it("maps a flag into feedback with the stored vocabulary", () => {
    const record = { ...pageToFlag(asPage(flagsPage)), reporterEmail: null };
    const { row } = toFeedbackRow(record, { toolId: "tool-uuid" });
    expect(row).toMatchObject({
      toolId: "tool-uuid",
      fieldFlagged: "description",
      issueDescription: "The description says 80W but the label says 60W.",
      suggestedFix: "Change 80W to 60W.",
      reporterName: "Ada Lovelace",
      status: "new",
      notionPageId: "flag-1",
    });
  });

  it("maps a project", () => {
    const { row } = toProjectRow(pageToProject(asPage(projectsPage)), { slug: "lamp" });
    expect(row).toMatchObject({
      slug: "lamp",
      title: "Laser-cut lamp",
      authorName: "Ada Lovelace",
      materials: ["Plywood"],
      published: true,
      notionPageId: "project-1",
    });
  });
});
