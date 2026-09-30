import { z } from "zod";
import { authBaseUrl } from "../../../../../lib/auth/config";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { listToolsForExport } from "../../../../../lib/data/tool-export";
import { toolsCsv, toolsCsvFilename } from "../../../../../lib/export/tool-csv";
import { rateLimitAsync } from "../../../../../lib/rate-limit";
import { requestOrigin } from "../../../../../lib/request-origin";

/**
 * `POST /api/admin/tools/export` — the tools CSV (`/admin/inventory`'s
 * **Export CSV**), for `catalog.export`: super admins only.
 *
 * Body `{}` exports every tool — published, draft and archived, with a Status
 * column; `{ ids: [...] }` exports those tools (the table's selection, or the
 * rows its filters leave). Tools only: no tickets, unit history, corrections
 * or usage (`lib/export/tool-csv.ts` lists the columns).
 *
 * **The route is the control.** The button is hidden from everybody else, but
 * hiding is presentation; this checks the permission itself, 401 for somebody
 * not signed in and 403 for a signed-in account without the grant.
 *
 * POST rather than GET because a selection of a few hundred uuids does not fit
 * a URL comfortably. It changes nothing: a read that answers with a file, and
 * `no-store` so no cache between here and the browser keeps a copy of the
 * catalogue. It is deliberately not an assistant or MCP action — export stays a
 * button (`lib/actions/exempt.ts`).
 */

/** A handful a minute: each export reads the whole inventory. */
const EXPORT_TIER = { limit: 10, windowMs: 60_000 };

/** The largest selection accepted — well above the inventory's size, well below abuse. */
const MAX_IDS = 5_000;

const Body = z.object({ ids: z.array(z.string().max(64)).max(MAX_IDS).optional() }).strict();

export async function POST(req: Request) {
  const identity = await resolveIdentity(req);

  const { allowed } = await rateLimitAsync(`tools-export:${identity.rateLimitKey}`, EXPORT_TIER);
  if (!allowed) {
    return Response.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(EXPORT_TIER.windowMs / 1000) } }
    );
  }

  if (identity.role === "anonymous") {
    return Response.json({ ok: false, error: "sign_in_required" }, { status: 401 });
  }
  if (!can(identity, "catalog.export")) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    const text = await req.text();
    body = Body.parse(text.trim() ? JSON.parse(text) : {});
  } catch {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  let csv: string;
  try {
    const records = await listToolsForExport({ ids: body.ids });
    csv = toolsCsv(records, requestOrigin(req.headers) ?? authBaseUrl());
  } catch {
    // Never a partial or empty file standing in for the catalogue (Article 4).
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${toolsCsvFilename()}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
