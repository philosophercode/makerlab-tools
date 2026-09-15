import { databaseSchema } from "../../../test/fixtures/notion";
import { PreflightError, preflight } from "./preflight";

describe("preflight", () => {
  it("passes when every defined option maps onto the vocabulary", () => {
    const result = preflight({
      units: databaseSchema("units"),
      maintenance_logs: databaseSchema("maintenance_logs"),
      flags: databaseSchema("flags"),
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("stops on a defined option that maps onto nothing, naming database, property and option", () => {
    const units = databaseSchema("units");
    units.properties.status.select?.options.push({ name: "Broken" });
    const result = preflight({
      units,
      maintenance_logs: databaseSchema("maintenance_logs"),
      flags: databaseSchema("flags"),
    });
    expect(result.problems).toEqual([
      { table: "units", property: "status", option: "Broken", storedAs: "broken" },
    ]);
    const error = new PreflightError(result.problems);
    expect(error.message).toContain('units.status: "Broken"');
  });

  it("accepts the Title-case property names the parsers tolerate", () => {
    const units = databaseSchema("units");
    units.properties.Status = units.properties.status;
    delete units.properties.status;
    const result = preflight({
      units,
      maintenance_logs: databaseSchema("maintenance_logs"),
      flags: databaseSchema("flags"),
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns, rather than stops, when a checked property or schema is missing", () => {
    const units = databaseSchema("units");
    delete units.properties.condition;
    const result = preflight({ units, maintenance_logs: databaseSchema("maintenance_logs") });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([
      { table: "units", property: "condition", reason: "property not found" },
      { table: "flags", property: "field_flagged", reason: "database schema not read" },
      { table: "flags", property: "status", reason: "database schema not read" },
    ]);
  });
});
