import { z } from "zod";
import {
  BACKGROUND_CLASSES,
  IMAGE_CONTENT_TYPES,
  IMAGE_REASON_MAX_CHARS,
  IMAGE_SOURCES,
  IMAGE_VIEWS,
  type BackgroundClass,
  type ImageView,
} from "../research/result.ts";
import type { PhotoSearchStatus } from "../db/schema/vocabulary.ts";

/**
 * **Photo options** — candidate cover pictures for a catalogue tool, found on
 * request and picked by a person (photo options spec 2026-10-29).
 *
 * The shapes the search writes, the editor reads and the assistant is shown.
 * Client-safe and plain Node: no `"server-only"`, relative `.ts` imports.
 */

/** How many pictures one search offers at most. */
export const PHOTO_OPTIONS_MAX = 6;

/** How long a search may go before the editor stops waiting and another may start. */
export const PHOTO_SEARCH_STALE_MS = 10 * 60_000;

/** How often the editor polls a running search. */
export const PHOTO_SEARCH_POLL_MS = 4_000;

/** One picture on offer — its URL and what the ranking said about it. Never bytes. */
export interface PhotoOption {
  /** The image's own URL — what a pick downloads, and the only one it may. */
  url: string;
  /** The page that declared it, for attribution; null when the search gave no page. */
  pageUrl: string | null;
  source: (typeof IMAGE_SOURCES)[number];
  width: number;
  height: number;
  contentType: (typeof IMAGE_CONTENT_TYPES)[number];
  /** The ranking model's one-line reason. Advice, never published. */
  reason: string;
  background?: BackgroundClass;
  composite?: boolean;
  view?: ImageView;
  productBox?: readonly [number, number, number, number];
  /** On the maker's own site, or declared on one of its pages — "Manufacturer" on the tile. */
  manufacturer?: boolean;
}

const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** The stored `options`, read leniently per entry: a malformed one is dropped, never a failed page. */
export const photoOptionSchema = z.object({
  url: z.string().url(),
  pageUrl: z.string().nullable(),
  source: z.enum(IMAGE_SOURCES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  reason: z.string().max(IMAGE_REASON_MAX_CHARS),
  background: z.enum(BACKGROUND_CLASSES).optional(),
  composite: z.boolean().optional(),
  view: z.enum(IMAGE_VIEWS).optional(),
  productBox: box.optional(),
  manufacturer: z.boolean().optional(),
});

export function parsePhotoOptions(value: unknown): PhotoOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = photoOptionSchema.safeParse(entry);
    return parsed.success ? [parsed.data as PhotoOption] : [];
  });
}

/** The latest search for a tool, as the editor and the assistant see it. */
export interface PhotoSearchView {
  id: string;
  status: PhotoSearchStatus;
  /** True while the search is going and not stale — the editor polls while it is. */
  running: boolean;
  note: string | null;
  options: PhotoOption[];
  error: string | null;
  chosenUrl: string | null;
  requestedAt: string;
}

/** True when a `searching` row is still worth waiting for. */
export function photoSearchRunning(row: { status: string; createdAt: Date | string }, now = Date.now()): boolean {
  if (row.status !== "searching") return false;
  const started = typeof row.createdAt === "string" ? Date.parse(row.createdAt) : row.createdAt.getTime();
  return now - started < PHOTO_SEARCH_STALE_MS;
}

/** The host a picture came from, for "From <host>" — the page's when there is one. */
export function photoOptionHost(option: Pick<PhotoOption, "url" | "pageUrl">): string {
  try {
    return new URL(option.pageUrl ?? option.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
