import { eq } from "drizzle-orm";
import {
  attachments,
  categories,
  feedback,
  locations,
  maintenanceLogs,
  projectTools,
  projects,
  resources,
  tools,
  units,
} from "../db/schema/index.ts";
import { slugify, uniqueSlug } from "../db/slug.ts";
import type { Db } from "../db/types.ts";
import type { Attachment } from "../types.ts";
import { isStaleFileUrl, safeFilename, type FileCopier } from "./files.ts";
import {
  toCategoryRow,
  toFeedbackRow,
  toLocationRow,
  toMaintenanceRow,
  toProjectRow,
  toResourceRow,
  toToolRow,
  toUnitRow,
} from "./mappers.ts";
import { PreflightError, preflight, type PreflightWarning } from "./preflight.ts";
import type { NotionSnapshot } from "./source.ts";

/**
 * The import itself (spec §5.7 step 3 onward): a snapshot in, rows out.
 *
 * - **Pre-flight first.** An unmapped Notion option stops the run before a
 *   single row is written.
 * - **Dependency order**, one transaction per entity: categories, locations,
 *   tools, units, resources, maintenance logs, feedback, projects.
 * - **Idempotent.** Every row is keyed by `notion_page_id`; a re-run updates
 *   what exists and inserts what is new, and never changes a slug it already
 *   assigned. Files are keyed by `source_key`, so a re-run never uploads the
 *   same file twice.
 * - **Files last**, outside any transaction, one at a time: a failed download
 *   is a warning and a count, never a rollback of the rows.
 */

export type ImportEntity =
  | "categories"
  | "locations"
  | "tools"
  | "units"
  | "resources"
  | "maintenance_logs"
  | "feedback"
  | "projects";

export interface EntityCount {
  inserted: number;
  updated: number;
}

export interface ImportReport {
  counts: Record<ImportEntity, EntityCount>;
  files: { copied: number; skipped: number; failed: number };
  warnings: string[];
  preflightWarnings: PreflightWarning[];
}

export interface RunImportOptions {
  db: Db;
  snapshot: NotionSnapshot;
  /** Null skips file copying entirely (a dry run). */
  files?: FileCopier | null;
  log?: (line: string) => void;
}

/** Notion page id → row id, per entity, built as the run goes. */
type IdMap = Map<string, string>;

/**
 * A row minus the columns an update must not touch: the slug, assigned once,
 * and `created_at`, which is Notion's creation time and does not move.
 */
function patchOf<T extends object>(row: T, ...keys: (keyof T)[]): Partial<T> {
  const patch: Partial<T> = { ...row };
  for (const key of keys) delete patch[key];
  return patch;
}

