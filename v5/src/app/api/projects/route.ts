import { NextRequest } from "next/server";
import { createProject, hasProjectsEnv } from "../../../lib/notion";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

const MAX_BODY_CHARS = 20_000;
const MAX_PHOTOS = 8;
const MAX_TOOLS = 20;
const MAX_MATERIALS = 20;

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
  const author = asString(payload.author);
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
    const record = await createProject({
      title,
      author,
      body,
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
