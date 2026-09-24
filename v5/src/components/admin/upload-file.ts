/**
 * Uploading one file from the tool editor (spec §3.3, §4.7).
 *
 * `POST /api/uploads` is the app's one upload route. It writes the blob,
 * inserts an **unowned** `attachments` row and hands back its id; the write
 * that follows claims it. Two kinds reach this surface, and the route pairs
 * each with the permission of the page it is destined for: `tool` (a catalogue
 * photo, `tools.add`) and `resource` (a manual, `tools.edit` — the only kind
 * that accepts a PDF).
 *
 * **Every failure is a named outcome, never a thrown error and never a made-up
 * id.** With no `BLOB_READ_WRITE_TOKEN` the route answers 503, and the panel
 * has to say photos cannot be added right now while staying usable for
 * everything else — a tool whose description is wrong is still worth fixing on
 * a deployment with no Blob store (Article 4).
 *
 * A plain module rather than a hook: two sections need the same three lines,
 * and neither of them needs React to do it.
 */

/** Which surface the file is for. Decides its access and its permission. */
export type UploadKind = "tool" | "resource";

/**
 * Why an upload did not produce an id. Each one is a different sentence to the
 * person holding the file:
 *
 * - `unavailable` — this deployment has no Blob store. Nothing they do helps.
 * - `not_permitted` — their account may not upload this kind.
 * - `too_large` / `wrong_type` — the file itself, which they can change.
 * - `failed` — anything else, including a dropped connection.
 */
export type UploadFailure =
  | "unavailable"
  | "not_permitted"
  | "too_large"
  | "wrong_type"
  | "failed";

export type UploadResult =
  | { ok: true; attachmentId: string; previewUrl: string | null }
  | { ok: false; reason: UploadFailure };

const UPLOAD_ENDPOINT = "/api/uploads";

/** Upload one file and return the `attachments` id a write can claim. */
export async function uploadFile(file: File, kind: UploadKind): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);

  try {
    const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form });

    // 503 is the configured-ness of the deployment, not of this file: the route
    // checks it before it reads a byte, and it is the one failure the panel
    // reports once rather than per file.
    if (res.status === 503) return { ok: false, reason: "unavailable" };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "not_permitted" };
    }
    if (res.status === 413) return { ok: false, reason: "too_large" };
    if (!res.ok) {
      // The route answers 400 for both "too large" and "not an image"; its
      // message is English prose, so the code is derived rather than shown.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 400) {
        return { ok: false, reason: /too large/i.test(body?.error ?? "") ? "too_large" : "wrong_type" };
      }
      return { ok: false, reason: "failed" };
    }

    const body = (await res.json()) as { attachmentId?: string; previewUrl?: string | null };
    // No id is a failure, however the route dressed it: inventing one here
    // would claim a photo that does not exist (Article 4).
    if (!body.attachmentId) return { ok: false, reason: "failed" };

    return { ok: true, attachmentId: body.attachmentId, previewUrl: body.previewUrl ?? null };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
