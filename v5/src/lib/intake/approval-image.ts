import "server-only";

import { getBlobStore, isBlobConfigured, type BlobStore } from "../blob";
import { createAttachment, findAttachmentsByIds } from "../data/attachments";
import type { ApprovalImageChoice, PendingTool } from "../data/pending-tools";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { promoteAttachmentsToPublic } from "../files/promote";
import { inspectImage, type ImageFormat } from "../images/inspect";
import { guardedFetch } from "../web/guarded-fetch";
import { IMAGE_MAX_BYTES } from "./limits";

/**
 * The product image an approval takes, made ready **before** the approval's
 * transaction (gateway spec §5.2 step 2).
 *
 * Research recorded up to three candidate images by URL and, for rank 1, a
 * private background-removed copy. Nothing about the candidates was stored;
 * this is where the one an admin picked becomes a file:
 *
 * - **`original`** — `candidateUrl` must be one research recorded, **exactly**.
 *   Any other URL is `invalid_field` and nothing is fetched: this is the one
 *   place a browser names a URL the server then downloads, and "only what
 *   research recorded" is the whole SSRF rule (§8). The download goes through
 *   the same guarded reader research uses (`web/guarded-fetch.ts`: resolved
 *   addresses checked, redirects re-checked, 8 MB, 15 s), must decode as JPEG,
 *   PNG or WebP, and is stored **public** at a random pathname with its source
 *   URL (`origin` `research_image`), owned by nobody until the transaction
 *   claims it as the cover.
 * - **`cleaned`** — the recorded copy must still be this item's own
 *   `research_image_cleaned` attachment. It is made public with
 *   `promoteAttachmentsToPublic` (`copyToPublic`, then the row repointed).
 * - **`none`**, or no choice at all — nothing.
 *
 * **A file that cannot be had is a warning, not a refusal** (§5.2 step 4). A
 * 404, a body too large or not an image, a store that refuses, or no Blob
 * store at all answers `coverId: null` with `image_not_attached`, and the
 * approval goes ahead without an image. The tool is what the admin approved;
 * the page then says the image is missing, so nobody is told about a photo
 * that is not there (Article 4).
 *
 * **What a refusal after this leaves behind.** The caller checks the cheap
 * refusals first (the item exists, is researched, a low grade has its note),
 * so an approval that is going to be refused downloads nothing. The
 * transaction can still refuse later — a category that vanished, a second
 * approver winning the race — and then a stored original is left **unowned**,
 * exactly like an upload nobody claimed, and the 24-hour orphan sweep deletes
 * it. A promoted cleaned copy stays with the item, public; approving again
 * reuses it, and discarding releases it.
 */

/** How long the chosen original may take to download, like a page read. */
export const APPROVAL_IMAGE_TIMEOUT_MS = 15_000;

/** Where a chosen original is stored — the prefix every tool photo uses. */
const TOOL_PHOTO_PREFIX = "uploads/tool/";

/** What the choice was, for the audit trail. Never a URL. */
export type ApprovalImageKind = ApprovalImageChoice["choice"];

/** The warning an approval answers when the chosen image could not be attached. */
export const IMAGE_NOT_ATTACHED = "image_not_attached" as const;

export type PreparedApprovalImage =
  | {
      ok: true;
      kind: ApprovalImageKind;
      /** The attachment the transaction makes the cover, or null for none. */
      coverId: string | null;
      warning?: typeof IMAGE_NOT_ATTACHED;
    }
  | { ok: false; reason: "invalid_field" };

export interface ApprovalImageOptions {
  /** Who is approving — recorded as the uploader of a stored original. */
  uploadedBy: string;
  db?: Db;
  /**
   * The Blob seam. Omitted: the real store when one is configured. Null: no
   * store, whatever the environment says.
   */
  store?: BlobStore | null;
}

const NO_IMAGE: PreparedApprovalImage = { ok: true, kind: "none", coverId: null };

/**
 * Turn the admin's choice into a cover attachment, or explain why there is
 * none. Never throws for an expected failure; see the module comment.
 */
export async function prepareApprovalImage(
  item: PendingTool,
  choice: ApprovalImageChoice | undefined,
  options: ApprovalImageOptions
): Promise<PreparedApprovalImage> {
  if (!choice || choice.choice === "none") return NO_IMAGE;
  const images = item.research?.images ?? null;

  if (choice.choice === "original") {
    // Exact match against what research recorded, before anything else — an
    // unrecorded URL is refused without a single outbound request.
    const candidate = images?.candidates.find((c) => c.url === choice.candidateUrl);
    if (!candidate) return { ok: false, reason: "invalid_field" };
    const store = resolveStore(options.store);
    if (!store) return notAttached("original");
    return storeOriginal(candidate.url, store, options);
  }

  const cleaned = images?.cleaned ?? null;
  if (!cleaned) return { ok: false, reason: "invalid_field" };
  const store = resolveStore(options.store);
  if (!store) return notAttached("cleaned");
  return publishCleaned(item.id, cleaned.attachmentId, store, options);
}

