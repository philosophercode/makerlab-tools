import type { NotionDatabaseSchema } from "../notion.ts";
import { CHECKED_PROPERTIES, toStoredValue, type CheckedProperty } from "./vocabulary-map.ts";

/**
 * The import's pre-flight (spec §5.7 step 1).
 *
 * Reads each database's *defined* option sets — not the values in use — and
 * compares them with the stored vocabularies. A defined option that maps onto
 * nothing is a problem that stops the import, because the constraint it would
 * violate is exactly the one a later write would hit in production. A checked
 * property that is missing altogether is only a warning: the parsers tolerate
 * a missing property, and the mappers fall back to the column default.
 */

export interface PreflightProblem {
  table: CheckedProperty["table"];
  property: string;
  option: string;
  /** What the mechanical rule produced, for the error message. */
  storedAs: string;
}

export interface PreflightWarning {
  table: CheckedProperty["table"];
  property: string;
  reason: string;
}

export interface PreflightResult {
  problems: PreflightProblem[];
  warnings: PreflightWarning[];
}

export type SchemasByTable = Partial<Record<CheckedProperty["table"], NotionDatabaseSchema>>;

export function preflight(schemas: SchemasByTable): PreflightResult {
  const problems: PreflightProblem[] = [];
  const warnings: PreflightWarning[] = [];

  for (const check of CHECKED_PROPERTIES) {
    const schema = schemas[check.table];
    const propertyName = check.names[0];
    if (!schema) {
      warnings.push({ table: check.table, property: propertyName, reason: "database schema not read" });
      continue;
    }

    const property = check.names.map((name) => schema.properties[name]).find(Boolean);
    if (!property) {
      warnings.push({ table: check.table, property: propertyName, reason: "property not found" });
      continue;
    }

    const options = property.select?.options ?? property.multi_select?.options;
    if (!options) {
      warnings.push({
        table: check.table,
        property: propertyName,
        reason: `property is ${property.type}, not a select`,
      });
      continue;
    }

    for (const option of options) {
      const storedAs = toStoredValue(option.name);
      if (!check.list.includes(storedAs)) {
        problems.push({ table: check.table, property: propertyName, option: option.name, storedAs });
      }
    }
  }

  return { problems, warnings };
}

/** Thrown by the import when the pre-flight finds problems; lists every one. */
export class PreflightError extends Error {
  readonly problems: PreflightProblem[];

  constructor(problems: PreflightProblem[]) {
    super(
      [
        "Pre-flight stopped the import. These Notion options map onto no stored value:",
        ...problems.map((p) => `  ${p.table}.${p.property}: "${p.option}" (would be "${p.storedAs}")`),
        "Add the value to src/lib/db/schema/vocabulary.ts with a migration, or fix the option in Notion.",
      ].join("\n")
    );
    this.name = "PreflightError";
    this.problems = problems;
  }
}
