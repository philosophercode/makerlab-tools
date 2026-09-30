import type { FileUIPart, UIMessage } from "ai";

/**
 * Photos as the model sees them (intake spec §6.1).
 *
 * The chat uploads each photo to Blob, which is the record, and separately
 * sends a downscaled copy of its bytes on the user message so the model can
 * actually look at it. These helpers shape that copy and keep it from riding
 * along on every later turn.
 */

/** How many photos from earlier turns stay in the model's context. */
export const RECENT_PHOTO_LIMIT = 4;

/** A photo waiting to be sent, as far as the model is concerned. */
export interface VisionPhoto {
  name: string;
  /** Downscaled `data:` URL, or undefined when the browser could not encode it. */
  dataUrl?: string;
}

/** The file parts to send with a message — one per photo the browser encoded. */
export function toVisionFileParts(photos: VisionPhoto[]): FileUIPart[] {
  return photos
    .filter((photo): photo is VisionPhoto & { dataUrl: string } =>
      Boolean(photo.dataUrl)
    )
    .map((photo) => ({
      type: "file",
      mediaType: mediaTypeOf(photo.dataUrl),
      filename: photo.name,
      url: photo.dataUrl,
    }));
}

/**
 * Bound the image bytes a request carries (Article 4: load context lazily).
 *
 * The chat re-sends the whole conversation every turn, so without this every
 * photo ever attached would go to the model again on each message. The latest
 * user message keeps all of its photos — that is the turn asking about them —
 * and earlier turns keep at most `limit` more, newest first, so a follow-up
 * question about a recent photo still works. Text parts, including the upload
 * hint, are never touched.
 */
export function withRecentPhotos<M extends UIMessage>(
  messages: M[],
  limit: number = RECENT_PHOTO_LIMIT
): M[] {
  const latestUser = findLastIndex(messages, (m) => m.role === "user");
  let kept = 0;
  const result = [...messages];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user" || i === latestUser) continue;
    if (!message.parts.some(isImagePart)) continue;

    const parts = [...message.parts].reverse().filter((part) => {
      if (!isImagePart(part)) return true;
      if (kept < limit) {
        kept += 1;
        return true;
      }
      return false;
    });
    result[i] = { ...message, parts: parts.reverse() };
  }

  return result;
}

function isImagePart(part: UIMessage["parts"][number]): boolean {
  return (
    part.type === "file" &&
    typeof (part as FileUIPart).mediaType === "string" &&
    (part as FileUIPart).mediaType.startsWith("image/")
  );
}

/** The media type a `data:` URL declares, defaulting to JPEG. */
function mediaTypeOf(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/);
  return match ? match[1] : "image/jpeg";
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i;
  }
  return -1;
}
