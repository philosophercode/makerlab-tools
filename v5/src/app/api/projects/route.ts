import { NextRequest } from "next/server";
import {
  createProject,
  hasProjectsEnv,
  type ProjectWriteFields,
} from "../../../lib/notion";
import type { ProjectRecord } from "../../../lib/types";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

const MAX_BODY_CHARS = 20_000;
const MAX_PHOTOS = 8;
const MAX_TOOLS = 20;
const MAX_MATERIALS = 20;

/**
 * What a submission may send. There is deliberately no `author_email` here:
 * the verified author comes from the session and nowhere else.
 */
interface ProjectPayload {
  title?: unknown;
  author?: unknown;
  body?: unknown;
  link?: unknown;
  tools?: unknown;
  materials?: unknown;
  photos?: unknown;
}

interface PhotoUpload {
  id: string;
  name: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asPhotoUploads(value: unknown): PhotoUpload[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is { id: string; name?: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string"
    )
    .map((item) => ({ id: item.id, name: asString(item.name) || "upload" }))
    .slice(0, MAX_PHOTOS);
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Rate limit before any expensive work (Notion page create).
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`projects:${identity.rateLimitKey}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (!hasProjectsEnv()) {
    return Response.json(
      { error: "Project submissions are not configured yet." },
      { status: 503 }
    );
  }

  let payload: ProjectPayload;
  try {
    payload = (await req.json()) as ProjectPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = asString(payload.title);
  // The session wins over whatever the client typed: when the server knows who
  // is submitting, the byline is theirs. The form makes the field read-only for
  // a signed-in student, and this is what makes that guarantee real rather than
  // cosmetic. Anonymous submission keeps working — the typed name is used.
  const author = asString(identity.name) || asString(payload.author);
  const body = asString(payload.body);
  const link = asString(payload.link);
  const tools = asStringArray(payload.tools, MAX_TOOLS);
  const materials = asStringArray(payload.materials, MAX_MATERIALS);
  const photoUploads = asPhotoUploads(payload.photos);

  if (!title || !author || !body) {
    return Response.json(
      { error: "Title, author, and a write-up are required." },
      { status: 400 }
    );
  }
  if (body.length > MAX_BODY_CHARS) {
    return Response.json(
      { error: "Write-up is too long." },
      { status: 400 }
    );
  }
  if (link && !isValidUrl(link)) {
    return Response.json(
      { error: "Link must be a valid http(s) URL." },
      { status: 400 }
    );
  }
  // Count the *submitted* items, not the truncated ones: silently dropping a
  // student's 9th photo is worse than telling them it didn't fit.
  if (Array.isArray(payload.photos) && payload.photos.length > MAX_PHOTOS) {
    return Response.json(
      { error: `Please attach at most ${MAX_PHOTOS} photos.` },
      { status: 400 }
    );
  }
  if (Array.isArray(payload.tools) && payload.tools.length > MAX_TOOLS) {
    return Response.json(
      { error: `Please select at most ${MAX_TOOLS} tools.` },
      { status: 400 }
    );
  }

  try {
    const record = await submitProject({
      title,
      author,
      body,
      // Server-resolved only (spec §4). `payload.author_email` is never read —
      // a client may not assert who it is. Anonymous stays a first-class path:
      // no session, no email, submission still succeeds.
      author_email: identity.email || undefined,
      link: link || undefined,
      tools_used: tools,
      materials,
      photo_uploads: photoUploads,
    });
    return Response.json({ id: record.id }, { status: 201 });
  } catch (err) {
    console.error("Project submission failed", err);
    return Response.json(
      { error: "Submission failed. Please try again." },
      { status: 502 }
    );
  }
}

/**
 * Create the project, retrying once without `author_email` if Notion refuses
 * that property.
 *
 * `author_email` is a new Email column a person has to add to the Projects
 * database by hand (spec §4) — Notion has no migrations and rejects any write
 * naming a property that does not exist. Losing a student's write-up to a
 * missing column is the wrong way to fail: record the project, drop the email,
 * and make the misconfiguration loud in the logs (Article 4 — fail toward
 * stale, not toward wrong). Mirrors `report_issue`'s `reporter_email` fallback.
 */
async function submitProject(fields: ProjectWriteFields): Promise<ProjectRecord> {
  try {
    return await createProject(fields);
  } catch (err) {
    if (!fields.author_email || !isUnknownPropertyError(err, "author_email")) {
      throw err;
    }
    console.warn(
      "[projects] Notion rejected `author_email` — recording the submission without it. Add the Email property to the Projects database (projects spec §4).",
      err
    );
    const withoutEmail = { ...fields };
    delete withoutEmail.author_email;
    return createProject(withoutEmail);
  }
}

/**
 * Does this look like Notion refusing an unknown property? `projectsRequest`
 * throws `Notion API <status>: <body>`, and a schema mismatch is a 400 whose
 * body names the offending property. Narrow on both so a 401 or a network blip
 * still surfaces as the failure it is.
 */
function isUnknownPropertyError(err: unknown, property: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("400") && message.includes(property);
}