/**
 * Download a research image an admin accepted and store it **public**, owned by
 * nobody until the caller claims it — the same guarded download, format check
 * and `research_image` origin as an approval's "original" (refresh research
 * spec §3.3: "the approval image path"). The caller has already checked that
 * `url` is one research recorded. Null, with the reason logged by host only,
 * for anything that fails: the caller answers `image_not_attached`.
 */
export async function storeResearchImage(url: string, options: ApprovalImageOptions): Promise<string | null> {
  const store = resolveStore(options.store);
  if (!store) return null;
  const stored = await storeOriginal(url, store, options);
  return stored.ok ? stored.coverId : null;
}

function resolveStore(store: BlobStore | null | undefined): BlobStore | null {
  if (store !== undefined) return store;
  return isBlobConfigured() ? getBlobStore() : null;
}

function notAttached(kind: ApprovalImageKind): PreparedApprovalImage {
  return { ok: true, kind, coverId: null, warning: IMAGE_NOT_ATTACHED };
}

/** Download, check, store public, record. Any failure is `image_not_attached`. */
async function storeOriginal(
  url: string,
  store: BlobStore,
  options: ApprovalImageOptions
): Promise<PreparedApprovalImage> {
  const host = hostOf(url);
  const fetched = await guardedFetch(url, {
    signal: AbortSignal.timeout(APPROVAL_IMAGE_TIMEOUT_MS),
    maxBytes: IMAGE_MAX_BYTES,
    accept: "image/jpeg, image/png, image/webp",
  });
  if (!fetched.ok) {
    // The host only — a path or query can carry anything.
    console.warn(`[approval-image] could not download the chosen image from ${host}: ${fetched.reason}`);
    return notAttached("original");
  }

  const info = inspectImage(fetched.bytes);
  if (!info) {
    console.warn(`[approval-image] the chosen image from ${host} is not a JPEG, PNG or WebP`);
    return notAttached("original");
  }

  const filename = fileNameFor(url, info.format);
  let stored: { pathname: string; url: string };
  try {
    stored = await store.putUpload(
      TOOL_PHOTO_PREFIX,
      new File([fetched.bytes as Uint8Array<ArrayBuffer>], filename, { type: info.format }),
      "public"
    );
  } catch (err) {
    console.error(`[approval-image] could not store the chosen image from ${host}`, err);
    return notAttached("original");
  }

  try {
    const db = options.db ?? (await getDb());
    const { id } = await createAttachment(
      {
        blobPathname: stored.pathname,
        access: "public",
        publicUrl: stored.url,
        contentType: info.format,
        sizeBytes: fetched.bytes.byteLength,
        originalFilename: filename,
        uploadedBy: options.uploadedBy,
        origin: "research_image",
        sourceUrl: url,
        width: info.width,
        height: info.height,
      },
      { db }
    );
    return { ok: true, kind: "original", coverId: id };
  } catch (err) {
    console.error(`[approval-image] could not record the chosen image from ${host}`, err);
    // No row points at the blob, so no sweep ever would: take it back out.
    await store.del([stored.pathname]).catch((cause: unknown) => {
      console.error(`[approval-image] could not delete unrecorded image ${stored.pathname}`, cause);
    });
    return notAttached("original");
  }
}

/** Make the item's own cleaned copy public. Anything else is `image_not_attached`. */
async function publishCleaned(
  pendingId: string,
  attachmentId: string,
  store: BlobStore,
  options: ApprovalImageOptions
): Promise<PreparedApprovalImage> {
  try {
    const db = options.db ?? (await getDb());
    const [row] = await findAttachmentsByIds([attachmentId], { db });
    // The recorded id names a row research wrote; it must still be that row.
    if (
      !row ||
      row.ownerType !== "pending_tool" ||
      row.ownerId !== pendingId ||
      row.origin !== "research_image_cleaned"
    ) {
      return notAttached("cleaned");
    }
    // Promoted by an earlier approval that was then refused: already public.
    if (row.access === "public") return { ok: true, kind: "cleaned", coverId: row.id };

    const promoted = await promoteAttachmentsToPublic([row.id], { db, store });
    if (promoted.promoted !== 1) return notAttached("cleaned");
    return { ok: true, kind: "cleaned", coverId: row.id };
  } catch (err) {
    console.error(`[approval-image] could not publish the cleaned copy ${attachmentId}`, err);
    return notAttached("cleaned");
  }
}

const EXTENSIONS: Record<ImageFormat, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * A readable name for the stored file: the URL's last path segment, without
 * its extension, plus the extension of what the bytes actually are. Cosmetic —
 * the store adds a random suffix and cleans the name again.
 */
function fileNameFor(url: string, format: ImageFormat): string {
  let stem = "product-image";
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    const withoutExtension = last.replace(/\.[a-z0-9]{1,5}$/i, "");
    if (withoutExtension) stem = withoutExtension.slice(0, 48);
  } catch {
    // A malformed escape: keep the default stem.
  }
  return `${stem}.${EXTENSIONS[format]}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}
