// @vitest-environment node
import { MIRROR_ENTITY } from "../db/schema/vocabulary";
import {
  databaseCreateBody,
  expectedProperties,
  mirrorDatabaseTitle,
  mirrorPropertySpecs,
  validateDatabaseSchema,
} from "./database-schemas";
import type { NotionDatabaseObject } from "./notion-client";

/** The fixed Notion schemas and their validation (spec §3.8 "Mapping"). */

const CATEGORIES_DB = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATIONS_DB = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_DB = "aaaaaaaa-0000-4000-8000-0000000000ff";

/** A database object as Notion returns it for the tools schema under `mapping`. */
function toolsDatabase(): NotionDatabaseObject {
  const properties: NotionDatabaseObject["properties"] = {};
  for (const expected of expectedProperties("tools", { categories: CATEGORIES_DB, locations: LOCATIONS_DB })) {
    properties[expected.name] = {
      id: expected.name,
      name: expected.name,
      type: expected.type,
      ...(expected.type === "relation" ? { relation: { database_id: expected.targetDatabaseId ?? undefined } } : {}),
    };
  }
  return { object: "database", id: OTHER_DB, properties };
}

const MAPPING = { categories: CATEGORIES_DB, locations: LOCATIONS_DB };

describe("mirror database schemas", () => {
  it("gives every database exactly one title, an App ID and an Updated date", () => {
    for (const entity of MIRROR_ENTITY) {
      const specs = mirrorPropertySpecs(entity);
      expect(specs.filter((spec) => spec.type === "title"), entity).toHaveLength(1);
      expect(specs.find((spec) => spec.name === "App ID")?.type).toBe("rich_text");
      expect(specs.find((spec) => spec.name === "Updated")?.type).toBe("date");
      expect(new Set(specs.map((spec) => spec.name)).size, entity).toBe(specs.length);
    }
  });

  it("carries the email properties the 2026-09-23 amendment added", () => {
    const maintenance = Object.fromEntries(mirrorPropertySpecs("maintenance").map((spec) => [spec.name, spec.type]));
    expect(maintenance["Reporter email"]).toBe("email");
    expect(maintenance["Assignee email"]).toBe("email");
    const projects = Object.fromEntries(mirrorPropertySpecs("projects").map((spec) => [spec.name, spec.type]));
    expect(projects["Author email"]).toBe("email");
  });

  it("builds a create body under the parent page, with one-way relations to the mapped targets", () => {
    const body = databaseCreateBody("tools", "page-id", MAPPING) as {
      parent: unknown;
      title: { text: { content: string } }[];
      description: { text: { content: string } }[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(body.parent).toEqual({ type: "page_id", page_id: "page-id" });
    expect(body.title[0].text.content).toBe(mirrorDatabaseTitle("tools"));
    expect(body.title[0].text.content).toBe("MakerLab Tools — Tools");
    expect(body.description[0].text.content).toBe(
      "Mirrored one way from MakerLab Tools. Edits made here are overwritten by the next push."
    );
    expect(body.properties.Category).toEqual({
      relation: { database_id: CATEGORIES_DB, type: "single_property", single_property: {} },
    });
    expect(body.properties.Name).toEqual({ title: {} });
    expect(body.properties.Published).toEqual({ checkbox: {} });

    const units = databaseCreateBody("units", "page-id", {}) as { properties: Record<string, Record<string, { options: { name: string }[] }>> };
    expect("Tool" in units.properties).toBe(false);
    expect(units.properties.Status.select.options.map((option) => option.name)).toContain("in_use");
  });

  it("accepts a database with the expected schema, extra properties allowed", () => {
    const database = toolsDatabase();
    database.properties["Somebody's column"] = { type: "number" };
    expect(validateDatabaseSchema("tools", database, MAPPING)).toBeNull();
  });

  it("reports a missing property", () => {
    const database = toolsDatabase();
    delete database.properties["Emergency stop"];
    expect(validateDatabaseSchema("tools", database, MAPPING)).toEqual({
      entity: "tools",
      code: "schema_mismatch",
      missing: ["Emergency stop"],
    });
  });

  it("reports a property of the wrong type", () => {
    const database = toolsDatabase();
    database.properties.Published = { type: "rich_text" };
    expect(validateDatabaseSchema("tools", database, MAPPING)).toEqual({
      entity: "tools",
      code: "schema_mismatch",
      wrongType: ["Published"],
    });
  });

  it("reports a relation pointing at the wrong database, but only when its target is mapped", () => {
    const database = toolsDatabase();
    database.properties.Category = { type: "relation", relation: { database_id: OTHER_DB } };
    expect(validateDatabaseSchema("tools", database, MAPPING)).toMatchObject({ wrongType: ["Category"] });
    // Undashed ids compare equal to dashed ones.
    database.properties.Category = { type: "relation", relation: { database_id: CATEGORIES_DB.replace(/-/g, "") } };
    expect(validateDatabaseSchema("tools", database, MAPPING)).toBeNull();
    // With categories unmapped, any relation target is accepted.
    database.properties.Category = { type: "relation", relation: { database_id: OTHER_DB } };
    expect(validateDatabaseSchema("tools", database, { locations: LOCATIONS_DB })).toBeNull();
  });
});
