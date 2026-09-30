import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The projects seed bundle (`data/projects-seed/`): `projects.json` plus the
 * photos it names under `images/`. Written once from the MakerLAB Director's
 * public "Made in MakerLAB" Notion database; `npm run projects:seed` loads it.
 *
 * Imports are relative with `.ts` extensions and no `server-only`, because the
 * script loads this under plain Node type stripping.
 */

const confidence = z.enum(["high", "medium", "low"]);

const imageSchema = z.object({
  file: z.string().regex(/^[a-z0-9-]+\.(jpg|jpeg|png|webp)$/, "image file names are lowercase slugs"),
  alt: z.string().min(1),
  source: z.object({
    notionAttachment: z.string(),
    blockId: z.string(),
    property: z.string(),
    url: z.string().url(),
  }),
});

const toolLinkSchema = z.object({
  slug: z.string().min(1),
  confidence,
  reason: z.string().min(1),
});

const projectSchema = z.object({
  notionPageId: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  credit: z.string().min(1),
  partnerOrg: z.object({ label: z.string(), url: z.string().nullable() }),
  year: z.string().nullable(),
  link: z.string().url().nullable(),
  notionText: z.string(),
  description: z.string().min(1),
  materials: z.array(z.string().min(1)),
  tools: z.array(toolLinkSchema),
  images: z.array(imageSchema),
});

export const seedBundleSchema = z.object({
  source: z.object({ name: z.string(), url: z.string().url() }).passthrough(),
  projects: z.array(projectSchema).min(1),
});

export type SeedBundle = z.infer<typeof seedBundleSchema>;
export type SeedProject = z.infer<typeof projectSchema>;
export type SeedToolLink = z.infer<typeof toolLinkSchema>;

/** Where the committed bundle lives, relative to the repo root. */
export const DEFAULT_BUNDLE_DIR = "data/projects-seed";

/** Read and validate `projects.json`; duplicate page ids or slugs are refused. */
export function loadSeedBundle(dir: string): SeedBundle {
  const raw = JSON.parse(readFileSync(join(dir, "projects.json"), "utf8"));
  const bundle = seedBundleSchema.parse(raw);
  const pages = new Set<string>();
  const slugs = new Set<string>();
  for (const project of bundle.projects) {
    if (pages.has(project.notionPageId)) throw new Error(`Duplicate notionPageId in bundle: ${project.notionPageId}`);
    if (slugs.has(project.slug)) throw new Error(`Duplicate slug in bundle: ${project.slug}`);
    pages.add(project.notionPageId);
    slugs.add(project.slug);
  }
  return bundle;
}
