import type { MirrorEntity } from "../db/schema/vocabulary.ts";
import { APP_ID_PROPERTY, UPDATED_PROPERTY } from "./database-schemas.ts";
import type {
  AnySourceRow,
  CategorySourceRow,
  LocationSourceRow,
  MaintenanceSourceRow,
  MirrorFile,
  ProjectSourceRow,
  ResourceSourceRow,
  SourceRows,
  ToolSourceRow,
  UnitSourceRow,
} from "./source.ts";

/**
 * Pure builders: one source row → the Notion `properties` of its page (spec
 * §3.8; the schemas are in `database-schemas.ts`).
 *
 * They respect Notion's request limits, so a long description or a stray
 * comma cannot fail a push:
 *
 * - text is split into rich-text items of at most 2000 characters, at most
 *   100 of them (never cutting a surrogate pair in half);
 * - select and multi-select names lose their commas (Notion refuses them), are
 *   cut to 100 characters, and are de-duplicated; empty names are dropped;
 * - a URL longer than 2000 characters is left out rather than truncated into
 *   a different URL;
 * - files are external `{ name, type: "external", external: { url } }` items,
 *   names cut to 100 characters;
 * - every empty value is sent explicitly (`[]`, `null`, `false`), so clearing
 *   a field in the app clears it in Notion.
 *
 * **Emails are carried** (2026-09-23 amendment): the maintenance builder sends
 * the reporter's and the assignee's name and email, the project builder the
 * author's. Nothing here logs.
 *
 * **Relations** are resolved through a {@link MirrorRelations} the push builds
 * from `mirror_pages`. A target whose entity is not mapped leaves the property
 * out (there is no database to point at). A target that should have a page
 * and does not yet sets `missingRelation`, so the push records the row as not
 * yet mirrored and tries it again next time.
 */

export const NOTION_TEXT_CHUNK = 2000;
export const NOTION_MAX_RICH_TEXT_ITEMS = 100;
export const NOTION_MAX_OPTION_LENGTH = 100;
export const NOTION_MAX_URL_LENGTH = 2000;
export const NOTION_MAX_FILE_NAME_LENGTH = 100;
export const NOTION_MAX_ARRAY_ITEMS = 100;

/** Page ids of already-mirrored rows, by target entity. */
export interface MirrorRelations {
  /** Whether `entity` has a database in this mirror's mapping. */
  mapped(entity: MirrorEntity): boolean;
  /** The Notion page mirroring `entity` row `id`, or null when it has none yet. */
  pageId(entity: MirrorEntity, id: string): string | null;
}

export interface BuiltProperties {
  properties: Record<string, unknown>;
  /** A relation target that should exist in Notion does not yet. */
  missingRelation: boolean;
}

type Properties = Record<string, unknown>;

// ── Value helpers ───────────────────────────────────────────────────

