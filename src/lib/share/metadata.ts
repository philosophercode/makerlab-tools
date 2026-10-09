import type { Metadata } from "next";
import { siteConfig } from "../site-config";

/**
 * Shared pieces of the link-preview metadata (Open Graph, X cards).
 *
 * In English, like every page's metadata here: a preview is read before
 * anybody picks a language, and metadata is resolved outside the locale.
 *
 * **A page that sets `openGraph` replaces the root's whole object** — Next
 * merges metadata one top-level key at a time — so such a page spreads
 * `baseOpenGraph()` to keep the site name, type and locale, and names its own
 * image (the root's generated card is not inherited either).
 */

/** The generated site card (`app/opengraph-image.tsx`), 1200×630. */
export const SITE_SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${siteConfig.name} — ${siteConfig.tagline}`,
} as const;

/** What a preview shows in place of a page's own description. */
export const SITE_DESCRIPTION = `${siteConfig.tagline}: the ${siteConfig.institution} MakerLAB's tools, manuals and ${siteConfig.chatAssistantName}.`;

/** How long a preview's description may be before it is cut (Google and most cards show ~160). */
export const SHARE_DESCRIPTION_MAX = 160;

/** The width a shared photo is served at: over WhatsApp's 300 px minimum, well under its ~600 KB ceiling. */
export const SHARE_IMAGE_WIDTH = 640;

export function baseOpenGraph(): NonNullable<Metadata["openGraph"]> {
  return { siteName: siteConfig.name, type: "website", locale: "en_US" };
}

/**
 * One line for a preview: Markdown dropped, whitespace collapsed, cut at a
 * word boundary to at most `max` characters with an ellipsis. Empty in, empty out.
 */
export function shareDescription(text: string | null | undefined, max = SHARE_DESCRIPTION_MAX): string {
  const plain = (text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // headings, quotes, list markers
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const room = plain.slice(0, max - 1);
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * The address a crawler fetches for a photo, or null when the photo must not
 * be shared.
 *
 * Only the catalogue's own public files qualify: a bundled `/tool-images/…` or
 * `/sample-projects/…` photo, or a file in the **public** Blob store. Anything
 * else — the private store, a legacy Notion/S3/Airtable link, a local
 * `/api/dev-blob/…` one — is refused, and the caller falls back to the site
 * card.
 *
 * The photo goes through the image optimizer at `SHARE_IMAGE_WIDTH` rather
 * than as the original (1–2.5 MB PNGs, over WhatsApp's limit) or the
 * pre-rendered thumbnail (AVIF/WebP only): the optimizer answers each crawler
 * in a format its `Accept` header names, so one that asks for nothing in
 * particular gets the PNG or JPEG it can show.
 */
export function shareImageUrl(src: string | null | undefined): string | null {
  const value = (src ?? "").trim();
  if (!value || !isShareablePhoto(value)) return null;
  return `/_next/image?url=${encodeURIComponent(value)}&w=${SHARE_IMAGE_WIDTH}&q=75`;
}

function isShareablePhoto(src: string): boolean {
  if (src.startsWith("/")) {
    return !src.startsWith("//") && /^\/(tool-images|sample-projects)\//.test(src);
  }
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** A photo's size once served at `SHARE_IMAGE_WIDTH` (never enlarged), when its source size is known. */
export function sharedImageSize(source: { width: number; height: number } | null | undefined): { width: number; height: number } | null {
  if (!source || source.width <= 0 || source.height <= 0) return null;
  const width = Math.min(SHARE_IMAGE_WIDTH, source.width);
  return { width, height: Math.round((source.height * width) / source.width) };
}

/**
 * Open Graph and X card metadata for one record's page: its own title,
 * description and photo, or the site card when it has no shareable photo.
 */
export function recordShareMetadata(input: {
  title: string;
  description: string;
  path: string;
  photo: string | null | undefined;
  photoSize?: { width: number; height: number } | null;
  photoAlt: string;
}): Metadata {
  const photoUrl = shareImageUrl(input.photo);
  const size = photoUrl ? sharedImageSize(input.photoSize) : null;
  const image = photoUrl
    ? { url: photoUrl, alt: input.photoAlt, ...(size ?? {}) }
    : { ...SITE_SHARE_IMAGE };
  return {
    title: input.title,
    description: input.description,
    openGraph: {
      ...baseOpenGraph(),
      title: input.title,
      description: input.description,
      url: input.path,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image.url],
    },
  };
}
