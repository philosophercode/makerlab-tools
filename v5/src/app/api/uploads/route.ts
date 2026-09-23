import { NextRequest } from "next/server";
import { getBlobStore, isBlobConfigured, type BlobAccess } from "../../../lib/blob";
import { createAttachment } from "../../../lib/data/attachments";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity, type Identity } from "../../../lib/auth/identity";
import { can, type Permission } from "../../../lib/auth/permissions";

/**
 * `POST /api/uploads` — the one upload route (data platform design spec §3.3,
 * §4.7). It replaces `/api/upload-notion`, which pushed bytes into a Notion
 * `file_upload` session and handed back a Notion handle.
 *
 * What a caller gets back is now an `attachmentId`: a row in `attachments`
 * owned by nothing yet. The write that follows — a ticket, a project
 * submission — *claims* those ids onto itself, and the daily cron deletes
 * anything still unclaimed after 24 hours. That two-step exists because at
 * upload time the record the photo belongs to has not been written: the student
 * is still typing it.
 *
 * **Access is decided here, not by the client.** A maintenance photo may show a
 * person and is written privately, so it comes back with `previewUrl: null` and
 * the client shows the local `URL.createObjectURL` preview it already holds. A
 * project or tool photo is about to appear on a public page, so it is public
 * and its URL comes back.
 *
 * **And so is who may ask for which.** The client still picks `kind`, so `kind`
 * alone cannot be the whole of the decision: see {@link KIND_POLICY}.
 *
 * **With no `BLOB_READ_WRITE_TOKEN` this route refuses and says so** (Article
 * 4). It does not invent an id, and it does not pretend the file was stored:
 * a student who is told their photo is attached, and whose photo is not, is
 * worse off than one who is told photos are unavailable today.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

/**
 * Kept identical to `/api/upload-notion`'s: the same anonymous students file
 * the same maintenance photos through it, and tightening the limit as a side
 * effect of changing the storage backend would be a behaviour change nobody
 * asked for.
 */
const RATE_LIMIT = { limit: 15, windowMs: 60_000 };

/** What the upload is for. Decides both the access and where it is filed. */
const KINDS = ["chat", "maintenance", "project", "tool", "resource"] as const;
type UploadKind = (typeof KINDS)[number];
const DEFAULT_KIND: UploadKind = "chat";

const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * What each kind costs the caller: the blob's access, and the permission the
 * surface that consumes it requires.
 *
 * **A public `kind` is a request for a permanent, world-readable URL**, and the
 * client chooses `kind`. So a route that read `kind` and nothing else handed an
 * unauthenticated caller a place to host arbitrary images — and, with
 * `kind=resource`, 20 MB PDFs — on the lab's Blob account, claimed by nothing
 * and swept only if still unclaimed 24 hours later. The route's own comment
 * said access was decided here; it was in fact decided by the request body.
 *
 * The rule now is that the permission matches the surface the file is destined
 * for, and it is the permission that surface already enforces:
 *
 * - **`project`** — `projects.submit`. `POST /api/projects` has required sign-in
 *   since Phase 4 (spec §5.5), so an anonymous project photo belongs to no
 *   submission anybody can make.
 * - **`tool`** / **`resource`** — `tools.add` and `tools.edit`. Catalogue images
 *   and manuals come from intake and the admin surfaces, both of which are
 *   already gated on exactly these.
 * - **`chat`** and **`maintenance`** stay open, because they are the two the lab
 *   deliberately lets an anonymous student use — photograph a machine to ask
 *   what it is, photograph a broken one to report it (§3.3). Both are written
 *   **private**: no public URL exists to hand back, and the row is the only way
 *   to reach the bytes. That is what makes leaving them open safe, and it is why
 *   the two lists are the same list.
 *
 * Maintenance photos are the private case §3.3 names — they may show people and
 * are admin-only to read. Chat photos follow them for the same reason.
 */
const KIND_POLICY: Record<
  UploadKind,
  { access: BlobAccess; permission: Permission | null }
