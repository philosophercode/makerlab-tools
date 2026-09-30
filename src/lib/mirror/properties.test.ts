// @vitest-environment node
import type { MirrorEntity } from "../db/schema/vocabulary";
import {
  buildMirrorProperties,
  categoryProperties,
  filesProp,
  locationProperties,
  maintenanceProperties,
  optionName,
  projectProperties,
  relationTargets,
  resourceProperties,
  richText,
  toolProperties,
  unitProperties,
  type MirrorRelations,
} from "./properties";
import { mirrorPropertySpecs } from "./database-schemas";
import type {
  MaintenanceSourceRow,
  ProjectSourceRow,
  ResourceSourceRow,
  ToolSourceRow,
  UnitSourceRow,
} from "./source";

/**
 * The seven property builders (spec §10 "Mirror property builders for each
 * entity", as amended 2026-09-23: the mirror CARRIES reporter, assignee and
 * author names and emails).
 */

const BASE = {
  revision: "2026-01-01 10:00:00.123456+00",
  updatedAt: "2026-01-01T10:00:00.123Z",
  pageId: null,
  archive: false,
};

const TOOL_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "44444444-4444-4444-8444-444444444444";

/** Every target mapped, every target mirrored as `page-<id>`. */
const ALL_MIRRORED: MirrorRelations = {
  mapped: () => true,
  pageId: (_entity, id) => `page-${id}`,
};

function relations(pages: Partial<Record<MirrorEntity, string[]>>, mapped: MirrorEntity[] = ["categories", "locations", "tools", "units"]): MirrorRelations {
  return {
    mapped: (entity) => mapped.includes(entity),
    pageId: (entity, id) => (pages[entity]?.includes(id) ? `page-${id}` : null),
  };
}

function plain(value: unknown): string {
  const record = value as { title?: { text: { content: string } }[]; rich_text?: { text: { content: string } }[] };
  return (record.title ?? record.rich_text ?? []).map((item) => item.text.content).join("");
}

const tool: ToolSourceRow = {
  ...BASE,
  id: TOOL_ID,
  name: "Form 4",
  slug: "form-4",
  description: "An SLA printer.",
  categoryId: CATEGORY_ID,
  locationId: LOCATION_ID,
  materials: ["Resin", "Resin", "PLA, PETG"],
  ppeRequired: ["Gloves"],
  tags: [],
  trainingRequired: true,
  useRestrictions: null,
  emergencyStop: "Lid switch",
  notes: null,
  published: false,
  archived: false,
  lastReviewedAt: null,
  images: [
    { url: "https://blob.example.com/tools/form-4.jpg", name: "form-4.jpg" },
    { url: "https://blob.example.com/tools/side", name: null },
  ],
};

const maintenance: MaintenanceSourceRow = {
  ...BASE,
  id: "55555555-5555-4555-8555-555555555555",
  title: "Resin tank leaking",
  type: "issue_report",
  priority: "high",
  status: "in_progress",
  description: "Drips under the tray.",
  resolution: null,
  toolId: TOOL_ID,
  unitId: UNIT_ID,
  toolName: "Form 4",
  unitLabel: "Form 4 #1",
  reportedByName: "Ada Student",
  reportedByEmail: "ada@cornell.edu",
  assignedToName: "Niti",
  assigneeEmail: "niti@cornell.edu",
  dateReported: "2026-02-01",
  dateResolved: null,
};

const project: ProjectSourceRow = {
  ...BASE,
  id: "66666666-6666-4666-8666-666666666666",
  title: "Plywood lamp",
  link: "https://example.com/lamp",
  body: "Cut on the laser.",
  materials: ["Plywood"],
  toolIds: [TOOL_ID],
  authorName: "Luis",
  authorEmail: "luis@cornell.edu",
  published: true,
  publishedAt: "2026-03-02T15:00:00.000Z",
  photos: [{ url: "https://blob.example.com/projects/lamp.jpg", name: "lamp.jpg" }],
};

