import {
  MIRROR_ENTITY,
  MAINTENANCE_PRIORITY,
  MAINTENANCE_STATUS,
  MAINTENANCE_TYPE,
  UNIT_CONDITION,
  UNIT_STATUS,
  type MirrorEntity,
} from "../db/schema/vocabulary.ts";
import type { NotionDatabaseObject } from "./notion-client.ts";
import { parseNotionId } from "./notion-id.ts";
import type { MappingProblem, MirrorMapping } from "./types.ts";

/**
 * The fixed Notion schema of each mirror database (spec §3.8 "Mapping").
 *
 * **This is a schema contract, not app UI.** The property names are fixed
 * English in code, as a column name is: the push writes by name, a pasted
 * database is validated by name, and translating them would make two admins'
 * mirrors disagree. Nothing here reaches `messages/*.json`.
 *
 * Every database has an `App ID` (the Postgres uuid, so a Notion row can be
 * traced back) and an `Updated` date. Relations are one-way
 * (`single_property`) and point at the database the mapping holds for their
 * target entity. Select values are the stored machine ids verbatim
 * (`in_use`), so a filter written in Notion keeps working when a display
 * label changes.
 *
 * Relative imports with `.ts` extensions, no `server-only`: workflow step code
 * loads this module.
 */

export type MirrorPropertyType =
  | "title"
  | "rich_text"
  | "select"
  | "multi_select"
  | "checkbox"
  | "date"
  | "url"
  | "email"
  | "files"
  | "relation";

export interface MirrorPropertySpec {
  name: string;
  type: MirrorPropertyType;
  /** For a relation: the entity whose database it points at. */
  target?: MirrorEntity;
  /** For a select: the options created with the database (Notion adds any others on first use). */
  options?: readonly string[];
}

/** The property every database carries: the Postgres uuid. */
export const APP_ID_PROPERTY = "App ID";
/** The property every database carries: the row's `updated_at`. */
export const UPDATED_PROPERTY = "Updated";

export const MIRROR_DATABASE_DESCRIPTION =
  "Mirrored one way from MakerLab Tools. Edits made here are overwritten by the next push.";

/** The entity as a database title word. */
const ENTITY_TITLES: Readonly<Record<MirrorEntity, string>> = {
  categories: "Categories",
  locations: "Locations",
  tools: "Tools",
  units: "Units",
  resources: "Resources",
  maintenance: "Maintenance",
  projects: "Projects",
};

/** "MakerLab Tools — Tools" and so on. */
export function mirrorDatabaseTitle(entity: MirrorEntity): string {
  return `MakerLab Tools — ${ENTITY_TITLES[entity]}`;
}

const COMMON: readonly MirrorPropertySpec[] = [
  { name: APP_ID_PROPERTY, type: "rich_text" },
  { name: UPDATED_PROPERTY, type: "date" },
];

const SCHEMAS: Readonly<Record<MirrorEntity, readonly MirrorPropertySpec[]>> = {
  categories: [
    { name: "Name", type: "title" },
    { name: "Group", type: "rich_text" },
  ],
  locations: [
    { name: "Name", type: "title" },
    { name: "Room", type: "rich_text" },
    { name: "Zone", type: "rich_text" },
    { name: "Map tag", type: "rich_text" },
  ],
  tools: [
    { name: "Name", type: "title" },
    { name: "Slug", type: "rich_text" },
    { name: "Description", type: "rich_text" },
    { name: "Category", type: "relation", target: "categories" },
    { name: "Location", type: "relation", target: "locations" },
    { name: "Materials", type: "multi_select" },
    { name: "PPE required", type: "multi_select" },
    { name: "Tags", type: "multi_select" },
    { name: "Training required", type: "checkbox" },
    { name: "Use restrictions", type: "rich_text" },
    { name: "Emergency stop", type: "rich_text" },
    { name: "Notes", type: "rich_text" },
    { name: "Published", type: "checkbox" },
    { name: "Archived", type: "checkbox" },
    { name: "Images", type: "files" },
    { name: "Last reviewed", type: "date" },
  ],
  units: [
    { name: "Label", type: "title" },
    { name: "Tool", type: "relation", target: "tools" },
    { name: "Serial number", type: "rich_text" },
    { name: "Asset tag", type: "rich_text" },
    { name: "Status", type: "select", options: UNIT_STATUS },
    { name: "Condition", type: "select", options: UNIT_CONDITION },
    { name: "Date acquired", type: "date" },
    { name: "Notes", type: "rich_text" },
  ],
  resources: [
    { name: "Title", type: "title" },
    { name: "Tool", type: "relation", target: "tools" },
    { name: "Type", type: "select" },
    { name: "URL", type: "url" },
    { name: "File", type: "files" },
    { name: "Published", type: "checkbox" },
    { name: "Notes", type: "rich_text" },
  ],
  maintenance: [
    { name: "Title", type: "title" },
    { name: "Type", type: "select", options: MAINTENANCE_TYPE },
    { name: "Priority", type: "select", options: MAINTENANCE_PRIORITY },
    { name: "Status", type: "select", options: MAINTENANCE_STATUS },
    { name: "Description", type: "rich_text" },
    { name: "Resolution", type: "rich_text" },
    { name: "Tool", type: "relation", target: "tools" },
    { name: "Unit", type: "relation", target: "units" },
    { name: "Tool name", type: "rich_text" },
    { name: "Unit label", type: "rich_text" },
    { name: "Reported by", type: "rich_text" },
    { name: "Reporter email", type: "email" },
    { name: "Assigned to", type: "rich_text" },
    { name: "Assignee email", type: "email" },
    { name: "Date reported", type: "date" },
    { name: "Date resolved", type: "date" },
  ],
  projects: [
    { name: "Title", type: "title" },
    { name: "Link", type: "url" },
    { name: "Body", type: "rich_text" },
    { name: "Materials", type: "multi_select" },
    { name: "Tools", type: "relation", target: "tools" },
    { name: "Author", type: "rich_text" },
    { name: "Author email", type: "email" },
    { name: "Published at", type: "date" },
    { name: "Photos", type: "files" },
  ],
};

