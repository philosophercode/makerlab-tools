import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, like, notInArray, or } from "drizzle-orm";
import sharp from "sharp";
import { attachments, projectTools, projects, tools } from "../db/schema/index.ts";
import { uniqueSlug } from "../db/slug.ts";
import type { Db } from "../db/types.ts";
import type { BlobUploader } from "../import/files.ts";
import type { SeedBundle, SeedProject } from "./bundle.ts";

/**
 * Load the projects seed bundle into a database — idempotently.
 *
 * - **Upsert key:** `projects.notion_page_id` = the Notion page the project
 *   came from. A re-run finds the row and updates it; the slug is kept (slugs
 *   never change once published).
 * - **Photos:** each is an `attachments` row whose `source_key` is
 *   `projects-seed:<page id>:<sha256 of the file, 16 hex>`, so an unchanged
 *   file is never uploaded twice and a changed one is. Seed photos no longer in
 *   the bundle are *detached* (owner cleared), which hands the blob to the daily
 *   cron's unowned-file sweep instead of deleting it here.
 * - **Tools:** `project_tools` is replaced with the bundle's links, resolved by
 *   catalogue slug in this database; a slug that is not there is reported and
 *   skipped, never invented.
 * - **Published:** yes — these are the lab's own showcase, curated by the
 *   Director. `published_at` is kept on re-runs.
 *
 * `dryRun` reads everything and writes nothing (no rows, no uploads).
 */

export const SEED_SOURCE_PREFIX = "projects-seed";

export interface SeedOptions {
  db: Db;
  bundle: SeedBundle;
  /** The bundle's `images/` directory. */
  imagesDir: string;
  /** Where photos go; required unless `dryRun`. Always written public. */
  uploader: BlobUploader | null;
  dryRun?: boolean;
  /** The clock, for tests. */
  now?: Date;
}

export interface SeededProjectReport {
  slug: string;
  title: string;
  action: "create" | "update";
  toolsLinked: string[];
  toolsMissing: string[];
  photosUploaded: number;
  photosKept: number;
  photosDetached: number;
}

export interface SeedReport {
  dryRun: boolean;
  projects: SeededProjectReport[];
}

export function photoSourceKey(notionPageId: string, bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `${SEED_SOURCE_PREFIX}:${notionPageId}:${digest}`;
}

