import { z } from "zod";
import { getBlobStore, isBlobConfigured } from "../blob";
import { localBlobOrigin } from "../blob-local";
import { blobMode } from "../blob-mode";
import { getCatalogTool } from "../catalog";
import { findAttachmentsByIds } from "../data/attachments";
import { getPendingTool, type PendingTool } from "../data/pending-tools";
import { inspectImage } from "../images/inspect";
import { IMAGE_MAX_BYTES } from "../intake/limits";
import { downscaleForRanking } from "../research/images/downscale";
import { researchDisplayName } from "../research/result";
import { guardedFetch } from "../web/guarded-fetch";
import { absoluteImageUrl } from "./catalog";
import type { CapabilityTool, McpContentPart } from "./types";

/**
 * Review reads — **MCP only**, `tools.approve`: what an MCP client needs to
 * audit the catalogue's copy and photos the way an admin does on the review
 * page, without opening it.
 *
 * - `get_intake_item` — one item in the intake queue with its research draft:
 *   the proposed names, description, category, the ranked photo candidates
 *   with the ranking's verdicts (view, banner, background), and the sources.
 * - `view_tool_photo` — a published tool's photo, or one of an intake item's
 *   candidates (or its cleaned copy), as an **image part** a model can look
 *   at, downscaled to the 768 px JPEG the research ranking sees. Only URLs the
 *   app recorded are fetched, through the guarded reader research uses.
 *
 * Both are reads: nothing here changes a tool, an item or a photo.
 */

/** How long one photo may take to download, like an approval's. */
const PHOTO_TIMEOUT_MS = 15_000;

// ── get_intake_item ───────────────────────────────────────────────

const intakeItemInput = z.object({
  id: z.string().describe("The intake item's id, from list_intake_queue"),
});
type IntakeItemInput = z.infer<typeof intakeItemInput>;

interface IntakeCandidate {
  rank: number;
  url: string;
  page_url: string | null;
  width: number;
  height: number;
  view: string | null;
  banner: boolean;
  background: string | null;
  reason: string;
}

export type IntakeItemResult =
  | { found: false; message: string }
  | {
      found: true;
      id: string;
      name: string;
      brand: string | null;
      status: string;
      review_page: string;
      research_error: string | null;
      research: null | {
        display_name: string;
        official_name: string;
        description: string;
        category: { name: string; group: string | null; matched: boolean; proposal: string | null };
        confidence: string;
        specs: { label: string; value: string }[];
        materials: string[];
        ppe: string[];
        tags: string[];
        training_required: boolean | null;
        use_restrictions: string | null;
        resources: { title: string; url: string; type: string }[];
        source_urls: string[];
        photos: {
          candidates: IntakeCandidate[];
          cleaned: null | { kind: string; from_rank: number | null };
          all_rejected: boolean;
          error: string | null;
        };
      };
      uploaded_photos: number;
    };

function researchView(item: PendingTool): Extract<IntakeItemResult, { found: true }>["research"] {
  const research = item.research;
  if (!research) return null;
  const images = research.images ?? null;
  const candidates = images?.candidates ?? [];
  const cleanedFrom = images?.cleaned ? candidates.find((c) => c.url === images.cleaned?.fromUrl) : undefined;
  return {
    display_name: researchDisplayName(research, item.name),
    official_name: research.canonicalName,
    description: research.description,
    category: {
      name: research.category.name,
      group: research.category.group,
      matched: research.category.existingId !== null,
      proposal: research.category.proposal?.name ?? null,
    },
    confidence: research.confidence.level,
    specs: research.specs,
    materials: research.materials,
    ppe: research.ppeRequired,
    tags: research.tags,
    training_required: research.trainingRequired,
    use_restrictions: research.useRestrictions,
    resources: research.resources,
    source_urls: research.sourceUrls,
    photos: {
      candidates: candidates.map((c) => ({
        rank: c.rank,
        url: c.url,
        page_url: c.pageUrl,
        width: c.width,
        height: c.height,
        view: c.view ?? null,
        banner: c.composite === true,
        background: c.background ?? null,
        reason: c.reason,
      })),
      cleaned: images?.cleaned ? { kind: images.cleaned.kind ?? "cut", from_rank: cleanedFrom?.rank ?? null } : null,
      all_rejected: images?.allRejected === true,
      error: research.imageError ?? null,
    },
  };
}

const getIntakeItemTool: CapabilityTool<IntakeItemInput, IntakeItemResult> = {
  name: "get_intake_item",
  description:
    "One item in the intake queue with its research draft: proposed display and official names, description, category (and whether it matched one of the lab's), confidence, specs, materials, PPE, resources, sources, and the ranked photo candidates with the ranking's verdicts (view, banner, background). Staff only. Read-only: items are approved in the app. Look at a candidate with view_tool_photo.",
  inputSchema: intakeItemInput,
  kind: "read",
  mcpOnly: true,
  requiredPermission: "tools.approve",
  async run({ id }) {
    const item = await getPendingTool(id.trim());
    if (!item) return { found: false, message: `Intake item not found: ${id}` };
    return {
      found: true,
      id: item.id,
      name: item.name,
      brand: item.brand,
      status: item.status,
      review_page: `/admin/intake/${item.id}`,
      research_error: item.researchError,
      research: researchView(item),
      uploaded_photos: item.photos.length,
    };
  },
};

