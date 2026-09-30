/**
 * Thumbnails for the bundled tool photos (`public/tool-images/*.png`).
 *
 *   npm run thumbnails:bundled            # write missing thumbnails + the manifest
 *   npm run thumbnails:bundled -- --check # write nothing; exit 1 when out of date
 *
 * Re-run whenever a PNG in `public/tool-images/` is added, replaced or
 * removed, and commit `public/tool-images/thumbs/` and
 * `src/lib/data/bundled-tool-thumbnails.ts` with it. Logic and rules:
 * `src/lib/images/bundled-thumbnails.ts`. Stale thumbnails are listed, never
 * deleted.
 */
import { join } from "node:path";
import { generateBundledThumbnails } from "../src/lib/images/bundled-thumbnails.ts";

const check = process.argv.includes("--check");
const root = process.cwd();

const report = await generateBundledThumbnails({
  sourceDir: join(root, "public/tool-images"),
  outDir: join(root, "public/tool-images/thumbs"),
  urlPrefix: "/tool-images/thumbs",
  manifestPath: join(root, "src/lib/data/bundled-tool-thumbnails.ts"),
  check,
  log: (line) => console.log(line),
});

console.log(
  `${report.photos} photos: ${report.rendered.length} ${check ? "out of date" : "rendered"}, ${report.failed.length} failed, ${report.stale.length} stale thumbnail files`
);
for (const name of report.rendered) if (check) console.log(`  out of date: ${name}`);
for (const name of report.failed) console.log(`  failed: ${name}`);
if (report.stale.length > 0) {
  console.log("Stale (no photo names them any more; safe to remove from public/tool-images/thumbs/):");
  for (const file of report.stale) console.log(`  ${file}`);
}
if (report.failed.length > 0 || (check && !report.upToDate)) process.exit(1);
