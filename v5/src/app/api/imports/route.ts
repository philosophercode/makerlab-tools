import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { DbUnavailableError } from "../../../lib/db/client";
import { isUuid } from "../../../lib/data/uuid";
import { IMPORT_PERMISSION } from "../../../lib/import/access";
import { IMPORT_MAX_TEXT_BYTES } from "../../../lib/import/limits";
import { startImport, type StartImportError } from "../../../lib/import/service";
import { importPath, toImportView, type ImportView } from "../../../lib/import/view";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * `POST /api/imports` — **Import a list** on `/admin/intake` (bulk intake spec
 * §5 step 1).
 *
 * Body: `{ text, sourceName? }` for a paste, or `{ attachmentId, sourceName? }`
 * for a file already stored through `POST /api/uploads` (kind `import` —
 * private Blob, that route's type and size checks). Identity, the limiter,
 * sign-in and `tools.add` come first; then the import is created
 * (`startImport`): a table waits for its column matches, a plain list becomes
 * rows at once, a document starts being read in the background. The answer is
 * the import, and where to review it.
 *
 * A route rather than a server action because a pasted 5 MB list is past a
 * server action's body limit. Refusals are `{ code, error }`; the page renders
 * the code (`admin.import.errors.<code>`), the English is a fallback.
 */

export const maxDuration = 60;

const bodySchema = z
  .strictObject({
    // The byte cap is checked after parsing; this bound only stops a body no textarea produced.
    text: z.string().max(IMPORT_MAX_TEXT_BYTES + 1024).optional(),
    attachmentId: z.string().refine(isUuid).optional(),
    sourceName: z.string().max(300).nullable().optional(),
  })
  .refine((body) => (body.text === undefined) !== (body.attachmentId === undefined));

export interface CreateImportResponse {
  import: ImportView;
  href: string;
}

const STATUS: Record<StartImportError, number> = {
  empty: 400,
  too_large: 413,
  too_many_items: 413,
  file_not_found: 404,
  unsupported_file: 415,
  unreadable_file: 422,
  no_text_in_pdf: 422,
  blob_unavailable: 503,
};

function refuse(status: number, code: string, error: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) {
  return Response.json({ code, error, ...extra }, { status, headers });
}

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("imports", identity);
  if (!decision.allowed) {
    return refuse(429, "rate_limited", "Too many imports. Please slow down.", {}, { "Retry-After": String(decision.retryAfterSeconds) });
  }
  if (identity.role === "anonymous" || !identity.userId) {
    return refuse(401, "sign_in_required", "Sign in to import equipment.");
  }
  if (!can(identity, IMPORT_PERMISSION)) {
    return refuse(403, "forbidden", "Your account cannot add equipment.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return refuse(400, "invalid_body", "The request body is not JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return refuse(400, "invalid_body", "Send { text } or { attachmentId }.");
  }

  try {
    const outcome = await startImport({
      userId: identity.userId,
      text: parsed.data.text,
      attachmentId: parsed.data.attachmentId,
      sourceName: parsed.data.sourceName ?? null,
      origin: "page",
    });
    if (!outcome.ok) {
      return refuse(STATUS[outcome.error], outcome.error, "The list could not be imported.", outcome.limit ? { limit: outcome.limit } : {});
    }
    const body: CreateImportResponse = {
      import: toImportView(outcome.import, identity.name ?? null),
      href: importPath(outcome.import.id),
    };
    return Response.json(body, { status: 201 });
  } catch (error) {
    console.error("[imports] could not start an import", error);
    if (error instanceof DbUnavailableError) return refuse(503, "unavailable", "The inventory database is unreachable.");
    return refuse(500, "failed", "The list could not be imported.");
  }
}