describe("mirror property builders", () => {
  it("categories: Name, Group, App ID, Updated", () => {
    const { properties, missingRelation } = categoryProperties({ ...BASE, id: CATEGORY_ID, name: "3D Printing", group: null });
    expect(missingRelation).toBe(false);
    expect(plain(properties.Name)).toBe("3D Printing");
    expect(properties.Group).toEqual({ rich_text: [] });
    expect(plain(properties["App ID"])).toBe(CATEGORY_ID);
    expect(properties.Updated).toEqual({ date: { start: "2026-01-01T10:00:00.123Z" } });
  });

  it("locations: the title is Room — Zone", () => {
    const { properties } = locationProperties({ ...BASE, id: LOCATION_ID, room: "Makerlab", zone: "Bench A", mapTag: null });
    expect(plain(properties.Name)).toBe("Makerlab — Bench A");
    expect(plain(properties.Room)).toBe("Makerlab");
    expect(plain(properties.Zone)).toBe("Bench A");
    expect(properties["Map tag"]).toEqual({ rich_text: [] });
  });

  it("tools: a draft says so, relations resolve, selects lose commas and duplicates, public images only", () => {
    const { properties, missingRelation } = toolProperties(tool, ALL_MIRRORED);
    expect(missingRelation).toBe(false);
    expect(properties.Published).toEqual({ checkbox: false });
    expect(properties.Archived).toEqual({ checkbox: false });
    expect(properties["Training required"]).toEqual({ checkbox: true });
    expect(properties.Category).toEqual({ relation: [{ id: `page-${CATEGORY_ID}` }] });
    expect(properties.Location).toEqual({ relation: [{ id: `page-${LOCATION_ID}` }] });
    expect(properties.Materials).toEqual({ multi_select: [{ name: "Resin" }, { name: "PLA PETG" }] });
    expect(properties.Tags).toEqual({ multi_select: [] });
    expect(properties["Use restrictions"]).toEqual({ rich_text: [] });
    expect(properties["Last reviewed"]).toEqual({ date: null });
    expect(properties.Images).toEqual({
      files: [
        { name: "form-4.jpg", type: "external", external: { url: "https://blob.example.com/tools/form-4.jpg" } },
        { name: "side", type: "external", external: { url: "https://blob.example.com/tools/side" } },
      ],
    });

    const published = toolProperties({ ...tool, published: true }, ALL_MIRRORED);
    expect(published.properties.Published).toEqual({ checkbox: true });
  });

  it("tools: a relation with no page yet is flagged; an unmapped target is left out; no category is an empty relation", () => {
    const missing = toolProperties(tool, relations({ locations: [LOCATION_ID] }));
    expect(missing.missingRelation).toBe(true);
    expect(missing.properties.Category).toEqual({ relation: [] });

    const unmapped = toolProperties(tool, relations({ locations: [LOCATION_ID] }, ["locations"]));
    expect(unmapped.missingRelation).toBe(false);
    expect("Category" in unmapped.properties).toBe(false);

    const none = toolProperties({ ...tool, categoryId: null }, relations({ locations: [LOCATION_ID] }));
    expect(none.missingRelation).toBe(false);
    expect(none.properties.Category).toEqual({ relation: [] });
  });

  it("units: selects carry the stored machine ids", () => {
    const unit: UnitSourceRow = {
      ...BASE,
      id: UNIT_ID,
      toolId: TOOL_ID,
      unitLabel: "Form 4 #1",
      serialNumber: "SN-1",
      assetTag: null,
      status: "in_use",
      condition: null,
      dateAcquired: "2025-09-01",
      notes: null,
    };
    const { properties } = unitProperties(unit, ALL_MIRRORED);
    expect(plain(properties.Label)).toBe("Form 4 #1");
    expect(properties.Status).toEqual({ select: { name: "in_use" } });
    expect(properties.Condition).toEqual({ select: null });
    expect(properties["Date acquired"]).toEqual({ date: { start: "2025-09-01" } });
    expect(properties.Tool).toEqual({ relation: [{ id: `page-${TOOL_ID}` }] });

    const orphaned = unitProperties({ ...unit, toolId: null }, ALL_MIRRORED);
    expect(orphaned.properties.Tool).toEqual({ relation: [] });
  });

  it("resources: Published checkbox, URL, public files", () => {
    const resource: ResourceSourceRow = {
      ...BASE,
      id: "77777777-7777-4777-8777-777777777777",
      toolId: TOOL_ID,
      title: "Manual",
      type: "manual",
      url: "https://formlabs.com/manual",
      published: true,
      notes: null,
      files: [{ url: "https://blob.example.com/manual.pdf", name: "manual.pdf" }],
    };
    const { properties } = resourceProperties(resource, ALL_MIRRORED);
    expect(properties.Published).toEqual({ checkbox: true });
    expect(properties.URL).toEqual({ url: "https://formlabs.com/manual" });
    expect(properties.Type).toEqual({ select: { name: "manual" } });
    expect(properties.File).toEqual({
      files: [{ name: "manual.pdf", type: "external", external: { url: "https://blob.example.com/manual.pdf" } }],
    });

    const hidden = resourceProperties({ ...resource, published: false, url: `https://x.example/${"a".repeat(2001)}` }, ALL_MIRRORED);
    expect(hidden.properties.Published).toEqual({ checkbox: false });
    expect(hidden.properties.URL).toEqual({ url: null });
  });

  it("maintenance: CARRIES the reporter's and the assignee's names and emails (2026-09-23 amendment)", () => {
    const { properties, missingRelation } = maintenanceProperties(maintenance, ALL_MIRRORED);
    expect(missingRelation).toBe(false);
    expect(plain(properties["Reported by"])).toBe("Ada Student");
    expect(properties["Reporter email"]).toEqual({ email: "ada@cornell.edu" });
    expect(plain(properties["Assigned to"])).toBe("Niti");
    expect(properties["Assignee email"]).toEqual({ email: "niti@cornell.edu" });
    expect(properties.Type).toEqual({ select: { name: "issue_report" } });
    expect(properties.Status).toEqual({ select: { name: "in_progress" } });
    expect(properties.Tool).toEqual({ relation: [{ id: `page-${TOOL_ID}` }] });
    expect(properties.Unit).toEqual({ relation: [{ id: `page-${UNIT_ID}` }] });
    expect(properties["Date resolved"]).toEqual({ date: null });

    const anonymous = maintenanceProperties(
      { ...maintenance, reportedByEmail: null, assigneeEmail: "  ", reportedByName: null },
      ALL_MIRRORED
    );
    expect(anonymous.properties["Reporter email"]).toEqual({ email: null });
    expect(anonymous.properties["Assignee email"]).toEqual({ email: null });
    expect(anonymous.properties["Reported by"]).toEqual({ rich_text: [] });
  });

  it("projects: CARRIES the author's name and email, relates every tool, public photos", () => {
    const { properties } = projectProperties(project, ALL_MIRRORED);
    expect(plain(properties.Author)).toBe("Luis");
    expect(properties["Author email"]).toEqual({ email: "luis@cornell.edu" });
    expect(properties.Tools).toEqual({ relation: [{ id: `page-${TOOL_ID}` }] });
    expect(properties.Link).toEqual({ url: "https://example.com/lamp" });
    expect(properties["Published at"]).toEqual({ date: { start: "2026-03-02T15:00:00.000Z" } });
    expect(properties.Photos).toEqual({
      files: [{ name: "lamp.jpg", type: "external", external: { url: "https://blob.example.com/projects/lamp.jpg" } }],
    });

    const partly = projectProperties({ ...project, toolIds: [TOOL_ID, UNIT_ID] }, relations({ tools: [TOOL_ID] }));
    expect(partly.missingRelation).toBe(true);
    expect(partly.properties.Tools).toEqual({ relation: [{ id: `page-${TOOL_ID}` }] });
  });

  it("writes only properties the entity's schema declares", () => {
    const rows: Record<MirrorEntity, unknown> = {
      categories: { ...BASE, id: CATEGORY_ID, name: "x", group: "y" },
      locations: { ...BASE, id: LOCATION_ID, room: "r", zone: "z", mapTag: "m" },
      tools: tool,
      units: { ...BASE, id: UNIT_ID, toolId: TOOL_ID, unitLabel: "u", serialNumber: null, assetTag: null, status: "available", condition: "good", dateAcquired: null, notes: null },
      resources: { ...BASE, id: TOOL_ID, toolId: TOOL_ID, title: "t", type: null, url: null, published: true, notes: null, files: [] },
      maintenance,
      projects: project,
    };
    for (const [entity, row] of Object.entries(rows) as [MirrorEntity, never][]) {
      const declared = new Set(mirrorPropertySpecs(entity).map((spec) => spec.name));
      const built = Object.keys(buildMirrorProperties(entity, row, ALL_MIRRORED).properties);
      expect(built.filter((name) => !declared.has(name)), entity).toEqual([]);
      // Every declared property is written, so clearing a field in the app clears it in Notion.
      expect([...declared].filter((name) => !built.includes(name)), entity).toEqual([]);
    }
  });
});