/** The markdown stored in `projects.body`: the enriched write-up, then the partner. */
export function projectBody(project: SeedProject): string {
  const partner = project.partnerOrg.url
    ? `[${project.partnerOrg.label}](${project.partnerOrg.url})`
    : project.partnerOrg.label;
  return `${project.description.trim()}\n\n**Partner:** ${partner}`;
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function seedProjects(options: SeedOptions): Promise<SeedReport> {
  const { db, bundle, imagesDir } = options;
  const dryRun = options.dryRun ?? false;
  if (!dryRun && !options.uploader) throw new Error("seedProjects needs a Blob uploader unless it is a dry run.");
  const now = options.now ?? new Date();

  const slugs = [...new Set(bundle.projects.flatMap((p) => p.tools.map((t) => t.slug)))];
  const toolRows = slugs.length
    ? await db.select({ id: tools.id, slug: tools.slug }).from(tools).where(inArray(tools.slug, slugs))
    : [];
  const toolIdBySlug = new Map(toolRows.map((row) => [row.slug, row.id]));

  const report: SeedReport = { dryRun, projects: [] };

  for (const [index, project] of bundle.projects.entries()) {
    const [existing] = await db
      .select({ id: projects.id, slug: projects.slug, publishedAt: projects.publishedAt })
      .from(projects)
      .where(eq(projects.notionPageId, project.notionPageId))
      .limit(1);

    const toolsLinked = project.tools.filter((t) => toolIdBySlug.has(t.slug)).map((t) => t.slug);
    const toolsMissing = project.tools.filter((t) => !toolIdBySlug.has(t.slug)).map((t) => t.slug);

    const photos = project.images.map((image, position) => {
      const bytes = new Uint8Array(readFileSync(join(imagesDir, image.file)));
      return { image, position, bytes, sourceKey: photoSourceKey(project.notionPageId, bytes) };
    });
    const keys = photos.map((p) => p.sourceKey);
    const known = keys.length
      ? await db.select({ id: attachments.id, sourceKey: attachments.sourceKey }).from(attachments).where(inArray(attachments.sourceKey, keys))
      : [];
    const knownByKey = new Map(known.map((row) => [row.sourceKey, row.id]));

    let stale: { id: string }[] = [];
    if (existing) {
      const ownedBySeed = and(
        eq(attachments.ownerType, "project"),
        eq(attachments.ownerId, existing.id),
        like(attachments.sourceKey, `${SEED_SOURCE_PREFIX}:%`)
      );
      stale = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(keys.length ? and(ownedBySeed, notInArray(attachments.sourceKey, keys)) : ownedBySeed);
    }

    const entry: SeededProjectReport = {
      slug: existing?.slug ?? project.slug,
      title: project.title,
      action: existing ? "update" : "create",
      toolsLinked,
      toolsMissing,
      photosUploaded: photos.filter((p) => !knownByKey.has(p.sourceKey)).length,
      photosKept: photos.filter((p) => knownByKey.has(p.sourceKey)).length,
      photosDetached: stale.length,
    };

    if (dryRun) {
      if (!existing) entry.slug = await freeSlug(db, project.slug);
      report.projects.push(entry);
      continue;
    }

    // Uploads first, outside the transaction: a failed upload leaves the
    // database untouched, and a re-run uploads only what is still missing.
    const uploaded = new Map<string, typeof attachments.$inferInsert>();
    for (const photo of photos) {
      if (knownByKey.has(photo.sourceKey)) continue;
      const contentType = contentTypeFor(photo.image.file);
      const meta = await sharp(photo.bytes).metadata();
      const stored = await options.uploader!.put(`uploads/project/${photo.image.file}`, photo.bytes, {
        access: "public",
        contentType,
      });
      uploaded.set(photo.sourceKey, {
        blobPathname: stored.pathname,
        access: "public",
        publicUrl: stored.url,
        contentType,
        sizeBytes: photo.bytes.byteLength,
        width: meta.width ?? null,
        height: meta.height ?? null,
        originalFilename: photo.image.file,
        sourceKey: photo.sourceKey,
        origin: "import",
        sourceUrl: photo.image.source.url,
      });
    }

    await db.transaction(async (tx) => {
      const values = {
        title: project.title,
        body: projectBody(project),
        link: project.link,
        materials: project.materials,
        authorName: project.credit,
        published: true,
      };
      let projectId: string;
      if (existing) {
        projectId = existing.id;
        await tx
          .update(projects)
          .set({ ...values, publishedAt: existing.publishedAt ?? now })
          .where(eq(projects.id, projectId));
      } else {
        entry.slug = await freeSlug(tx, project.slug);
        const [row] = await tx
          .insert(projects)
          .values({
            ...values,
            slug: entry.slug,
            notionPageId: project.notionPageId,
            publishedAt: now,
            // Newest first in the gallery: the bundle's first project is the newest.
            createdAt: new Date(now.getTime() - index * 60_000),
          })
          .returning({ id: projects.id });
        projectId = row.id;
      }

      await tx.delete(projectTools).where(eq(projectTools.projectId, projectId));
      const toolIds = [...new Set(toolsLinked.map((slug) => toolIdBySlug.get(slug)!))];
      if (toolIds.length) await tx.insert(projectTools).values(toolIds.map((toolId) => ({ projectId, toolId })));

      if (stale.length) {
        await tx
          .update(attachments)
          .set({ ownerType: null, ownerId: null })
          .where(inArray(attachments.id, stale.map((row) => row.id)));
      }

      for (const photo of photos) {
        const id = knownByKey.get(photo.sourceKey);
        if (id) {
          await tx
            .update(attachments)
            .set({ ownerType: "project", ownerId: projectId, position: photo.position })
            .where(eq(attachments.id, id));
        } else {
          await tx
            .insert(attachments)
            .values({ ...uploaded.get(photo.sourceKey)!, ownerType: "project", ownerId: projectId, position: photo.position });
        }
      }
    });

    report.projects.push(entry);
  }

  return report;
}

/** `base` if no project has it, else the next free `base-N`. */
async function freeSlug(db: Db, base: string): Promise<string> {
  const rows = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(or(eq(projects.slug, base), like(projects.slug, `${base}-%`)));
  return uniqueSlug(base, new Set(rows.map((row) => row.slug)));
}

/** A readable summary for the console. */
export function formatSeedReport(report: SeedReport): string {
  const lines: string[] = [];
  for (const p of report.projects) {
    lines.push(`${report.dryRun ? "would " : ""}${p.action} ${p.slug} — ${p.title}`);
    lines.push(
      `    photos: ${p.photosUploaded} ${report.dryRun ? "to upload" : "uploaded"}, ${p.photosKept} already stored, ` +
        `${p.photosDetached} ${report.dryRun ? "to detach" : "detached"}` +
        `; tools: ${p.toolsLinked.length ? p.toolsLinked.join(", ") : "none"}`
    );
    if (p.toolsMissing.length) lines.push(`    ! not in this catalogue (skipped): ${p.toolsMissing.join(", ")}`);
  }
  const created = report.projects.filter((p) => p.action === "create").length;
  lines.push(
    `\n${report.projects.length} projects (${created} new, ${report.projects.length - created} updated), ` +
      `${report.projects.reduce((n, p) => n + p.photosUploaded, 0)} photos ${report.dryRun ? "to upload" : "uploaded"}.`
  );
  return lines.join("\n");
}
