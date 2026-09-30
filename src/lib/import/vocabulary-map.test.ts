import { UNIT_CONDITION, UNIT_STATUS, MAINTENANCE_STATUS } from "../db/schema/vocabulary";
import { CHECKED_PROPERTIES, UnmappedOptionError, mapOption, toStoredValue } from "./vocabulary-map";

describe("toStoredValue", () => {
  it("lower-cases and joins words with underscores", () => {
    expect(toStoredValue("In Use")).toBe("in_use");
    expect(toStoredValue("Needs Repair")).toBe("needs_repair");
    expect(toStoredValue("  Preventive   Maintenance ")).toBe("preventive_maintenance");
    expect(toStoredValue("safety-info")).toBe("safety_info");
  });
});

describe("mapOption", () => {
  const where = { table: "units", property: "status" };

  it("maps every defined Notion option onto the stored list", () => {
    for (const [notion, stored] of [
      ["Available", "available"],
      ["In Use", "in_use"],
      ["Under Maintenance", "under_maintenance"],
      ["Out of Service", "out_of_service"],
      ["Retired", "retired"],
    ]) {
      expect(mapOption(UNIT_STATUS, notion, where)).toBe(stored);
    }
    expect(mapOption(UNIT_CONDITION, "New", { table: "units", property: "condition" })).toBe("new");
    expect(mapOption(MAINTENANCE_STATUS, "Closed", { table: "maintenance_logs", property: "status" })).toBe("closed");
  });

  it("returns null for empty and missing values", () => {
    expect(mapOption(UNIT_STATUS, "", where)).toBeNull();
    expect(mapOption(UNIT_STATUS, "   ", where)).toBeNull();
    expect(mapOption(UNIT_STATUS, undefined, where)).toBeNull();
    expect(mapOption(UNIT_STATUS, null, where)).toBeNull();
  });

  it("throws, naming the table, property and option, for anything unmapped", () => {
    expect(() => mapOption(UNIT_STATUS, "Broken", where)).toThrow(UnmappedOptionError);
    try {
      mapOption(UNIT_STATUS, "Broken", where);
    } catch (error) {
      const e = error as UnmappedOptionError;
      expect(e.table).toBe("units");
      expect(e.property).toBe("status");
      expect(e.option).toBe("Broken");
    }
  });
});

describe("CHECKED_PROPERTIES", () => {
  it("covers every select column that has a CHECK constraint", () => {
    const keys = CHECKED_PROPERTIES.map((c) => `${c.table}.${c.names[0]}`);
    expect(keys).toEqual([
      "units.status",
      "units.condition",
      "maintenance_logs.type",
      "maintenance_logs.priority",
      "maintenance_logs.status",
      "flags.field_flagged",
      "flags.status",
    ]);
  });
});
