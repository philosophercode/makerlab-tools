import { resolveIdentity } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { recordAuditEvent } from "../../../../../lib/data/audit";
import { listDemoSignups } from "../../../../../lib/data/demo-signups";
import { demoSignupsCsv, demoSignupsCsvFilename } from "../../../../../lib/export/demo-signups-csv";
import { rateLimitAsync } from "../../../../../lib/rate-limit";

/**
 * `GET /api/admin/demo-signups/export` — the demo sign-ups as a CSV (demo pass
 * spec 2026-10-07 §5.6), for `users.manage`: super admins only, the same grant
 * as the People page it sits under.
 *
 * **The route is the control.** 401 for somebody not signed in, 403 for an
 * account without the grant, whatever the page showed. Every download is an
 * audit event (`demo_signups.exported`), written **before** the file goes: a
 * list of visitors' emails must not leave unrecorded, so a failed write
 * refuses the download. `no-store`, so no cache between here and the browser
 * keeps a copy. Not an assistant or MCP action, ever.
 */

/** A handful a minute: each one reads every sign-up. */
const EXPORT_TIER = { limit: 10, windowMs: 60_000 };

export async function GET(req: Request) {
  const identity = await resolveIdentity(req);

  const { allowed } = await rateLimitAsync(`demo-signups-export:${identity.rateLimitKey}`, EXPORT_TIER);
  if (!allowed) {
    return Response.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(EXPORT_TIER.windowMs / 1000) } }
    );
  }

  if (identity.role === "anonymous") return Response.json({ ok: false, error: "sign_in_required" }, { status: 401 });
  if (!can(identity, "users.manage")) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  let csv: string;
  try {
    const records = await listDemoSignups();
    await recordAuditEvent({
      actorUserId: identity.userId,
      action: "demo_signups.exported",
      subjectType: "demo_signups",
      subjectId: "all",
      detail: { rows: records.length },
    });
    csv = demoSignupsCsv(records);
  } catch (err) {
    // Never a partial file, and never the error's words (Drizzle's carry values).
    console.warn("[demo-pass] the sign-ups export failed", err instanceof Error ? err.name : "error");
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${demoSignupsCsvFilename()}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
