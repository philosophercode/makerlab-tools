import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { slugify } from "../db/slug.ts";
import type { SharpLoader } from "../research/images/downscale.ts";
import { THUMBNAIL_FORMATS, thumbnailUrl, type ImageThumbnails } from "./thumbnail-urls.ts";
import { renderThumbnails, thumbnailHash } from "./thumbnails.ts";

/**
 * Thumbnails for the photos bundled under `public/tool-images/` —
 * `npm run thumbnails:bundled` (`scripts/generate-tool-thumbnails.ts`).
 *
 * For each `<name>.png` it writes `public/tool-images/thumbs/<slug>.<hash>.<width>.<format>`
 * (`thumbnail-urls.ts`) and records the set in
 * `src/lib/data/bundled-tool-thumbnails.ts`, keyed by the file name (the key
 * `BUNDLED_TOOL_IMAGES` uses), which `toolThumbnails` reads.
 *
 * - **Content-hashed.** The hash is of the PNG's bytes and the encoder
 *   version, so replacing a photo gives it new thumbnail URLs and the old ones
 *   can be cached forever (`next.config.ts` serves the folder `immutable`).
 * - **Incremental.** A photo the manifest already records under its current
 *   hash, with every file present, is not re-encoded.
 * - **Never deletes.** Thumbnails nobody's manifest names any more (a replaced
 *   or removed photo) are reported as stale for somebody to remove.
 * - `check: true` writes nothing and reports whether the manifest and folder
 *   match the photos — what a test or CI step runs.
 */

export interface BundledThumbnailOptions {
  /** `public/tool-images`. */
  sourceDir: string;
  /** `public/tool-images/thumbs`. */
  outDir: string;
  /** The URL path `outDir` is served at: `/tool-images/thumbs`. */
  urlPrefix: string;
  /** `src/lib/data/bundled-tool-thumbnails.ts`. */
  manifestPath: string;
  check?: boolean;
  loadSharp?: SharpLoader;
  log?: (line: string) => void;
}

export interface BundledThumbnailReport {
  photos: number;
  /** Photos whose thumbnails were written (or, with `check`, would be). */
  rendered: string[];
  /** Photos `sharp` could not read. */
  failed: string[];
  /** Files under `outDir` the new manifest does not name. */
  stale: string[];
  /** With `check`: true when nothing would change. */
  upToDate: boolean;
}

export async function generateBundledThumbnails(options: BundledThumbnailOptions): Promise<BundledThumbnailReport> {
  const log = options.log ?? (() => {});
  const files = (await readdir(options.sourceDir)).filter((file) => file.endsWith(".png")).sort();
  const manifest: Record<string, ImageThumbnails> = {};
  const rendered: string[] = [];
  const failed: string[] = [];

  if (!options.check) await mkdir(options.outDir, { recursive: true });
  const recorded = await readManifest(options.manifestPath);

  for (const file of files) {
    const name = file.slice(0, -".png".length);
    const bytes = new Uint8Array(await readFile(join(options.sourceDir, file)));
    const stem = `${slugify(name) || "photo"}.${thumbnailHash(bytes)}`;
    const base = `${options.urlPrefix}/${stem}`;
    const previous = recorded[name];
    if (previous && previous.base === base && allFilesExist(options, stem, previous.widths)) {
      manifest[name] = previous;
      continue;
    }
    rendered.push(name);
    if (options.check) continue;

    const out = await renderThumbnails(bytes, { loadSharp: options.loadSharp });
    if (!out) {
      rendered.pop();
      failed.push(name);
      log(`could not render ${file}`);
      continue;
    }
    for (const r of out.renditions) {
      await writeFile(join(options.outDir, `${stem}.${r.width}.${r.format}`), r.bytes);
    }
    manifest[name] = { base, widths: out.widths, width: out.width, height: out.height };
    log(`rendered ${file} → ${stem} (${out.widths.join(", ")})`);
  }

  const expected = new Set(
    Object.values(manifest).flatMap((t) => {
      const stem = t.base.slice(options.urlPrefix.length + 1);
      return t.widths.flatMap((w) => THUMBNAIL_FORMATS.map((f) => thumbnailUrl({ ...t, base: stem }, w, f)));
    })
  );
  const onDisk = existsSync(options.outDir) ? await readdir(options.outDir) : [];
  const stale = onDisk.filter((file) => !expected.has(file)).sort();

  const source = manifestSource(manifest);
  let upToDate = rendered.length === 0 && failed.length === 0;
  if (options.check) {
    const current = existsSync(options.manifestPath) ? await readFile(options.manifestPath, "utf8") : "";
    upToDate = upToDate && current === source;
  } else {
    await writeFile(options.manifestPath, source);
  }
  return { photos: files.length, rendered, failed, stale, upToDate };
}

function allFilesExist(options: BundledThumbnailOptions, stem: string, widths: number[]): boolean {
  return widths.every((w) => THUMBNAIL_FORMATS.every((f) => existsSync(join(options.outDir, `${stem}.${w}.${f}`))));
}

/** The manifest the last run wrote, read back without importing it (the check runs before a build). */
async function readManifest(path: string): Promise<Record<string, ImageThumbnails>> {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  const start = text.indexOf("{", text.indexOf("BUNDLED_TOOL_THUMBNAILS"));
  const end = text.lastIndexOf("}");
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, ImageThumbnails>;
  } catch {
    return {};
  }
}

/** The generated module: one JSON object, so `readManifest` can parse it back. */
export function manifestSource(manifest: Record<string, ImageThumbnails>): string {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `// Generated by \`npm run thumbnails:bundled\` (src/lib/images/bundled-thumbnails.ts). Do not edit.
//
// The thumbnails of each photo in public/tool-images/, keyed by its file name
// (as BUNDLED_TOOL_IMAGES). Re-run the script whenever a photo is added,
// replaced or removed; \`bundled-tool-thumbnails.test.ts\` fails until you do.
//
// Plain data, no imports beyond a type: scripts/ load the catalogue under plain Node.
import type { ImageThumbnails } from "../images/thumbnail-urls.ts";

export const BUNDLED_TOOL_THUMBNAILS: Readonly<Record<string, ImageThumbnails>> = {
${Object.entries(sorted)
    .map(([name, t]) => `  ${JSON.stringify(name)}: ${JSON.stringify({ base: t.base, widths: t.widths, width: t.width, height: t.height })},`)
    .join("\n")
    .replace(/,$/, "")}
};
`;
}