export async function runImport(options: RunImportOptions): Promise<ImportReport> {
  const { db, snapshot } = options;
  const files = options.files ?? null;
  const log = options.log ?? (() => {});
  const warnings: string[] = [];

  const flight = preflight(snapshot.schemas);
  if (flight.problems.length > 0) throw new PreflightError(flight.problems);

  const counts = {} as Record<ImportEntity, EntityCount>;
  const count = (entity: ImportEntity, inserted: number, updated: number) => {
    counts[entity] = { inserted, updated };
    log(`${entity}: ${inserted} inserted, ${updated} updated`);
  };

  // ── Categories ────────────────────────────────────────────────────
  const categoryIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: categories.id, name: categories.name, group: categories.group, notionPageId: categories.notionPageId })
        .from(categories);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      const byKey = new Map(existing.map((r) => [categoryKey(r.name, r.group), r.id]));

      for (const record of snapshot.categories) {
        const { row, warnings: w } = toCategoryRow(record);
        warnings.push(...w);
        const key = categoryKey(row.name, row.group ?? null);
        const known = byNotion.get(record.id);
        if (known) {
          await tx.update(categories).set({ name: row.name, group: row.group }).where(eq(categories.id, known));
          categoryIds.set(record.id, known);
          updated += 1;
          continue;
        }
        const duplicate = byKey.get(key);
        if (duplicate) {
          warnings.push(`category "${row.name}" (${row.group ?? "no group"}) appears twice in Notion; ${record.id} merged into the first`);
          categoryIds.set(record.id, duplicate);
          continue;
        }
        const [created] = await tx.insert(categories).values(row).returning({ id: categories.id });
        categoryIds.set(record.id, created.id);
        byKey.set(key, created.id);
        inserted += 1;
      }
    });
    count("categories", inserted, updated);
  }

  // ── Locations ─────────────────────────────────────────────────────
  const locationIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: locations.id, room: locations.room, zone: locations.zone, mapTag: locations.mapTag, notionPageId: locations.notionPageId })
        .from(locations);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      const byKey = new Map(existing.map((r) => [locationKey(r.room, r.zone), r.id]));
      const mapTags = new Map(existing.filter((r) => r.mapTag).map((r) => [r.mapTag as string, r.id]));

      for (const record of snapshot.locations) {
        const { row, warnings: w } = toLocationRow(record);
        warnings.push(...w);
        const key = locationKey(row.room, row.zone);
        const known = byNotion.get(record.id);
        const tagOwner = row.mapTag ? mapTags.get(row.mapTag) : undefined;
        if (row.mapTag && tagOwner && tagOwner !== known) {
          warnings.push(`location map tag "${row.mapTag}" is used twice in Notion; dropped from ${record.id}`);
          row.mapTag = null;
        }
        if (known) {
          await tx.update(locations).set({ room: row.room, zone: row.zone, mapTag: row.mapTag }).where(eq(locations.id, known));
          locationIds.set(record.id, known);
          updated += 1;
          continue;
        }
        const duplicate = byKey.get(key);
        if (duplicate) {
          warnings.push(`location "${row.room} / ${row.zone}" appears twice in Notion; ${record.id} merged into the first`);
          locationIds.set(record.id, duplicate);
          continue;
        }
        const [created] = await tx.insert(locations).values(row).returning({ id: locations.id });
        locationIds.set(record.id, created.id);
        byKey.set(key, created.id);
        if (row.mapTag) mapTags.set(row.mapTag, created.id);
        inserted += 1;
      }
    });
    count("locations", inserted, updated);
  }

  // ── Tools ─────────────────────────────────────────────────────────
  const toolIds: IdMap = new Map();
  const toolNames = new Map(snapshot.tools.map((t) => [t.id, t.fields.name]));
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: tools.id, slug: tools.slug, notionPageId: tools.notionPageId }).from(tools);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      const slugs = new Set(existing.map((r) => r.slug));

      for (const record of snapshot.tools) {
        const known = byNotion.get(record.id);
        const refs = {
          slug: known ? "" : uniqueSlug(slugify(record.fields.name), slugs),
          categoryId: record.fields.category?.[0] ? (categoryIds.get(record.fields.category[0]) ?? null) : null,
          locationId: record.fields.location?.[0] ? (locationIds.get(record.fields.location[0]) ?? null) : null,
        };
        const { row, warnings: w } = toToolRow(record, refs);
        warnings.push(...w);
        if (known) {
          await tx.update(tools).set(patchOf(row, "slug", "createdAt")).where(eq(tools.id, known));
          toolIds.set(record.id, known);
          updated += 1;
        } else {
          const [created] = await tx.insert(tools).values(row).returning({ id: tools.id });
          toolIds.set(record.id, created.id);
          inserted += 1;
        }
      }
    });
    count("tools", inserted, updated);
  }

  // ── Units ─────────────────────────────────────────────────────────
  const unitIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: units.id, toolId: units.toolId, serialNumber: units.serialNumber, notionPageId: units.notionPageId })
        .from(units);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      const serials = new Map(
        existing.filter((r) => r.serialNumber).map((r) => [serialKey(r.toolId, r.serialNumber as string), r.id])
      );

      for (const record of snapshot.units) {
        const toolId = record.fields.tool?.[0] ? (toolIds.get(record.fields.tool[0]) ?? null) : null;
        const { row, warnings: w } = toUnitRow(record, { toolId });
        warnings.push(...w);
        const known = byNotion.get(record.id);
        if (row.serialNumber) {
          const owner = serials.get(serialKey(row.toolId ?? null, row.serialNumber));
          if (owner && owner !== known) {
            warnings.push(`unit "${row.unitLabel}": serial "${row.serialNumber}" is already on another unit of the same tool; dropped`);
            row.serialNumber = null;
          }
        }
        if (known) {
          await tx.update(units).set(patchOf(row, "createdAt")).where(eq(units.id, known));
          unitIds.set(record.id, known);
          updated += 1;
        } else {
          const [created] = await tx.insert(units).values(row).returning({ id: units.id });
          unitIds.set(record.id, created.id);
          if (row.serialNumber) serials.set(serialKey(row.toolId ?? null, row.serialNumber), created.id);
          inserted += 1;
        }
      }
    });
    count("units", inserted, updated);
  }

  // ── Resources ─────────────────────────────────────────────────────
  const resourceIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: resources.id, notionPageId: resources.notionPageId }).from(resources);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      for (const record of snapshot.resources) {
        const toolId = record.fields.tool?.[0] ? (toolIds.get(record.fields.tool[0]) ?? null) : null;
        const { row, warnings: w } = toResourceRow(record, { toolId });
        warnings.push(...w);
        const known = byNotion.get(record.id);
        if (known) {
          await tx.update(resources).set(patchOf(row, "createdAt")).where(eq(resources.id, known));
          resourceIds.set(record.id, known);
          updated += 1;
        } else {
          const [created] = await tx.insert(resources).values(row).returning({ id: resources.id });
          resourceIds.set(record.id, created.id);
          inserted += 1;
        }
      }
    });
    count("resources", inserted, updated);
  }

  // ── Maintenance logs ──────────────────────────────────────────────
  const maintenanceIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    const unitsByNotion = new Map(snapshot.units.map((u) => [u.id, u]));
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: maintenanceLogs.id, notionPageId: maintenanceLogs.notionPageId }).from(maintenanceLogs);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      for (const record of snapshot.maintenanceLogs) {
        const unitNotionId = record.fields.unit?.[0];
        const unit = unitNotionId ? unitsByNotion.get(unitNotionId) : undefined;
        const toolNotionId = unit?.fields.tool?.[0];
        const refs = {
          unitId: unitNotionId ? (unitIds.get(unitNotionId) ?? null) : null,
          toolId: toolNotionId ? (toolIds.get(toolNotionId) ?? null) : null,
          toolName: toolNotionId ? (toolNames.get(toolNotionId) ?? null) : null,
          unitLabel: unit?.fields.unit_label ?? null,
        };
        const { row, warnings: w } = toMaintenanceRow(record, refs);
        warnings.push(...w);
        const known = byNotion.get(record.id);
        if (known) {
          await tx.update(maintenanceLogs).set(patchOf(row, "createdAt")).where(eq(maintenanceLogs.id, known));
          maintenanceIds.set(record.id, known);
          updated += 1;
        } else {
          const [created] = await tx.insert(maintenanceLogs).values(row).returning({ id: maintenanceLogs.id });
          maintenanceIds.set(record.id, created.id);
          inserted += 1;
        }
      }
    });
    count("maintenance_logs", inserted, updated);
  }

  // ── Feedback (Flags) ──────────────────────────────────────────────
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: feedback.id, notionPageId: feedback.notionPageId }).from(feedback);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      for (const record of snapshot.flags) {
        const toolId = record.fields.tool?.[0] ? (toolIds.get(record.fields.tool[0]) ?? null) : null;
        const { row, warnings: w } = toFeedbackRow(record, { toolId });
        warnings.push(...w);
        const known = byNotion.get(record.id);
        if (known) {
          await tx.update(feedback).set(patchOf(row, "createdAt")).where(eq(feedback.id, known));
          updated += 1;
        } else {
          await tx.insert(feedback).values(row);
          inserted += 1;
        }
      }
    });
    count("feedback", inserted, updated);
  }

  // ── Projects ──────────────────────────────────────────────────────
  const projectIds: IdMap = new Map();
  {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: projects.id, slug: projects.slug, notionPageId: projects.notionPageId }).from(projects);
      const byNotion = new Map(existing.filter((r) => r.notionPageId).map((r) => [r.notionPageId as string, r.id]));
      const slugs = new Set(existing.map((r) => r.slug));
      for (const record of snapshot.projects) {
        const known = byNotion.get(record.id);
        const { row, warnings: w } = toProjectRow(record, {
          slug: known ? "" : uniqueSlug(slugify(record.fields.title), slugs),
        });
        warnings.push(...w);
        let id: string;
        if (known) {
          await tx.update(projects).set(patchOf(row, "slug", "createdAt")).where(eq(projects.id, known));
          id = known;
          updated += 1;
        } else {
          const [created] = await tx.insert(projects).values(row).returning({ id: projects.id });
          id = created.id;
          inserted += 1;
        }
        projectIds.set(record.id, id);

        const linked = (record.fields.tools_used ?? [])
          .map((notionId) => toolIds.get(notionId))
          .filter((toolId): toolId is string => Boolean(toolId));
        await tx.delete(projectTools).where(eq(projectTools.projectId, id));
        if (linked.length > 0) {
          await tx.insert(projectTools).values(linked.map((toolId) => ({ projectId: id, toolId })));
        }
      }
    });
    count("projects", inserted, updated);
  }

  // ── Files ─────────────────────────────────────────────────────────
  const fileCounts = { copied: 0, skipped: 0, failed: 0 };
  if (files) {
    const existingKeys = new Set(
      (await db.select({ sourceKey: attachments.sourceKey }).from(attachments))
        .map((r) => r.sourceKey)
        .filter((key): key is string => Boolean(key))
    );

    const copyAll = async (
      ownerType: "tool" | "resource" | "maintenance_log" | "project",
      ownerId: string,
      folder: string,
      access: "public" | "private",
      list: Attachment[] | undefined
    ) => {
      for (const [position, file] of (list ?? []).entries()) {
        if (existingKeys.has(file.id)) {
          fileCounts.skipped += 1;
          continue;
        }
        if (isStaleFileUrl(file.url)) {
          warnings.push(`${ownerType} ${ownerId}: skipped a dead file URL (${file.filename})`);
          fileCounts.skipped += 1;
          continue;
        }
        try {
          const copied = await files.copy(file.url, {
            pathname: `${folder}/${ownerId}/${safeFilename(file.filename)}`,
            access,
          });
          await db.insert(attachments).values({
            ownerType,
            ownerId,
            position,
            blobPathname: copied.blobPathname,
            access,
            publicUrl: copied.publicUrl,
            contentType: copied.contentType,
            sizeBytes: copied.sizeBytes,
            originalFilename: file.filename,
            sourceKey: file.id,
            origin: "import",
          });
          existingKeys.add(file.id);
          fileCounts.copied += 1;
        } catch (error) {
          warnings.push(`${ownerType} ${ownerId}: could not copy ${file.filename}: ${(error as Error).message}`);
          fileCounts.failed += 1;
        }
      }
    };

    for (const record of snapshot.tools) {
      const id = toolIds.get(record.id);
      if (id) await copyAll("tool", id, "tools", "public", record.fields.image_attachments);
    }
    for (const record of snapshot.resources) {
      const id = resourceIds.get(record.id);
      if (id) await copyAll("resource", id, "resources", "public", record.fields.files);
    }
    for (const record of snapshot.maintenanceLogs) {
      const id = maintenanceIds.get(record.id);
      if (id) await copyAll("maintenance_log", id, "maintenance", "private", record.fields.photo_attachments);
    }
    for (const record of snapshot.projects) {
      const id = projectIds.get(record.id);
      if (id) await copyAll("project", id, "projects", "public", record.fields.photos);
    }
    log(`files: ${fileCounts.copied} copied, ${fileCounts.skipped} skipped, ${fileCounts.failed} failed`);
  } else {
    log("files: skipped (no copier)");
  }

  return { counts, files: fileCounts, warnings, preflightWarnings: flight.warnings };
}

function categoryKey(name: string, group: string | null): string {
  return `${name.trim().toLowerCase()}|${(group ?? "").trim().toLowerCase()}`;
}

function locationKey(room: string, zone: string): string {
  return `${room.trim().toLowerCase()}|${zone.trim().toLowerCase()}`;
}

function serialKey(toolId: string | null, serial: string): string {
  return `${toolId ?? ""}|${serial.trim().toLowerCase()}`;
}
