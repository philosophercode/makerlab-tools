import { resolveIdentity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { rateLimitAsync } from "../../../../lib/rate-limit";
import { ALL_TAGS, invalidateCatalog, invalidateProjects } from "../../../../lib/revalidate";

/**
 * `POST /api/admin/revalidate` — drop the cached catalog and projects so the
 * next request re-reads Notion (ops hardening spec §3.2).
 *
 * The catalog caches for a day now, so freshness comes from invalidation rather
 * than polling and *something has to invalidate*. Two callers do:
 *
 * - **A signed-in session holding `tools.edit`** — an admin or a super admin —
 *   which is what the Refresh control in the header uses. A browser cannot hold
 *   the shared secret, so without this branch the button could not exist.
 * - **The `x-admin-secret` header**, unchanged, for the callers that have no
 *   session: a Notion automation webhook, a cron job, `curl` during an incident.
 *
 * The session branch is the authorization — the header control's visibility is
 * presentation, and presentation is not access control.
 */

/**
 * Invalidation is cheap here but expensive on the next request: it forces a
 * full catalogue re-read. Bounded before that happens (Article 4), keyed per
 * identity so one caller cannot spend another's allowance. Generous enough that
 * an admin correcting a run of rows never notices, and a webhook firing per row
 * edit only sheds refreshes it would have made redundant anyway.
 */
const REVALIDATE_TIER = { limit: 30, windowMs: 60_000 };

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

  if (!can(identity, "tools.edit")) {
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

  // Both, through the same helpers every inventory write uses, so a tag can
  // never be spelled one way here and another way there.
  invalidateCatalog();
  invalidateProjects();
  return Response.json({ ok: true, tags: [...ALL_TAGS] });
}
