/**
 * Run the deterministic background cutout again on one tool's cover (gateway
 * spec amendment "Thin margins and white bezels", 2026-10-07).
 *
 *   npm run images:recut -- --tool <slug or id>                    # dry run: make the cut, describe it
 *   npm run images:recut -- --tool <slug or id> --out cut.png      # …and write it to a local file to look at
 *   npm run images:recut -- --tool <slug or id> --apply            # store it and make it the cover
 *
 * For a cover stored before the cutout learned to cut a thin margin (the
 * "iPad 6th generation" photo kept its white corners because its cut was
 * never kept). The cover's stored bytes are read back and given the cleaning a
 * picked image gets at approval (`src/lib/images/recut-cover.ts`): never a
 * redraw. With `--apply` the cleaned PNG becomes the cover, the old cover is
 * released for the daily orphan sweep, and its thumbnails are rendered.
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first). The
 *   Blob store is `blobMode()`'s: `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID`
 *   with OIDC) for Vercel Blob, else `.blob-data/` locally. For production,
 *   pass the pulled env file: `node --env-file=.env.hosted
 *   --experimental-strip-types scripts/recut-tool-cover.ts --tool … --apply`
 *   (`docs/deploy.md` Part 2 step 6 says how to fill it). Nothing from it is
 *   printed.
 * - No model calls. Afterwards `POST /api/admin/revalidate` (or wait for the
 *   catalogue cache to expire) so pages show the new cover.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { blobMode } from "../src/lib/blob-mode.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { attachments } from "../src/lib/db/schema/index.ts";
import { createThumbnailIO, writeAttachmentThumbnails } from "../src/lib/images/attachment-thumbnails.ts";
import { recutToolCover, type RecutIO, type RecutReport } from "../src/lib/images/recut-cover.ts";
import { createBlobUploader } from "../src/lib/import/blob-uploader.ts";

export interface RecutOptions {
  tool: string;
  apply: boolean;
  out: string | null;
}

export function parseArgs(argv: readonly string[]): RecutOptions {
  let tool: string | null = null;
  let apply = false;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--tool") tool = argv[++i] ?? null;
    else if (arg === "--out") out = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!tool || tool.startsWith("--")) throw new Error("--tool takes the tool's slug or id");
  if (out !== null && (!out || out.startsWith("--"))) throw new Error("--out takes a file path");
  return { tool, apply, out };
}

/** One line per outcome, for the console. */
export function describeReport(report: RecutReport, apply: boolean): string {
  switch (report.status) {
    case "no_tool":
      return "No tool has that slug or id.";
    case "no_cover":
      return `${report.tool.name} (${report.tool.slug}) has no public image to cut.`;
    case "unreadable":
      return `The cover of ${report.tool.slug} (${report.cover.blobPathname}) could not be read or is not an image.`;
    case "not_cut":
      return `The cover of ${report.tool.slug} was not cut${report.note ? `: ${report.note}` : " (already clean)"}. Nothing changed.`;
    case "cut":
      return `The cover of ${report.tool.slug} cuts cleanly (${report.kind}, ${report.width}×${report.height}).${apply ? "" : " Dry run — run again with --apply to make it the cover."}`;
    case "replaced":
      return `The cover of ${report.tool.slug} is now the cut (${report.kind}, ${report.width}×${report.height}), attachment ${report.newAttachmentId}; the old cover ${report.cover.attachmentId} is released for the daily sweep.`;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}; Blob: ${blobMode()}${options.apply ? "" : " — dry run, nothing is written"}`);

  const reader = createThumbnailIO();
  const uploader = options.apply ? createBlobUploader() : null;
  if (!reader) throw new Error("No Blob store to read the cover from (BLOB_READ_WRITE_TOKEN, or run locally without BLOB_LOCAL_DISABLE).");
  if (options.apply && !uploader) throw new Error("No Blob store to write the cut to.");
  const io: RecutIO = {
    read: (row) => reader.read(row),
    upload: (pathname, bytes, contentType) => uploader!.put(pathname, bytes, { access: "public", contentType }),
  };

  let opened;
  try {
    opened = await openImportTarget(target);
  } catch (error) {
    if (error instanceof PgliteLockedError) {
      console.error(`${error.message}\nStop the dev server (it holds the local database), then run this again.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  try {
    const report = await recutToolCover({ db: opened.db, slugOrId: options.tool, apply: options.apply, io });
    console.log(describeReport(report, options.apply));
    if ((report.status === "cut" || report.status === "replaced") && options.out) {
      writeFileSync(options.out, report.bytes);
      console.log(`Wrote the cut to ${options.out}.`);
    }
    if (report.status === "replaced" && report.newAttachmentId) {
      const [stored] = await opened.db
        .select({ id: attachments.id, blobPathname: attachments.blobPathname, publicUrl: attachments.publicUrl })
        .from(attachments)
        .where(eq(attachments.id, report.newAttachmentId));
      const thumbs = stored?.publicUrl
        ? await writeAttachmentThumbnails({ id: stored.id, blobPathname: stored.blobPathname, publicUrl: stored.publicUrl }, { db: opened.db, io: reader }).catch(() => null)
        : null;
      console.log(thumbs ? "Thumbnails rendered." : "Thumbnails were not rendered; `npm run thumbnails:backfill -- --apply` will.");
      console.log("POST /api/admin/revalidate (or wait for the catalogue cache) so pages show the new cover.");
    }
    if (report.status === "no_tool" || report.status === "unreadable") process.exitCode = 1;
  } finally {
    await opened.close();
  }
}

// Only run when invoked directly, so tests can import the pieces.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
