import { NextRequest } from "next/server";
import { head } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { resolveIdentity, type Identity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { hasPrivateBlobStore, hasVercelBlobStore } from "../../../../lib/blob-mode";
import { createAttachment, findAttachmentByPathname } from "../../../../lib/data/attachments";
import { withDemoActor } from "../../../../lib/demo-admin/actor";
import { IMPORT_PERMISSION } from "../../../../lib/import/access";
import {
  importFileKind,
  importFileLimit,
  importStoredType,
  importUploadPrefix,
  IMPORT_TEXT_TYPES,
} from "../../../../lib/import/upload-policy";
import { rateLimitAsync } from "../../../../lib/rate-limit";

/**
 * `POST /api/uploads/token` — a list to import, sent from the browser straight
 * to Blob (import progress spec 2026-10-27 §3.5). Vercel refuses a function
 * request body over 4.5 MB before `POST /api/uploads` runs, so a file over
 * that limit — a long CSV, any sizeable PDF — goes this way instead, and the
 * 5 MB text and 20 MB PDF limits are real.
 *
 * Three steps, one route:
 *
 * 0. **The folder** (`{ type: "import.folder" }`): the caller's own prefix.
 * 1. **The token** (`@vercel/blob/client`'s `upload()` asks for it): issued
 *    only to somebody who may import (`tools.add`), only for a pathname in
 *    their own folder (`uploads/import/<user id>/`), and only for the type and
 *    size the file claims, within the import limits. Blob enforces the size
 *    and type in the token.
 * 2. **The completion** (`{ type: "import.complete", pathname }`): the browser
 *    says the upload landed; the route looks the blob up (`head`), checks the
 *    folder and the size again, and records the same unowned `attachments` row
 *    `POST /api/uploads` writes. The answer has the same shape, so the caller
 *    goes on to `POST /api/imports` with the attachment id exactly as before.
 *
 * The completion is the browser's call, not Blob's webhook, because the page
 * needs the attachment id at once and a webhook cannot reach a laptop.
 *
 * **Only a store with a read-write token can sign a client token.** With none
 * (a store connected by id alone, or the local folder) this answers 501
 * `client_upload_unavailable` and the browser uses `POST /api/uploads`, which
 * still takes anything under the body limit.
 */

export const maxDuration = 30;

/** The same allowance `POST /api/uploads` gives: a token and its completion are one upload. */
const RATE_LIMIT = { limit: 15, windowMs: 60_000 };

/** What the browser says about the file when it asks for a token. */
const clientPayloadSchema = z.strictObject({
  name: z.string().min(1).max(300),
  type: z.string().max(200),
  size: z.number().int().positive(),
});

const folderSchema = z.strictObject({ type: z.literal("import.folder") });

const completeSchema = z.strictObject({
  type: z.literal("import.complete"),
  pathname: z.string().min(1).max(600),
  name: z.string().min(1).max(300),
});

/**
 * The read-write token that signs a client upload into the store that holds
 * **private** files, or null when there is none to sign with. A private store
 * connected by id alone cannot sign; using the default store's token then
 * would write a private list into the public store, which refuses it.
 */
function privateSigningToken(): string | null {
  const own = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  if (own) return own;
  if (hasPrivateBlobStore()) return null;
  if (!hasVercelBlobStore()) return null;
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

function refuse(status: number, code: string, error: string) {
  return Response.json({ code, error }, { status });
}

function importRefusal(identity: Identity): Response | null {
  if (identity.role === "anonymous" || !identity.userId) return refuse(401, "sign_in_required", "Sign in to upload this kind of file.");
  if (!can(identity, IMPORT_PERMISSION)) return refuse(403, "forbidden", "Your account cannot upload this kind of file.");
  return null;
}

/** Thrown inside `onBeforeGenerateToken` so the answer keeps its status and code. */
class TokenRefusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`upload:${identity.rateLimitKey}`, RATE_LIMIT);
  if (!allowed) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const refusal = importRefusal(identity);
  if (refusal) return refusal;
  // A demo identity's files belong to the demo's actor, as on `POST /api/uploads`.
  const actor = await withDemoActor(identity);
  const userId = actor.userId!;

  const token = privateSigningToken();
  if (!token) {
    return refuse(501, "client_upload_unavailable", "Direct uploads are unavailable here; send the file to /api/uploads.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse(400, "invalid_body", "The request body is not JSON.");
  }

  // Where this person's direct uploads go: the browser cannot know its own user id.
  if (folderSchema.safeParse(body).success) return Response.json({ prefix: importUploadPrefix(userId) });

  const complete = completeSchema.safeParse(body);
  if (complete.success) return completeUpload(complete.data, userId, token);

  try {
    const answer = await handleUpload({
      body: body as HandleUploadBody,
      request: req,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const claimed = clientPayloadSchema.safeParse(JSON.parse(clientPayload ?? "null"));
        if (!claimed.success) throw new TokenRefusal(400, "invalid_body", "Say the file's name, type and size.");
        if (!pathname.startsWith(importUploadPrefix(userId)) || pathname.includes("..")) {
          throw new TokenRefusal(403, "forbidden", "That is not your upload folder.");
        }
        const kind = importFileKind(claimed.data.type, claimed.data.name);
        if (!kind) throw new TokenRefusal(400, "unsupported_file", "Import a CSV, TSV, text, Markdown or PDF file");
        const limit = importFileLimit(kind);
        if (claimed.data.size > limit) {
          throw new TokenRefusal(400, "file_too_large", `File too large (max ${Math.round(limit / (1024 * 1024))}MB)`);
        }
        return {
          // Blob holds the upload to these, whatever the browser does next.
          maximumSizeInBytes: limit,
          allowedContentTypes: kind === "pdf" ? ["application/pdf"] : [...IMPORT_TEXT_TYPES, "text/*"],
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(answer);
  } catch (err) {
    if (err instanceof TokenRefusal) return refuse(err.status, err.code, err.message);
    console.error("[uploads/token] could not issue a client token", err);
    return refuse(400, "invalid_body", "The upload could not be started.");
  }
}

async function completeUpload(input: z.infer<typeof completeSchema>, userId: string, token: string): Promise<Response> {
  if (!input.pathname.startsWith(importUploadPrefix(userId))) {
    return refuse(403, "forbidden", "That is not your upload.");
  }
  const kind = importFileKind("", input.name) ?? importFileKind("text/plain", input.name);
  if (!kind) return refuse(400, "unsupported_file", "Import a CSV, TSV, text, Markdown or PDF file");

  // Completing twice answers with the first row; never two rows over one blob.
  const existing = await findAttachmentByPathname(input.pathname);
  if (existing) {
    if (existing.uploadedBy !== userId) return refuse(403, "forbidden", "That is not your upload.");
    return Response.json({ attachmentId: existing.id, previewUrl: null, name: input.name });
  }

  let stored: Awaited<ReturnType<typeof head>>;
  try {
    stored = await head(input.pathname, { token });
  } catch {
    return refuse(404, "file_not_found", "The upload did not arrive.");
  }
  const limit = importFileLimit(kind);
  if (stored.size === 0 || stored.size > limit) {
    return refuse(400, "file_too_large", `File too large (max ${Math.round(limit / (1024 * 1024))}MB)`);
  }

  try {
    const created = await createAttachment({
      blobPathname: stored.pathname,
      access: "private",
      publicUrl: null,
      contentType: importStoredType(kind),
      sizeBytes: stored.size,
      originalFilename: input.name,
      uploadedBy: userId,
      origin: "upload",
    });
    return Response.json({
      attachmentId: created.id,
      previewUrl: null,
      name: input.name,
      contentType: stored.contentType,
      size: stored.size,
    });
  } catch (err) {
    console.error("[uploads/token] attachment insert failed", err);
    return refuse(502, "failed", "Upload failed");
  }
}
