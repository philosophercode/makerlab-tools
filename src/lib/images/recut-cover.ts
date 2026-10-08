import { and, asc, eq, or } from "drizzle-orm";
import { attachments, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "../data/uuid.ts";
import { inspectImage } from "./inspect.ts";
import { cleanPickedImage } from "../research/images/pick-clean.ts";
import type { SharpLoader } from "../research/images/downscale.ts";
import type { CleanedKind, CleanNote } from "../research/result.ts";

/**
 * Run the deterministic cutout again on one catalogue tool's cover (gateway
 * spec amendment "Thin margins and white bezels"). For a cover stored before
 * the cutout learned to cut thin margins — the "iPad 6th generation" photo
 * kept its white corners because its cut was never kept — this makes the
 * cleaned copy now and puts it in the cover's place.
 *
 * - **The cover** is the tool's first image attachment by position (what the
 *   tool page shows). Its stored bytes are read back from the store — not
 *   re-downloaded from the web — and given exactly the cleaning a picked image
 *   gets at approval (`cleanPickedImage`: classified on the spot, cropped and
 *   cut when it can be, never redrawn).
 * - **Dry run by default**: the cut is made and described, nothing is written.
 * - **With `apply`**, a cut that was made is stored public under
 *   `uploads/tool/`, recorded as a `research_image_cleaned` attachment owned by
 *   the tool at the old cover's position, with the old cover's source URL;
 *   the old cover is **released** (no owner) in the same transaction, and the
 *   daily orphan sweep deletes its bytes. A cover that cannot be cut is left
 *   alone and the reason given.
 *
 * Plain Node (relative imports, no `server-only`): `scripts/recut-tool-cover.ts`
 * loads it.
 */

export interface RecutIO {
  /** The cover's stored bytes, or null when they cannot be read. */
  read(row: { blobPathname: string; publicUrl: string }): Promise<Uint8Array | null>;
  /** Store a new public file; the store adds a random suffix. */
  upload(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ pathname: string; url: string }>;
}

export interface RecutCover {
  attachmentId: string;
  blobPathname: string;
  publicUrl: string;
  sourceUrl: string | null;
  position: number;
}

export type RecutReport =
  | { status: "no_tool" }
  | { status: "no_cover"; tool: { id: string; slug: string; name: string } }
  | { status: "unreadable"; tool: { id: string; slug: string; name: string }; cover: RecutCover }
  | { status: "not_cut"; tool: { id: string; slug: string; name: string }; cover: RecutCover; note: CleanNote | null }
  | {
      status: "cut" | "replaced";
      tool: { id: string; slug: string; name: string };
      cover: RecutCover;
      kind: CleanedKind;
      width: number;
      height: number;
      /** The cleaned PNG — written to disk by the script's `--out`. */
      bytes: Uint8Array;
      /** With `apply`: the new cover's attachment id. */
      newAttachmentId?: string;
    };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** The tool by slug or id, and its cover — the first image attachment it owns. */
export async function findToolCover(
  db: Db,
  slugOrId: string
): Promise<{ tool: { id: string; slug: string; name: string }; cover: RecutCover | null } | null> {
  const match = isUuid(slugOrId) ? or(eq(tools.id, slugOrId), eq(tools.slug, slugOrId)) : eq(tools.slug, slugOrId);
  const [tool] = await db.select({ id: tools.id, slug: tools.slug, name: tools.name }).from(tools).where(match).limit(1);
  if (!tool) return null;
  const rows = await db
    .select({
      id: attachments.id,
      blobPathname: attachments.blobPathname,
      publicUrl: attachments.publicUrl,
      contentType: attachments.contentType,
      sourceUrl: attachments.sourceUrl,
      position: attachments.position,
      access: attachments.access,
    })
    .from(attachments)
    .where(and(eq(attachments.ownerType, "tool"), eq(attachments.ownerId, tool.id)))
    .orderBy(asc(attachments.position), asc(attachments.id));
  const row = rows.find(
    (candidate) =>
      candidate.access === "public" &&
      candidate.publicUrl &&
      (candidate.contentType ? IMAGE_TYPES.includes(candidate.contentType) : /\.(?:jpe?g|png|webp|gif)$/i.test(candidate.blobPathname))
  );
  return {
    tool,
    cover: row
      ? { attachmentId: row.id, blobPathname: row.blobPathname, publicUrl: row.publicUrl!, sourceUrl: row.sourceUrl, position: row.position }
      : null,
  };
}

export async function recutToolCover(input: {
  db: Db;
  slugOrId: string;
  apply: boolean;
  io: RecutIO;
  loadSharp?: SharpLoader;
}): Promise<RecutReport> {
  const found = await findToolCover(input.db, input.slugOrId);
  if (!found) return { status: "no_tool" };
  const { tool, cover } = found;
  if (!cover) return { status: "no_cover", tool };

  const bytes = await input.io.read(cover).catch(() => null);
  const info = bytes ? inspectImage(bytes) : null;
  if (!bytes || !info) return { status: "unreadable", tool, cover };

  const picked = await cleanPickedImage({ bytes, info }, {}, { loadSharp: input.loadSharp });
  if (!picked.cleaned) return { status: "not_cut", tool, cover, note: picked.note };
  const made = { tool, cover, kind: picked.cleaned, width: picked.info.width, height: picked.info.height, bytes: picked.bytes };
  if (!input.apply) return { status: "cut", ...made };

  const stem = cover.blobPathname.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") || tool.slug;
  const stored = await input.io.upload(`uploads/tool/${stem}-cutout.png`, picked.bytes, "image/png");
  // Recorded unowned first: if the swap below fails, the orphan sweep collects the file.
  const [created] = await input.db
    .insert(attachments)
    .values({
      blobPathname: stored.pathname,
      access: "public",
      publicUrl: stored.url,
      contentType: "image/png",
      sizeBytes: picked.bytes.byteLength,
      width: picked.info.width,
      height: picked.info.height,
      originalFilename: `${stem}-cutout.png`,
      origin: "research_image_cleaned",
      sourceUrl: cover.sourceUrl ?? cover.publicUrl,
      uploadedBy: null,
    })
    .returning({ id: attachments.id });
  await input.db.transaction(async (tx) => {
    // The cover must still be this tool's — or nothing changes.
    const released = await tx
      .update(attachments)
      .set({ ownerType: null, ownerId: null, position: 0 })
      .where(and(eq(attachments.id, cover.attachmentId), eq(attachments.ownerType, "tool"), eq(attachments.ownerId, tool.id)))
      .returning({ id: attachments.id });
    if (released.length !== 1) throw new Error("The tool's cover changed while the cut was being made; nothing was replaced. Run it again.");
    await tx
      .update(attachments)
      .set({ ownerType: "tool", ownerId: tool.id, position: cover.position })
      .where(eq(attachments.id, created.id));
  });
  return { status: "replaced", ...made, newAttachmentId: created.id };
}
