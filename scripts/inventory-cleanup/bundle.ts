/**
 * The reviewed data bundle the inventory cleanup applies
 * (`data/inventory-cleanup-2026-09-28/`): what each JSON file holds, read and
 * checked in one place so the apply step can trust its shape.
 *
 * Every entry names its tool by **slug** (slugs never change — data platform
 * spec §4.4), a unit by its tool's slug and current label, a resource by its
 * tool's slug and current URL. The ids in the files are the local snapshot's,
 * kept for the reviewer; the hosted database is matched by slug, so the same
 * bundle applies to both.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_BUNDLE_DIR = fileURLToPath(new URL("../../data/inventory-cleanup-2026-09-28/", import.meta.url));

const toolRename = z.object({
  slug: z.string().min(1),
  /** The display name the snapshot had; the rename applies only while it is still this. */
  from: z.string().min(1),
  to: z.string().min(1),
  /** Written only when the tool's official name is empty. */
  officialName: z.string().min(1).optional(),
  reason: z.string(),
});

const unitRelabel = z.object({
  toolSlug: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string(),
});

const tagEdit = z.object({
  slug: z.string().min(1),
  remove: z.array(z.string()),
  add: z.array(z.string()),
  reason: z.string(),
});

const starterQuestions = z.object({
  slug: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1).max(3),
  kinds: z.array(z.string()).optional(),
});

const manual = z.object({
  slug: z.string().min(1),
  status: z.enum(["found", "none_expected", "not_found"]),
  url: z.string().url().nullable(),
  title: z.string().nullable(),
  source: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  bytes: z.number().int().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * A manual added beside any the tool has (`manuals-add.json`, bundles from
 * 2026-09-28-bambu-ams on): the `manuals` list above adds one only to a tool
 * with none. Matched by URL, so a second run is `already`.
 */
const manualAdd = z.object({
  slug: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  source: z.string(),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  note: z.string().optional(),
});

/**
 * A resource renamed (and optionally retyped), found by its tool's slug and
 * its current URL, only while its title is still `from`
 * (`resources-retitle.json`).
 */
const resourceRetitle = z.object({
  toolSlug: z.string().min(1),
  url: z.string().url(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1).optional(),
  reason: z.string(),
});

const urlClean = z.object({
  toolSlug: z.string().min(1),
  title: z.string(),
  from: z.string().min(1),
  to: z.string().min(1),
});

export type ToolRename = z.infer<typeof toolRename>;
export type UnitRelabel = z.infer<typeof unitRelabel>;
export type TagEdit = z.infer<typeof tagEdit>;
export type StarterQuestionsEntry = z.infer<typeof starterQuestions>;
export type ManualEntry = z.infer<typeof manual>;
export type UrlClean = z.infer<typeof urlClean>;
export type ManualAdd = z.infer<typeof manualAdd>;
export type ResourceRetitle = z.infer<typeof resourceRetitle>;

export interface CleanupBundle {
  renames: { tools: ToolRename[]; units: UnitRelabel[] };
  tags: TagEdit[];
  starterQuestions: StarterQuestionsEntry[];
  manuals: ManualEntry[];
  urls: UrlClean[];
  manualsAdd: ManualAdd[];
  retitles: ResourceRetitle[];
}

export const bundleSchema = z.object({
  renames: z.object({ tools: z.array(toolRename), units: z.array(unitRelabel) }),
  tags: z.array(tagEdit),
  starterQuestions: z.array(starterQuestions),
  manuals: z.array(manual),
  urls: z.array(urlClean),
  manualsAdd: z.array(manualAdd),
  retitles: z.array(resourceRetitle),
});

/**
 * A file of the bundle, parsed. A later, smaller bundle holds only the files
 * it needs, so a missing file is `empty` — an empty list, or no renames.
 */
function readJson(dir: string, file: string, empty: unknown): unknown {
  const path = join(dir, file);
  if (!existsSync(path)) return empty;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The bundle in `dir`, checked; throws naming the file and field that is wrong. */
export function loadBundle(dir: string = DEFAULT_BUNDLE_DIR): CleanupBundle {
  if (!existsSync(dir)) throw new Error(`No bundle at ${dir}`);
  return bundleSchema.parse({
    renames: readJson(dir, "renames.json", { tools: [], units: [] }),
    tags: readJson(dir, "tags-remove.json", []),
    starterQuestions: readJson(dir, "starter-questions.json", []),
    manuals: readJson(dir, "manuals.json", []),
    urls: readJson(dir, "urls-clean.json", []),
    manualsAdd: readJson(dir, "manuals-add.json", []),
    retitles: readJson(dir, "resources-retitle.json", []),
  });
}
