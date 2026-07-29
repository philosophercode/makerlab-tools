import { revalidateTag } from "next/cache";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { isAtLeast } from "../../../../lib/auth/roles";
import { rateLimitAsync } from "../../../../lib/rate-limit";

/**
 * `POST /api/admin/revalidate` — drop the cached catalog and projects so the
 * next request re-reads Notion (ops hardening spec §3.2).
 *
 * The catalog caches for a day now, so freshness comes from invalidation rather
 * than polling and *something has to invalidate*. Two callers do:
 *
 * - **A signed-in `staff` or `admin` session**, which is what the Refresh
 *   control in the header uses. A browser cannot hold the shared secret, so
 *   without this branch the button could not exist.
 * - **The `x-admin-secret` header**, unchanged, for the callers that have no
 *   session: a Notion automation webhook, a cron job, `curl` during an incident.
 *
 * The session branch is the authorization — the header control's visibility is
 * presentation, and presentation is not access control.
 */

/**
 * Invalidation is cheap here but expensive on the next request: it forces a
 * full Notion re-read. Bounded before that happens (Article 4), keyed per
 * identity so one caller cannot spend another's allowance. Generous enough that
 * a staff member correcting a run of rows never notices, and a webhook firing
 * per row edit only sheds refreshes it would have made redundant anyway.
 */
const REVALIDATE_TIER = { limit: 30, windowMs: 60_000 };

/** Tags every cached read is stored under; one refresh has to clear them all. */
const TAGS = ["catalog", "projects"] as const;

export async function POST(req: Request) {
  const identity = await resolveIdentity(req);

  const { allowed } = await rateLimitAsync(
    `revalidate:${identity.rateLimitKey}`,
    REVALIDATE_TIER
  );
  if (!allowed) {
    return Response.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(REVALIDATE_TIER.windowMs / 1000) },
      }
    );
  }

  if (!isAtLeast(identity.role, "staff")) {
    const presented = req.headers.get("x-admin-secret");
    // No session and no secret offered: nothing to check, and nothing about the
    // deployment's configuration is worth telling this caller.
    if (presented === null) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const secret = process.env.ADMIN_REVALIDATE_SECRET;
    // A caller that *tried* the secret path against a deployment where the
    // secret is unset is looking at a misconfiguration, not a refusal.
    if (!secret) {
      return Response.json(
        { ok: false, error: "ADMIN_REVALIDATE_SECRET is not set" },
        { status: 503 }
      );
    }
    if (presented !== secret) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  for (const tag of TAGS) revalidateTag(tag, "minutes");
  return Response.json({ ok: true, tags: [...TAGS] });
}
