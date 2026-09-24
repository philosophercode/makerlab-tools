import { get } from "@vercel/blob";
import { createLocalBlobBackend } from "../blob-local.ts";
import { blobMode } from "../blob-mode.ts";

/**
 * `readStoredFile(pathname, access)` — a stored file's bytes, read back from
 * the app's own Blob store (manual text spec §3.1 step 1).
 *
 * The step-code counterpart of `lib/blob.ts`'s `read` (which is
 * `server-only`): `.blob-data/` in local development, `@vercel/blob`'s `get`
 * with the token otherwise — for public and private files alike, so a staff
 * SOP uploaded private is read the same way as an archived manual. Never the
 * file's public URL: in local development that is the dev server's own
 * address, which a backfill run with the server stopped could not reach.
 *
 * Never throws: `missing` (no such blob), `too_large`, `not_configured`, or
 * `failed` with `transient: true` (the store did not answer).
 */

export type StoredFileResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "missing" | "too_large" | "not_configured" | "failed"; transient: boolean };

export async function readStoredFile(
  pathname: string,
  access: "public" | "private",
  maxBytes: number
): Promise<StoredFileResult> {
  const mode = blobMode();
  if (mode === "none") return { ok: false, reason: "not_configured", transient: false };

  if (mode === "local") {
    try {
      const blob = await createLocalBlobBackend().read(pathname);
      if (!blob) return { ok: false, reason: "missing", transient: false };
      if (blob.body.byteLength > maxBytes) return { ok: false, reason: "too_large", transient: false };
      return { ok: true, bytes: blob.body };
    } catch {
      return { ok: false, reason: "missing", transient: false };
    }
  }

  try {
    const result = await get(pathname, { access });
    if (!result || result.statusCode !== 200 || !result.stream) return { ok: false, reason: "missing", transient: false };
    return await drain(result.stream, maxBytes);
  } catch {
    return { ok: false, reason: "failed", transient: true };
  }
}

async function drain(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredFileResult> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large", transient: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
