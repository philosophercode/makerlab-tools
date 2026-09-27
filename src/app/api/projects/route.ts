import { NextRequest } from "next/server";
import { createProjectSubmission } from "../../../lib/data/projects";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";

/**
 * `POST /api/projects` — a student's project write-up.
 *
 * Since Phase 3 the submission is a `projects` row plus its `project_tools`
 * links (data platform spec §3.10, §4.10), written by
 * `src/lib/data/projects.ts` in one transaction. Nothing here decides anything
 * about publication: `createProjectSubmission` takes no `published` argument,
 * so there is no field a client could send that would put a write-up in the
 * gallery (Article 5).
 *
 * **Phase 4 made sign-in a requirement here** (spec §5.5) — the one place in
 * the app where it is. Browsing, searching, chatting and reporting a problem
 * are all still anonymous; submitting is not, because a project carries a
 * byline into a public gallery and "who wrote this" has to be something the
 * server knows rather than something the request claimed. `projects.submit` is
 * held by every signed-in role, so the gate is sign-in, not seniority.
 *
 * There is no "not configured" state any more. The database is always there —
 * Neon in production, PGlite when `DATABASE_URL` is unset — so a submission
 * either lands or reports that it did not.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

const MAX_BODY_CHARS = 20_000;
const MAX_PHOTOS = 8;
const MAX_TOOLS = 20;
const MAX_MATERIALS = 20;

/**
 * What a submission may send. There is deliberately no `author` and no
 * `author_email`: since Phase 4 the byline and the author id both come from the
 * session, and a field the server ignores is a field somebody will eventually
 * believe in.
 */
interface ProjectPayload {
  title?: unknown;
  body?: unknown;
  link?: unknown;
  tools?: unknown;
  materials?: unknown;
  photos?: unknown;
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

/**
 * The upload ids out of the `photos` array. The `name` each entry also carries
 * is the client's own label for its preview; the filename staff see comes from
 * the `attachments` row the upload wrote, not from the request body.
 */
function asPhotoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is { id: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string"
    )
    .map((item) => item.id)
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
  // Rate limit before any expensive work (Article 4).
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

  // Told apart on purpose (spec §5.5). 401 means "sign in and this will work",
  // which is true for everybody with an institutional address; 403 would mean
  // "signing in will not help", which is only true for a banned account — and
  // a banned account resolves to anonymous, so it lands on the 401 too.
  if (identity.role === "anonymous") {
    return Response.json(
      { error: "Sign in to share a project.", code: "sign_in_required" },
      { status: 401 }
    );
  }
  if (!can(identity, "projects.submit")) {
    return Response.json(
      { error: "Your account cannot submit projects.", code: "forbidden" },
      { status: 403 }
    );
  }

  let payload: ProjectPayload;
  try {
    payload = (await req.json()) as ProjectPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = asString(payload.title);
  // **The byline is the session's, full stop.** `payload.author` is no longer
  // read at all: the form stopped offering the field (spec §5.5), and leaving
  // the fallback in would mean a request that simply omitted its cookie could
  // still choose its own byline. A signed-in account with no display name gets
  // a null byline, which the gallery renders as "Anonymous" — an account we
  // know but cannot name, which is the truth.
  const author = asString(identity.name);
  const body = asString(payload.body);
  const link = asString(payload.link);
  const tools = asStringArray(payload.tools, MAX_TOOLS);
  const materials = asStringArray(payload.materials, MAX_MATERIALS);
  const photoIds = asPhotoIds(payload.photos);

  if (!title || !body) {
    return Response.json(
      { error: "A title and a write-up are required." },
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
    const record = await createProjectSubmission({
      title,
      body,
      authorName: author || null,
      // Server-resolved only (spec §4). Nothing in the request body reaches
      // either of these — a client may not assert who it is — and after the
      // gate above `identity.userId` is always a real `user.id`, which the
      // `created_by` foreign key now requires anyway.
      authorUserId: identity.userId,
      link: link || null,
      materials,
      // Unknown ids are dropped inside the write rather than refused here: a
      // stale catalogue id in a form that has been open a while must not cost
      // a student their write-up (Article 4).
      toolIds: tools,
      photoAttachmentIds: photoIds,
    });
    // Photos offered but not all of them claimed: say so rather than let the
    // student believe the gallery will show a picture that is not there
    // (Article 4). `createProjectSubmission` returns the count for exactly this
    // reason, and the sibling write path — `report_issue` in
    // `src/lib/capabilities/maintenance.ts` — already tells the student the same
    // thing, so answering 201 and dropping the count on the floor here was the
    // odd one out. The usual cause is time: an upload nobody claims is deleted
    // by the nightly cron after 24 hours, so a form left open overnight submits
    // ids that no `attachments` row answers to any more.
    const photosLost = photoIds.length - record.photosAttached;
    if (photosLost > 0) {
      console.warn(
        `[projects] submission ${record.id} saved without ${photosLost} of its ${photoIds.length} photo(s) — no unclaimed attachment matched the ids supplied`
      );
    }
    // The id is what the form has always been handed back; the slug rides
    // along for the admin page that will publish it. The two counts are the
    // form's evidence — it renders the "saved without your photos" line off
    // the server's answer rather than assuming its own uploads stuck.
    return Response.json(
      {
        id: record.id,
        slug: record.slug,
        photosSubmitted: photoIds.length,
        photosAttached: record.photosAttached,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Project submission failed", err);
    return Response.json(
      { error: "Submission failed. Please try again." },
      { status: 502 }
    );
  }
}
