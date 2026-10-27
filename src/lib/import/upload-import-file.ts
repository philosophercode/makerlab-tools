import { upload as blobUpload } from "@vercel/blob/client";
import { IMPORT_DIRECT_UPLOAD_MAX_BYTES } from "./limits.ts";
import { importFileKind } from "./upload-policy.ts";

/**
 * Upload one list to import, from the browser — the import page and the chat
 * both call this, so the two cannot drift (import progress spec 2026-10-27
 * §3.5).
 *
 * - **Up to {@link IMPORT_DIRECT_UPLOAD_MAX_BYTES}** the bytes go through
 *   `POST /api/uploads` (kind `import`), as they always have.
 * - **Above it** the function would never see them (Vercel's 4.5 MB request
 *   body limit), so they go straight to Blob with a token from
 *   `POST /api/uploads/token`, which then records the attachment. Where the
 *   deployment cannot sign a direct upload (501), the bytes are offered to
 *   `POST /api/uploads` anyway: the answer is then the platform's, a 413.
 *
 * The answer keeps the HTTP status and code of whichever route answered, so
 * each caller words a refusal as it did before.
 */

export type ImportUploadResult =
  | { ok: true; attachmentId: string; name: string }
  | { ok: false; status: number; code?: string; error?: string };

export interface ImportUploadDeps {
  fetcher?: typeof fetch;
  /** `@vercel/blob/client`'s `upload`, for tests. */
  upload?: typeof blobUpload;
}

const TOKEN_ROUTE = "/api/uploads/token";

export async function uploadImportFile(file: File, deps: ImportUploadDeps = {}): Promise<ImportUploadResult> {
  const fetcher = deps.fetcher ?? fetch;
  if (file.size > IMPORT_DIRECT_UPLOAD_MAX_BYTES) {
    const direct = await uploadDirect(file, fetcher, deps.upload ?? blobUpload);
    if (direct) return direct;
  }
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "import");
  const res = await fetcher("/api/uploads", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { attachmentId?: string; name?: string; code?: string; error?: string };
  if (res.ok && body.attachmentId) return { ok: true, attachmentId: body.attachmentId, name: body.name || file.name };
  return { ok: false, status: res.status, code: body.code, error: body.error };
}

/** Browser → Blob, then the attachment row; null when this deployment cannot take a direct upload. */
async function uploadDirect(file: File, fetcher: typeof fetch, upload: typeof blobUpload): Promise<ImportUploadResult | null> {
  const folder = await postJson(fetcher, { type: "import.folder" });
  if (folder.status === 501) return null;
  if (!folder.ok || typeof folder.body.prefix !== "string") return { ok: false, status: folder.status, code: codeOf(folder.body) };

  const type = file.type || (importFileKind("", file.name) === "pdf" ? "application/pdf" : "text/plain");
  let pathname: string;
  try {
    const stored = await upload(`${folder.body.prefix}${safeName(file.name)}`, file, {
      access: "private",
      handleUploadUrl: TOKEN_ROUTE,
      clientPayload: JSON.stringify({ name: file.name, type, size: file.size }),
      contentType: type,
      multipart: true,
    });
    pathname = stored.pathname;
  } catch (err) {
    // The token route's refusals arrive as the SDK's error; its words are ours.
    const message = err instanceof Error ? err.message : "";
    if (/too large/i.test(message)) return { ok: false, status: 400, code: "file_too_large" };
    if (/import a csv/i.test(message)) return { ok: false, status: 400, code: "unsupported_file" };
    return { ok: false, status: 502, code: "failed" };
  }

  const done = await postJson(fetcher, { type: "import.complete", pathname, name: file.name });
  if (done.ok && typeof done.body.attachmentId === "string") {
    return { ok: true, attachmentId: done.body.attachmentId, name: file.name };
  }
  return { ok: false, status: done.status, code: codeOf(done.body) };
}

async function postJson(fetcher: typeof fetch, payload: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetcher(TOKEN_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

function codeOf(body: Record<string, unknown>): string | undefined {
  return typeof body.code === "string" ? body.code : undefined;
}

/** A file name safe as the last segment of a pathname; the store adds a random suffix. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "-").replace(/^\.+/, "");
  return cleaned.slice(-120) || "list.txt";
}
