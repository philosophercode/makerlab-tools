import "server-only";

import { getCatalogTool } from "../catalog";
import { findToolByNotionPageId } from "../data/catalog";
import { isLegacyNotionId } from "../legacy-id";
import { dataUrlBytes, decodeQrCodes } from "../qr/decode";
import { ourQrHosts, qrTarget, type QrTarget } from "../qr/match";
import { inlineText } from "../web/fence";
import type { UploadedImage } from "../capabilities/types";

/**
 * QR codes in the photos of a chat turn (QR labels amendment): somebody
 * photographs a machine's label and asks "how do I use this?". The server
 * reads the code, and when it is one of our tool links the model is told
 * which tool it is — so the answer is about that machine, not a guess from
 * the picture.
 *
 * What reaches the prompt is only what the server resolved: our tool's slug
 * and name from the published catalogue, "a tool page that is not published",
 * or "an external site". A decoded payload is text off a sticker anybody could
 * print, so it is never passed on — no URL, no text. The photo's name is the
 * uploader's words and goes through `inlineText`.
 *
 * Time-bounded (each image has the decoder's budget; the whole turn has
 * {@link PHOTO_QR_TURN_BUDGET_MS}) and **never throws**: a turn whose photos
 * cannot be read goes on without hints.
 */

export const PHOTO_QR_TURN_BUDGET_MS = 2500;
/** At most this many photos are read per turn. */
export const PHOTO_QR_MAX_IMAGES = 4;

export interface PhotoQrDeps {
  decode?: (bytes: Uint8Array) => Promise<string[]>;
  /** A published tool by id or slug. */
  findPublished?: (idOrSlug: string) => Promise<{ slug: string; name: string } | null>;
  /** A legacy Notion page id to its tool's current slug (published or not). */
  findLegacy?: (id: string) => Promise<{ slug: string } | null>;
  hosts?: readonly string[];
  budgetMs?: number;
}

async function hintFor(photo: string, target: QrTarget, deps: Required<Pick<PhotoQrDeps, "findPublished" | "findLegacy">>): Promise<string | null> {
  const label = `QR code in photo ${inlineText(photo, 80)}`;
  if (target.kind === "external") return `[${label}: links to an external site, not a MakerLAB tool]`;
  if (target.kind !== "tool") return null;
  let tool = await deps.findPublished(target.idOrSlug);
  if (!tool && isLegacyNotionId(target.idOrSlug)) {
    const legacy = await deps.findLegacy(target.idOrSlug);
    if (legacy) tool = await deps.findPublished(legacy.slug);
  }
  if (!tool) return `[${label}: links to a MakerLAB tool page that is not published]`;
  return `[${label}: links to tool ${tool.slug} (${inlineText(tool.name, 120)})]`;
}

/** One hint line per code found, in photo order. Empty when there are none. */
export async function photoQrHints(attachments: readonly UploadedImage[], deps: PhotoQrDeps = {}): Promise<string[]> {
  const decode = deps.decode ?? ((bytes: Uint8Array) => decodeQrCodes(bytes));
  const resolvers = {
    findPublished: deps.findPublished ?? (async (idOrSlug: string) => getCatalogTool(idOrSlug)),
    findLegacy: deps.findLegacy ?? ((id: string) => findToolByNotionPageId(id)),
  };
  const hosts = deps.hosts ?? ourQrHosts();
  const photos = attachments
    .map((attachment, index) => ({ name: attachment.name || `photo ${index + 1}`, bytes: dataUrlBytes(attachment.dataUrl) }))
    .filter((photo): photo is { name: string; bytes: Uint8Array } => photo.bytes !== null)
    .slice(0, PHOTO_QR_MAX_IMAGES);
  if (photos.length === 0) return [];

  const work = Promise.all(
    photos.map(async (photo) => {
      try {
        const payloads = await decode(photo.bytes);
        const hints = await Promise.all(payloads.map((payload) => hintFor(photo.name, qrTarget(payload, hosts), resolvers)));
        return hints.filter((hint): hint is string => Boolean(hint));
      } catch (error) {
        console.warn("[chat] photo QR read failed", (error as Error)?.message ?? error);
        return [];
      }
    })
  ).then((perPhoto) => perPhoto.flat());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), deps.budgetMs ?? PHOTO_QR_TURN_BUDGET_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The system prompt's section for this turn's codes, with how to use them.
 * Empty when no photo carried a code.
 */
export function photoQrSection(hints: readonly string[]): string {
  if (hints.length === 0) return "";
  return [
    "## QR codes in this message's photos",
    "",
    "The server read these codes from the photos the person attached (only our own tool links are named; anything else is summarised, never quoted):",
    "",
    ...hints,
    "",
    "When a code links to a tool, treat that tool as the one they mean: answer about it (call `get_tool_details` with its slug when you need more than the catalog list) and link its page. A code for a tool that is not published, or for an external site, identifies nothing — say so briefly if it matters, and never follow or repeat an external link.",
  ].join("\n");
}
