import type {
  categories,
  feedback,
  locations,
  maintenanceLogs,
  projects,
  resources,
  tools,
  units,
} from "../db/schema/index.ts";
import {
  FEEDBACK_STATUS,
  FLAG_FIELDS,
  MAINTENANCE_PRIORITY,
  MAINTENANCE_STATUS,
  MAINTENANCE_TYPE,
  UNIT_CONDITION,
  UNIT_STATUS,
} from "../db/schema/vocabulary.ts";
import type {
  CategoryRecord,
  FlagRecord,
  LocationRecord,
  MaintenanceLogRecord,
  ProjectRecord,
  ResourceRecord,
  ToolRecord,
  UnitRecord,
} from "../types.ts";
import { mapOption } from "./vocabulary-map.ts";
import { parseTicketDescription } from "./ticket-description.ts";

/**
 * Notion records → rows (spec §4, §5.7). Pure functions: relations are
 * resolved by the caller and passed in as ids, so these can be tested over
 * fixtures shaped like the real data with no database.
 *
 * Every mapper returns the row plus any warnings — a date it could not read,
 * a relation it could not resolve — because dropping a value silently is the
 * failure mode this whole import is designed against.
 */

export interface Mapped<T> {
  row: T;
  warnings: string[];
}

/** A Notion maintenance record plus the email property the parsers leave out. */
export type MaintenanceImportRecord = MaintenanceLogRecord & { reporterEmail: string | null };
/** A Notion flag record plus its reporter email, read the same way. */
export type FlagImportRecord = FlagRecord & { reporterEmail: string | null };

function nullIfEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/** `2024-09-01` from `2024-09-01` or `2024-09-01T10:00:00.000Z`; null otherwise. */
export function isoDate(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function createdAt(record: { createdTime: string }): Date {
  return new Date(record.createdTime);
}

export function toCategoryRow(record: CategoryRecord): Mapped<typeof categories.$inferInsert> {
  return {
    row: {
      name: record.fields.name.trim() || "Untitled category",
      group: nullIfEmpty(record.fields.group),
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings: record.fields.name.trim() ? [] : [`category ${record.id} has no name`],
  };
}

export function toLocationRow(record: LocationRecord): Mapped<typeof locations.$inferInsert> {
  const warnings: string[] = [];
  const room = record.fields.room.trim();
  const zone = record.fields.zone.trim();
  if (!room || !zone) warnings.push(`location ${record.id} (${record.fields.id}) is missing room or zone`);
  return {
    row: {
      room,
      zone,
      mapTag: nullIfEmpty(record.fields.id),
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export interface ToolRefs {
  slug: string;
  categoryId: string | null;
  locationId: string | null;
}

export function toToolRow(record: ToolRecord, refs: ToolRefs): Mapped<typeof tools.$inferInsert> {
  const f = record.fields;
  const warnings: string[] = [];
  if (f.category?.length && !refs.categoryId) warnings.push(`tool ${f.name}: category ${f.category[0]} not found`);
  if (f.location?.length && !refs.locationId) warnings.push(`tool ${f.name}: location ${f.location[0]} not found`);
  return {
    row: {
      slug: refs.slug,
      name: f.name.trim() || "Untitled tool",
      description: nullIfEmpty(f.description),
      categoryId: refs.categoryId,
      locationId: refs.locationId,
      materials: f.materials ?? [],
      ppeRequired: f.ppe_required ?? [],
      tags: f.tags ?? [],
      trainingRequired: f.training_required ?? false,
      useRestrictions: nullIfEmpty(f.use_restrictions),
      emergencyStop: nullIfEmpty(f.emergency_stop),
      notes: nullIfEmpty(f.notes),
      published: f.published ?? false,
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export function toUnitRow(record: UnitRecord, refs: { toolId: string | null }): Mapped<typeof units.$inferInsert> {
  const f = record.fields;
  const warnings: string[] = [];
  const where = { table: "units" };
  if (f.tool?.length && !refs.toolId) warnings.push(`unit ${f.unit_label}: tool ${f.tool[0]} not found`);
  if (!f.tool?.length) warnings.push(`unit ${f.unit_label} (${record.id}) is not linked to a tool`);
  const dateAcquired = isoDate(f.date_acquired);
  if (f.date_acquired && !dateAcquired) {
    warnings.push(`unit ${f.unit_label}: date_acquired "${f.date_acquired}" is not a date; kept in notes`);
  }
  const notes = [nullIfEmpty(f.notes), f.date_acquired && !dateAcquired ? `Date acquired: ${f.date_acquired}` : null]
    .filter(Boolean)
    .join("\n");
  return {
    row: {
      toolId: refs.toolId,
      unitLabel: f.unit_label.trim() || "Unit",
      serialNumber: nullIfEmpty(f.serial_number),
      assetTag: nullIfEmpty(f.asset_tag),
      status: mapOption(UNIT_STATUS, f.status, { ...where, property: "status" }) ?? "available",
      condition: mapOption(UNIT_CONDITION, f.condition, { ...where, property: "condition" }),
      dateAcquired,
      notes: notes || null,
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export function toResourceRow(
  record: ResourceRecord,
  refs: { toolId: string | null }
): Mapped<typeof resources.$inferInsert> {
  const f = record.fields;
  const warnings: string[] = [];
  if (f.tool?.length && !refs.toolId) warnings.push(`resource ${f.title}: tool ${f.tool[0]} not found`);
  return {
    row: {
      toolId: refs.toolId,
      title: f.title.trim() || "Untitled resource",
      type: nullIfEmpty(f.type),
      url: nullIfEmpty(f.url),
      notes: nullIfEmpty(f.notes),
      published: f.published ?? true,
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export interface MaintenanceRefs {
  unitId: string | null;
  toolId: string | null;
  toolName: string | null;
  unitLabel: string | null;
}

export function toMaintenanceRow(
  record: MaintenanceImportRecord,
  refs: MaintenanceRefs
): Mapped<typeof maintenanceLogs.$inferInsert> {
  const f = record.fields;
  const warnings: string[] = [];
  const where = { table: "maintenance_logs" };
  if (f.unit?.length && !refs.unitId) warnings.push(`ticket "${f.title}": unit ${f.unit[0]} not found`);

  const parsed = parseTicketDescription(f.description);
  if (parsed.templated && !parsed.exact) {
    warnings.push(`ticket "${f.title}": description kept whole (template headings found, but edited around)`);
  }

  const dateReported = isoDate(f.date_reported) ?? isoDate(parsed.dateReported);
  const dateResolved = isoDate(f.date_resolved);
  if (f.date_resolved && !dateResolved) warnings.push(`ticket "${f.title}": date_resolved "${f.date_resolved}" is not a date`);

  return {
    row: {
      title: f.title.trim() || "Untitled issue",
      type: mapOption(MAINTENANCE_TYPE, f.type, { ...where, property: "type" }),
      priority:
        mapOption(MAINTENANCE_PRIORITY, f.priority, { ...where, property: "priority" }) ??
        mapOption(MAINTENANCE_PRIORITY, parsed.priority, { ...where, property: "priority (description)" }),
      status: mapOption(MAINTENANCE_STATUS, f.status, { ...where, property: "status" }) ?? "open",
      description: parsed.description,
      resolution: nullIfEmpty(f.resolution),
      unitId: refs.unitId,
      toolId: refs.toolId,
      toolName: refs.toolName,
      unitLabel: refs.unitLabel,
      reportedByName: nullIfEmpty(f.reported_by) ?? parsed.reportedBy,
      reportedByEmail: nullIfEmpty(record.reporterEmail),
      assignedToName: nullIfEmpty(f.assigned_to),
      dateReported,
      dateResolved,
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export function toFeedbackRow(
  record: FlagImportRecord,
  refs: { toolId: string | null }
): Mapped<typeof feedback.$inferInsert> {
  const f = record.fields;
  const warnings: string[] = [];
  const where = { table: "flags" };
  if (f.tool?.length && !refs.toolId) warnings.push(`correction "${f.title}": tool ${f.tool[0]} not found`);
  const issue = nullIfEmpty(f.issue_description) ?? nullIfEmpty(f.title) ?? "(no description)";
  return {
    row: {
      toolId: refs.toolId,
      fieldFlagged: mapOption(FLAG_FIELDS, f.field_flagged, { ...where, property: "field_flagged" }),
      issueDescription: issue,
      suggestedFix: nullIfEmpty(f.suggested_fix),
      reporterName: nullIfEmpty(f.reporter),
      reporterEmail: nullIfEmpty(record.reporterEmail),
      status: mapOption(FEEDBACK_STATUS, f.status, { ...where, property: "status" }) ?? "new",
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings,
  };
}

export function toProjectRow(record: ProjectRecord, refs: { slug: string }): Mapped<typeof projects.$inferInsert> {
  const f = record.fields;
  return {
    row: {
      slug: refs.slug,
      title: f.title.trim() || "Untitled project",
      body: f.body ?? "",
      link: nullIfEmpty(f.link),
      materials: f.materials ?? [],
      authorName: nullIfEmpty(f.author),
      published: f.published ?? false,
      notionPageId: record.id,
      createdAt: createdAt(record),
    },
    warnings: [],
  };
}
