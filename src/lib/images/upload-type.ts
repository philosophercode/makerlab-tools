import { inspectImage } from "./inspect.ts";

/**
 * What an uploaded image really is, read from its bytes — never from the type
 * the browser declared (security fix, 2026-10-05; data platform spec amendment
 * of that date).
 *
 * `POST /api/uploads` used to accept any `image/*` the client named and store
 * the file under that name, so an `image/svg+xml` with a `<script>`, or HTML
 * labelled `image/png`, came back as a public URL on the lab's Blob store. Only
 * raster formats a browser will not run are accepted: JPEG, PNG and WebP
 * (`inspectImage`, which also checks the header is well formed) and GIF. The
 * answer is the type the file is stored and recorded under.
 *
 * Plain Node: relative imports only.
 */
export type UploadImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export function uploadImageType(bytes: Uint8Array): UploadImageType | null {
  const info = inspectImage(bytes);
  if (info) return info.format;
  if (isGif(bytes)) return "image/gif";
  return null;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 10) return false;
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") return false;
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  return width > 0 && height > 0;
}