// ── view_tool_photo ───────────────────────────────────────────────

const viewPhotoInput = z.object({
  tool: z.string().optional().describe("A published tool's id or slug: its cover photo"),
  intake_item: z.string().optional().describe("An intake item's id: one of its research photos"),
  candidate: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal("cleaned")])
    .optional()
    .describe('With intake_item: the candidate\'s rank (1–3), or "cleaned" for the background-removed copy. Default 1.'),
});
type ViewPhotoInput = z.infer<typeof viewPhotoInput>;

export type ViewPhotoResult =
  | { found: false; message: string }
  | { found: true; subject: string; source_url: string | null; width: number; height: number; image: { data: string; mimeType: string } };

/** The bytes of a URL the app recorded, through the guarded reader; null on any failure. */
async function fetchPhoto(url: string): Promise<Uint8Array | null> {
  const fetched = await guardedFetch(url, {
    signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    maxBytes: IMAGE_MAX_BYTES,
    accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
  });
  return fetched.ok ? fetched.bytes : null;
}

/**
 * A published photo's bytes. In local development a disk-store photo's URL is
 * the dev server's own `/api/dev-blob/…`, which the guarded reader refuses as
 * loopback, so it is read from the store instead; every other URL goes
 * through the guarded reader.
 */
async function readPublishedPhoto(url: string): Promise<Uint8Array | null> {
  const devPrefix = `${localBlobOrigin()}/api/dev-blob/`;
  if (blobMode() === "local" && url.startsWith(devPrefix)) {
    const pathname = url.slice(devPrefix.length).split("/").map(decodeURIComponent).join("/");
    const blob = await getBlobStore().read(pathname, "public");
    return blob ? toBytes(blob.body) : null;
  }
  return fetchPhoto(url);
}

async function toBytes(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array> {
  return body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
}

/** A private cleaned copy's bytes, read from the store; null when it is gone. */
async function readCleaned(item: PendingTool, attachmentId: string): Promise<Uint8Array | null> {
  if (!isBlobConfigured()) return null;
  const [attachment] = await findAttachmentsByIds([attachmentId]);
  if (!attachment || attachment.ownerId !== item.id) return null;
  if (attachment.publicUrl) return readPublishedPhoto(attachment.publicUrl);
  const blob = await getBlobStore().read(attachment.blobPathname, "private");
  return blob ? toBytes(blob.body) : null;
}

async function asImage(
  bytes: Uint8Array | null,
  subject: string,
  sourceUrl: string | null
): Promise<ViewPhotoResult> {
  const info = bytes ? inspectImage(bytes) : null;
  if (!bytes || !info) return { found: false, message: `The photo for ${subject} could not be read.` };
  const small = await downscaleForRanking({ bytes, info });
  if (!small) return { found: false, message: `The photo for ${subject} is too large to send.` };
  return {
    found: true,
    subject,
    source_url: sourceUrl,
    width: info.width,
    height: info.height,
    image: { data: Buffer.from(small.bytes).toString("base64"), mimeType: small.mediaType },
  };
}

const viewToolPhotoTool: CapabilityTool<ViewPhotoInput, ViewPhotoResult> = {
  name: "view_tool_photo",
  description:
    "Look at a photo: a published tool's cover photo (tool), or one of an intake item's research photo candidates (intake_item with candidate 1–3, or \"cleaned\" for the background-removed copy). Answers with the image itself, downscaled to 768 px, so you can judge it: the right object, a plain background, no store banner or text. Staff only. Read-only.",
  inputSchema: viewPhotoInput,
  kind: "read",
  mcpOnly: true,
  requiredPermission: "tools.approve",
  async run({ tool, intake_item, candidate }) {
    if (tool && !intake_item) {
      const found = await getCatalogTool(tool.trim());
      if (!found) return { found: false, message: `Tool not found: ${tool}` };
      const url = absoluteImageUrl(found.imageSrc);
      if (!url) return { found: false, message: `${found.name} has no photo.` };
      return asImage(await readPublishedPhoto(url), found.name, url);
    }
    if (intake_item && !tool) {
      const item = await getPendingTool(intake_item.trim());
      if (!item) return { found: false, message: `Intake item not found: ${intake_item}` };
      const images = item.research?.images ?? null;
      if (candidate === "cleaned") {
        if (!images?.cleaned) return { found: false, message: `${item.name} has no cleaned photo.` };
        return asImage(await readCleaned(item, images.cleaned.attachmentId), `${item.name} (cleaned)`, images.cleaned.fromUrl);
      }
      const rank = candidate ?? 1;
      const picked = images?.candidates.find((c) => c.rank === rank);
      if (!picked) return { found: false, message: `${item.name} has no photo candidate ${rank}.` };
      return asImage(await fetchPhoto(picked.url), `${item.name} (candidate ${rank})`, picked.url);
    }
    return { found: false, message: "Name either a tool or an intake_item." };
  },
  toMcpContent(result): McpContentPart[] {
    if (!result.found) return [{ type: "text", text: JSON.stringify(result, null, 2) }];
    const { image, ...facts } = result;
    return [
      { type: "text", text: JSON.stringify(facts, null, 2) },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ];
  },
};

export const reviewReadTools = [
  getIntakeItemTool as unknown as CapabilityTool<unknown, unknown>,
  viewToolPhotoTool as unknown as CapabilityTool<unknown, unknown>,
];
