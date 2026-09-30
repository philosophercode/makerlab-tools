import {
  FEEDBACK_STATUS,
  FLAG_FIELDS,
  MAINTENANCE_PRIORITY,
  MAINTENANCE_STATUS,
  MAINTENANCE_TYPE,
  UNIT_CONDITION,
  UNIT_STATUS,
} from "../db/schema/vocabulary.ts";

/**
 * Notion option names → stored vocabulary values (spec §4, §5.7).
 *
 * `"In Use"` becomes `in_use`, `"Needs Repair"` becomes `needs_repair`. The
 * rule is mechanical so the pre-flight can apply it to Notion's *defined*
 * options and the mappers can apply it to values in use, and both agree.
 * Anything that does not land in the stored list is an error, never a
 * default: silently mapping to a default is how data gets lost.
 */

// Fields are assigned explicitly, not as constructor parameter properties,
// because the import script loads this module under Node's type stripping.
export class UnmappedOptionError extends Error {
  readonly table: string;
  readonly property: string;
  readonly option: string;

  constructor(table: string, property: string, option: string) {
    super(`Unmapped option "${option}" for ${table}.${property}`);
    this.name = "UnmappedOptionError";
    this.table = table;
    this.property = property;
    this.option = option;
  }
}

/** The mechanical rule: trim, lower-case, spaces and dashes to underscores. */
export function toStoredValue(option: string): string {
  return option.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Map one Notion value onto `list`. Empty or missing → `null` (the column is
 * nullable, or the caller supplies its default). Present but unmapped → throw.
 */
export function mapOption<const T extends readonly string[]>(
  list: T,
  option: string | null | undefined,
  where: { table: string; property: string }
): T[number] | null {
  if (option === null || option === undefined) return null;
  const trimmed = option.trim();
  if (!trimmed) return null;
  const stored = toStoredValue(trimmed);
  if ((list as readonly string[]).includes(stored)) return stored as T[number];
  throw new UnmappedOptionError(where.table, where.property, trimmed);
}

export interface CheckedProperty {
  /** The Notion database, by the import's table name. */
  table: "units" | "maintenance_logs" | "flags";
  /** Candidate property names, snake_case first (the parsers tolerate both). */
  names: readonly string[];
  /** The stored vocabulary every defined option must map onto. */
  list: readonly string[];
}

/** The select properties whose defined options the pre-flight verifies. */
export const CHECKED_PROPERTIES: readonly CheckedProperty[] = [
  { table: "units", names: ["status", "Status"], list: UNIT_STATUS },
  { table: "units", names: ["condition", "Condition"], list: UNIT_CONDITION },
  { table: "maintenance_logs", names: ["type", "Type"], list: MAINTENANCE_TYPE },
  { table: "maintenance_logs", names: ["priority", "Priority"], list: MAINTENANCE_PRIORITY },
  { table: "maintenance_logs", names: ["status", "Status"], list: MAINTENANCE_STATUS },
  { table: "flags", names: ["field_flagged", "Field Flagged"], list: FLAG_FIELDS },
  { table: "flags", names: ["status", "Status"], list: FEEDBACK_STATUS },
];