/** An expected property, with the database id a relation must point at when its target is mapped. */
export interface ExpectedProperty extends MirrorPropertySpec {
  /** Dashed lower-case database id of the relation's target, or null when the target is not mapped. */
  targetDatabaseId?: string | null;
}

/** Every property `entity`'s database must have, in declaration order (the common two last). */
export function mirrorPropertySpecs(entity: MirrorEntity): readonly MirrorPropertySpec[] {
  return [...SCHEMAS[entity], ...COMMON];
}

/** The expected properties of `entity`'s database under `mapping`. */
export function expectedProperties(entity: MirrorEntity, mapping: MirrorMapping): ExpectedProperty[] {
  return mirrorPropertySpecs(entity).map((spec) =>
    spec.type === "relation" && spec.target
      ? { ...spec, targetDatabaseId: normalizeDatabaseId(mapping[spec.target]) }
      : { ...spec }
  );
}

/** The relation properties of `entity`, with their target entities. */
export function relationProperties(entity: MirrorEntity): { name: string; target: MirrorEntity }[] {
  return SCHEMAS[entity]
    .filter((spec) => spec.type === "relation" && spec.target)
    .map((spec) => ({ name: spec.name, target: spec.target as MirrorEntity }));
}

/**
 * The entities with a relation property pointing at any of `targets`, not
 * counting `targets` themselves — whose pages link to a target's pages. When a
 * target's pages are forgotten (a recreated or repointed database), these
 * pages carry links into the old database and must be pushed again.
 */
export function relationDependents(targets: readonly MirrorEntity[]): MirrorEntity[] {
  const set = new Set(targets);
  return MIRROR_ENTITY.filter(
    (entity) => !set.has(entity) && relationProperties(entity).some((relation) => set.has(relation.target))
  );
}

/**
 * Whether `database` has every property the push writes, with the right type
 * — and, for a relation whose target is mapped, pointing at that target.
 * Extra properties are allowed; an admin may add their own columns.
 *
 * A relation pointing at the wrong database is reported in `wrongType`: it has
 * the right Notion type but the wrong shape for this mirror.
 */
export function validateDatabaseSchema(
  entity: MirrorEntity,
  database: NotionDatabaseObject,
  mapping: MirrorMapping
): MappingProblem | null {
  const missing: string[] = [];
  const wrongType: string[] = [];
  const properties = database.properties ?? {};
  for (const expected of expectedProperties(entity, mapping)) {
    const actual = properties[expected.name];
    if (!actual) {
      missing.push(expected.name);
      continue;
    }
    if (actual.type !== expected.type) {
      wrongType.push(expected.name);
      continue;
    }
    if (expected.type === "relation" && expected.targetDatabaseId) {
      const pointsAt = normalizeDatabaseId(actual.relation?.database_id);
      if (pointsAt !== expected.targetDatabaseId) wrongType.push(expected.name);
    }
  }
  if (missing.length === 0 && wrongType.length === 0) return null;
  return {
    entity,
    code: "schema_mismatch",
    ...(missing.length ? { missing } : {}),
    ...(wrongType.length ? { wrongType } : {}),
  };
}

/** One property's schema as `POST /databases` / `PATCH /databases/:id` take it. */
export function propertySchemaBody(spec: MirrorPropertySpec, targetDatabaseId: string | null): Record<string, unknown> | null {
  switch (spec.type) {
    case "relation":
      if (!targetDatabaseId) return null;
      return { relation: { database_id: targetDatabaseId, type: "single_property", single_property: {} } };
    case "select":
      return { select: { options: (spec.options ?? []).map((name) => ({ name })) } };
    case "multi_select":
      return { multi_select: { options: [] } };
    default:
      return { [spec.type]: {} };
  }
}

/**
 * The `POST /databases` body for `entity` under `parentPageId`. A relation
 * whose target has no database yet is left out; `ensureMirrorDatabases`
 * creates in dependency order, so that only happens to a caller that skipped
 * a target.
 */
export function databaseCreateBody(entity: MirrorEntity, parentPageId: string, mapping: MirrorMapping): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const expected of expectedProperties(entity, mapping)) {
    const body = propertySchemaBody(expected, expected.targetDatabaseId ?? null);
    if (body) properties[expected.name] = body;
  }
  return {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: mirrorDatabaseTitle(entity) } }],
    description: [{ type: "text", text: { content: MIRROR_DATABASE_DESCRIPTION } }],
    properties,
  };
}

/** A database id in the form Notion returns and the mapping stores, or null. */
export function normalizeDatabaseId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return parseNotionId(value);
}