describe("Notion limits", () => {
  it("chunks long text into 2000-character items, at most 100", () => {
    const long = "a".repeat(4500);
    const items = richText(long);
    expect(items.map((item) => item.text.content.length)).toEqual([2000, 2000, 500]);
    expect(richText("b".repeat(2000 * 150))).toHaveLength(100);
    expect(richText("")).toEqual([]);
    expect(richText(null)).toEqual([]);
  });

  it("never splits a surrogate pair across two items", () => {
    const text = `${"a".repeat(1999)}😀tail`;
    const items = richText(text);
    expect(items[0].text.content).toBe("a".repeat(1999));
    expect(items[1].text.content).toBe("😀tail");
  });

  it("strips commas from option names, trims, and caps them at 100 characters", () => {
    expect(optionName("PLA, PETG")).toBe("PLA PETG");
    expect(optionName(" , ")).toBeNull();
    expect(optionName("x".repeat(150))).toHaveLength(100);
    expect(optionName(null)).toBeNull();
  });

  it("names files, capping the name at 100 characters and skipping over-long URLs", () => {
    const value = filesProp(
      [
        { url: `https://blob.example.com/${"n".repeat(150)}`, name: null },
        { url: `https://blob.example.com/${"u".repeat(2001)}`, name: "too-long" },
      ],
      "Image"
    ) as { files: { name: string }[] };
    expect(value.files).toHaveLength(1);
    expect(value.files[0].name).toHaveLength(100);
  });

  it("collects the relation targets a batch needs", () => {
    const targets = relationTargets("maintenance", [maintenance, { ...maintenance, toolId: null, unitId: null }]);
    expect([...targets.keys()].sort()).toEqual(["tools", "units"]);
    expect([...targets.get("tools")!]).toEqual([TOOL_ID]);
  });
});