/** Text as rich-text items: ≤2000 characters each, ≤100 items, `[]` when empty. */
export function richText(value: string | null | undefined): { type: "text"; text: { content: string } }[] {
  const text = value ?? "";
  if (text === "") return [];
  const items: { type: "text"; text: { content: string } }[] = [];
  let start = 0;
  while (start < text.length && items.length < NOTION_MAX_RICH_TEXT_ITEMS) {
    let end = Math.min(text.length, start + NOTION_TEXT_CHUNK);
    // Never split a surrogate pair across two items.
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    items.push({ type: "text", text: { content: text.slice(start, end) } });
    start = end;
  }
  return items;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** A select / multi-select option name: no commas, trimmed, ≤100 characters; null when nothing is left. */
export function optionName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return truncate(cleaned, NOTION_MAX_OPTION_LENGTH).trim() || null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  if (isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

function titleProp(value: string | null | undefined): Properties[string] {
  return { title: richText(value) };
}

function textProp(value: string | null | undefined): Properties[string] {
  return { rich_text: richText(value) };
}

function selectProp(value: string | null | undefined): Properties[string] {
  const name = optionName(value);
  return { select: name ? { name } : null };
}

function multiSelectProp(values: readonly string[]): Properties[string] {
  const seen = new Set<string>();
  const out: { name: string }[] = [];
  for (const value of values) {
    const name = optionName(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name });
    if (out.length >= NOTION_MAX_ARRAY_ITEMS) break;
  }
  return { multi_select: out };
}

function checkboxProp(value: boolean): Properties[string] {
  return { checkbox: value === true };
}

function dateProp(value: string | null | undefined): Properties[string] {
  return { date: value ? { start: value } : null };
}

/** A URL, trimmed; null when empty or longer than Notion takes. */
export function urlValue(value: string | null | undefined): string | null {
  const url = (value ?? "").trim();
  if (!url || url.length > NOTION_MAX_URL_LENGTH) return null;
  return url;
}

function urlProp(value: string | null | undefined): Properties[string] {
  return { url: urlValue(value) };
}

function emailProp(value: string | null | undefined): Properties[string] {
  const email = (value ?? "").trim();
  return { email: email || null };
}

/** External files: public URLs only reach here (source.ts selects nothing else). */
export function filesProp(files: readonly MirrorFile[], fallbackName: string): Properties[string] {
  const out: { name: string; type: "external"; external: { url: string } }[] = [];
  for (const file of files) {
    const url = urlValue(file.url);
    if (!url) continue;
    const name = truncate((file.name?.trim() || nameFromUrl(url) || `${fallbackName} ${out.length + 1}`).trim(), NOTION_MAX_FILE_NAME_LENGTH);
    out.push({ name: name || `${fallbackName} ${out.length + 1}`, type: "external", external: { url } });
    if (out.length >= NOTION_MAX_ARRAY_ITEMS) break;
  }
  return { files: out };
}

function nameFromUrl(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/** Relation state collected while a row's properties are built. */
class RelationSink {
  missing = false;
  private readonly relations: MirrorRelations;

  constructor(relations: MirrorRelations) {
    this.relations = relations;
  }

  /** Set `properties[name]` to the relation, or leave it out when the target is not mapped. */
  one(properties: Properties, name: string, target: MirrorEntity, id: string | null): void {
    this.many(properties, name, target, id ? [id] : []);
  }

  many(properties: Properties, name: string, target: MirrorEntity, ids: readonly string[]): void {
    if (!this.relations.mapped(target)) return;
    const out: { id: string }[] = [];
    for (const id of new Set(ids)) {
      const pageId = this.relations.pageId(target, id);
      if (pageId) out.push({ id: pageId });
      else this.missing = true;
      if (out.length >= NOTION_MAX_ARRAY_ITEMS) break;
    }
    properties[name] = { relation: out };
  }
}

function common(row: AnySourceRow): Properties {
  return { [APP_ID_PROPERTY]: textProp(row.id), [UPDATED_PROPERTY]: dateProp(row.updatedAt) };
}

// ── Builders ────────────────────────────────────────────────────────

export function categoryProperties(row: CategorySourceRow): BuiltProperties {
  return {
    properties: { Name: titleProp(row.name), Group: textProp(row.group), ...common(row) },
    missingRelation: false,
  };
}

export function locationProperties(row: LocationSourceRow): BuiltProperties {
  return {
    properties: {
      Name: titleProp(`${row.room} — ${row.zone}`),
      Room: textProp(row.room),
      Zone: textProp(row.zone),
      "Map tag": textProp(row.mapTag),
      ...common(row),
    },
    missingRelation: false,
  };
}

export function toolProperties(row: ToolSourceRow, relations: MirrorRelations): BuiltProperties {
  const sink = new RelationSink(relations);
  const properties: Properties = {
    Name: titleProp(row.name),
    Slug: textProp(row.slug),
    Description: textProp(row.description),
    Materials: multiSelectProp(row.materials),
    "PPE required": multiSelectProp(row.ppeRequired),
    Tags: multiSelectProp(row.tags),
    "Training required": checkboxProp(row.trainingRequired),
    "Use restrictions": textProp(row.useRestrictions),
    "Emergency stop": textProp(row.emergencyStop),
    Notes: textProp(row.notes),
    Published: checkboxProp(row.published),
    Archived: checkboxProp(row.archived),
    Images: filesProp(row.images, "Image"),
    "Last reviewed": dateProp(row.lastReviewedAt),
    ...common(row),
  };
  sink.one(properties, "Category", "categories", row.categoryId);
  sink.one(properties, "Location", "locations", row.locationId);
  return { properties, missingRelation: sink.missing };
}

export function unitProperties(row: UnitSourceRow, relations: MirrorRelations): BuiltProperties {
  const sink = new RelationSink(relations);
  const properties: Properties = {
    Label: titleProp(row.unitLabel),
    "Serial number": textProp(row.serialNumber),
    "Asset tag": textProp(row.assetTag),
    Status: selectProp(row.status),
    Condition: selectProp(row.condition),
    "Date acquired": dateProp(row.dateAcquired),
    Notes: textProp(row.notes),
    ...common(row),
  };
  sink.one(properties, "Tool", "tools", row.toolId);
  return { properties, missingRelation: sink.missing };
}

export function resourceProperties(row: ResourceSourceRow, relations: MirrorRelations): BuiltProperties {
  const sink = new RelationSink(relations);
  const properties: Properties = {
    Title: titleProp(row.title),
    Type: selectProp(row.type),
    URL: urlProp(row.url),
    File: filesProp(row.files, "File"),
    Published: checkboxProp(row.published),
    Notes: textProp(row.notes),
    ...common(row),
  };
  sink.one(properties, "Tool", "tools", row.toolId);
  return { properties, missingRelation: sink.missing };
}

export function maintenanceProperties(row: MaintenanceSourceRow, relations: MirrorRelations): BuiltProperties {
  const sink = new RelationSink(relations);
  const properties: Properties = {
    Title: titleProp(row.title),
    Type: selectProp(row.type),
    Priority: selectProp(row.priority),
    Status: selectProp(row.status),
    Description: textProp(row.description),
    Resolution: textProp(row.resolution),
    "Tool name": textProp(row.toolName),
    "Unit label": textProp(row.unitLabel),
    "Reported by": textProp(row.reportedByName),
    "Reporter email": emailProp(row.reportedByEmail),
    "Assigned to": textProp(row.assignedToName),
    "Assignee email": emailProp(row.assigneeEmail),
    "Date reported": dateProp(row.dateReported),
    "Date resolved": dateProp(row.dateResolved),
    ...common(row),
  };
  sink.one(properties, "Tool", "tools", row.toolId);
  sink.one(properties, "Unit", "units", row.unitId);
  return { properties, missingRelation: sink.missing };
}

export function projectProperties(row: ProjectSourceRow, relations: MirrorRelations): BuiltProperties {
  const sink = new RelationSink(relations);
  const properties: Properties = {
    Title: titleProp(row.title),
    Link: urlProp(row.link),
    Body: textProp(row.body),
    Materials: multiSelectProp(row.materials),
    Author: textProp(row.authorName),
    "Author email": emailProp(row.authorEmail),
    "Published at": dateProp(row.publishedAt),
    Photos: filesProp(row.photos, "Photo"),
    ...common(row),
  };
  sink.many(properties, "Tools", "tools", row.toolIds);
  return { properties, missingRelation: sink.missing };
}

/** The builder for `entity`. */
export function buildMirrorProperties<E extends MirrorEntity>(
  entity: E,
  row: SourceRows[E],
  relations: MirrorRelations
): BuiltProperties {
  switch (entity) {
    case "categories":
      return categoryProperties(row as CategorySourceRow);
    case "locations":
      return locationProperties(row as LocationSourceRow);
    case "tools":
      return toolProperties(row as ToolSourceRow, relations);
    case "units":
      return unitProperties(row as UnitSourceRow, relations);
    case "resources":
      return resourceProperties(row as ResourceSourceRow, relations);
    case "maintenance":
      return maintenanceProperties(row as MaintenanceSourceRow, relations);
    case "projects":
      return projectProperties(row as ProjectSourceRow, relations);
    default:
      return { properties: {}, missingRelation: false };
  }
}

/** Which ids of which target entities `rows` relate to — what the push looks up in `mirror_pages`. */
export function relationTargets<E extends MirrorEntity>(entity: E, rows: readonly SourceRows[E][]): Map<MirrorEntity, Set<string>> {
  const out = new Map<MirrorEntity, Set<string>>();
  const add = (target: MirrorEntity, id: string | null) => {
    if (!id) return;
    let set = out.get(target);
    if (!set) out.set(target, (set = new Set()));
    set.add(id);
  };
  for (const row of rows as readonly AnySourceRow[]) {
    if (entity === "tools") {
      add("categories", (row as ToolSourceRow).categoryId);
      add("locations", (row as ToolSourceRow).locationId);
    } else if (entity === "units" || entity === "resources") {
      add("tools", (row as UnitSourceRow | ResourceSourceRow).toolId);
    } else if (entity === "maintenance") {
      add("tools", (row as MaintenanceSourceRow).toolId);
      add("units", (row as MaintenanceSourceRow).unitId);
    } else if (entity === "projects") {
      for (const id of (row as ProjectSourceRow).toolIds) add("tools", id);
    }
  }
  return out;
}