> = {
  chat: { access: "private", permission: null },
  maintenance: { access: "private", permission: null },
  project: { access: "public", permission: "projects.submit" },
  tool: { access: "public", permission: "tools.add" },
  resource: { access: "public", permission: "tools.edit" },
};

function isKind(value: string): value is UploadKind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * Why this caller may not upload this kind, or null when they may.
 *
 * 401 and 403 are told apart the way `POST /api/projects` tells them apart:
 * 401 means "sign in and this will work", which is true of every institutional
 * address for a project photo; 403 means signing in will not help, which is the
 * honest answer for a student asking to write a catalogue image.
 */
function uploadRefusal(
  identity: Identity,
  kind: UploadKind
): { status: number; code: string; error: string } | null {
  const { permission } = KIND_POLICY[kind];
  if (!permission) return null;

  if (identity.role === "anonymous") {
    return {
      status: 401,
      code: "sign_in_required",
      error: "Sign in to upload this kind of file.",
    };
  }
  if (!can(identity, permission)) {
    return {
      status: 403,
      code: "forbidden",
      error: "Your account cannot upload this kind of file.",
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Rate limit before reading a multipart body or touching Blob (Article 4).
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`upload:${identity.rateLimitKey}`, RATE_LIMIT);
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Checked before the body is read: with no store there is nowhere for the
  // bytes to go, and reading 18 MB to then refuse is work for nothing.
  if (!isBlobConfigured()) {
    return Response.json(
      {
        code: "blob_not_configured",
        error: "File uploads are unavailable: BLOB_READ_WRITE_TOKEN is not set.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const rawKind = String(form.get("kind") ?? "");
  const kind: UploadKind = isKind(rawKind) ? rawKind : DEFAULT_KIND;

  // Before the file is looked at, let alone written: a caller who may not ask
  // for this kind learns so without the lab storing anything on their behalf.
  const refusal = uploadRefusal(identity, kind);
  if (refusal) {
    const { status, ...body } = refusal;
    return Response.json(body, { status });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "Empty file" }, { status: 400 });
  }

  const type = file.type || "";
  const isImage = type.startsWith("image/");
  // PDFs are for resources only — a manual. Accepting one on a chat or
  // maintenance upload would put an arbitrary document behind a public URL for
  // no feature that asks for it (§3.3).
  const isResourcePdf = type === "application/pdf" && kind === "resource";

  if (!isImage && !isResourcePdf) {
    return Response.json(
      { error: "Only image uploads are supported" },
      { status: 400 }
    );
  }

  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (file.size > maxBytes) {
    return Response.json(
      { error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)` },
      { status: 400 }
    );
  }

  const access = KIND_POLICY[kind].access;
  const store = getBlobStore();

  let stored: { pathname: string; url: string };
  try {
    stored = await store.putUpload(`uploads/${kind}/`, file, access);
  } catch (err) {
    console.error("[uploads] blob write failed", err);
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  let attachmentId: string;
  try {
    const created = await createAttachment({
      blobPathname: stored.pathname,
      access,
      // A private blob has no URL an unauthenticated viewer can follow, so
      // recording one would be a lie the catalogue would later render.
      publicUrl: access === "public" ? stored.url : null,
      contentType: type,
      sizeBytes: file.size,
      originalFilename: file.name || "upload",
      uploadedBy: identity.userId,
      // A person's own file — what tells it apart from a research image owned
      // by the same pending item (gateway spec §4.2).
      origin: "upload",
    });
    attachmentId = created.id;
  } catch (err) {
    console.error("[uploads] attachment insert failed", err);
    // The bytes landed but nothing points at them, so they would sit in the
    // store forever — the cron only sweeps files that *have* a row. Remove
    // them here so a failed upload leaves nothing behind.
    try {
      await store.del([stored.pathname]);
    } catch (cleanupErr) {
      console.error("[uploads] orphaned blob cleanup failed", cleanupErr);
    }
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  return Response.json({
    attachmentId,
    previewUrl: access === "public" ? stored.url : null,
    name: file.name || "upload",
    contentType: type,
    size: file.size,
  });
}
