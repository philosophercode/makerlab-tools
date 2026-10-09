import { allowUnsubscribeRequest } from "../../../../lib/notifications/unsubscribe-limit";
import { verifyUnsubscribeToken, unsubscribeSecret } from "../../../../lib/notifications/unsubscribe";
import { applyUnsubscribe } from "../../../../lib/notifications/unsubscribe-write";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.

/**
 * `POST /api/notifications/unsubscribe?t=<token>` — turn one email off for one
 * person (email notifications spec §5.4).
 *
 * Two callers:
 *
 * - **A mail client's one-click unsubscribe** (RFC 8058). Every email carries
 *   `List-Unsubscribe: <this URL>` and `List-Unsubscribe-Post:
 *   List-Unsubscribe=One-Click`; the client POSTs that body here. Answered
 *   `200 { ok: true }`.
 * - **The confirm page's Turn off button** (`/notifications/unsubscribe`), a
 *   plain form that sends `from=page`. Answered with a 303 back to the page's
 *   done state, so it works without JavaScript.
 *
 * In order: the limiter (per hashed IP, before anything else) → the signed
 * token, which names the person and the event and can only turn it off →
 * the write, audited as `notification.unsubscribed`. There is deliberately
 * **no GET**: a link scanner (Microsoft Safe Links) fetches every link in a
 * message, and a GET that changed anything would unsubscribe people nobody
 * asked for.
 *
 * Not a session write: it works signed out, so it is not an action-layer
 * wrapper (parity `EXEMPT`, "Account gate").
 */
export async function POST(req: Request): Promise<Response> {
  if (!(await allowUnsubscribeRequest(req.headers))) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "3600" } });
  }

  const url = new URL(req.url);
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const fromPage = form?.get("from") === "page";
  const formToken = form?.get("t");
  const token = url.searchParams.get("t") ?? (typeof formToken === "string" ? formToken : null);
  const claim = verifyUnsubscribeToken(token, unsubscribeSecret());

  if (!claim) {
    if (fromPage) return redirect(req, token, "invalid");
    return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
  }

  try {
    await applyUnsubscribe(claim);
  } catch {
    console.error("[notifications] an unsubscribe could not be saved");
    if (fromPage) return redirect(req, token, "failed");
    return Response.json({ ok: false, error: "failed" }, { status: 500 });
  }

  if (fromPage) return redirect(req, token, "done");
  return Response.json({ ok: true });
}

/** Back to the confirm page in the given state. The token goes back as it came; nothing else is added. */
function redirect(req: Request, token: string | null, state: "done" | "invalid" | "failed"): Response {
  const target = new URL("/notifications/unsubscribe", req.url);
  if (token) target.searchParams.set("t", token);
  target.searchParams.set("state", state);
  return new Response(null, { status: 303, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
