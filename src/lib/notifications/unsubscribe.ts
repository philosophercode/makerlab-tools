import { createHmac, timingSafeEqual } from "node:crypto";
import { isNotificationEvent, type NotificationEvent } from "./events.ts";

/**
 * The one-click unsubscribe token (email notifications spec §5.4). Pure.
 *
 * `v1.<base64url(JSON {u, e, t})>.<base64url(HMAC-SHA256)>`, keyed by
 * `AUTH_SECRET` with a purpose prefix so the same secret's other uses (the
 * session cookie, hashed IPs) can never be replayed as one of these.
 *
 * - It holds a user id, an event and when it was issued. **Never an
 *   address.**
 * - It can only turn something **off**, for the person and event it names.
 * - It does not expire: people unsubscribe from year-old mail. Rotating
 *   `AUTH_SECRET` voids every old link, which then says it is invalid.
 */

const VERSION = "v1";
const PURPOSE = "makerlab-unsubscribe";

export interface UnsubscribeClaim {
  userId: string;
  event: NotificationEvent;
  /** Seconds since the epoch, when the email was rendered. */
  issuedAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}.${VERSION}.${payload}`).digest("base64url");
}

/** A token for `claim`, or null when there is no secret to sign it with. */
export function signUnsubscribeToken(claim: UnsubscribeClaim, secret: string): string | null {
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ u: claim.userId, e: claim.event, t: claim.issuedAt }), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(payload, secret)}`;
}

/**
 * The claim inside a token, or null for anything not signed by `secret`:
 * a tampered payload, a wrong secret, a truncated link, an unknown event.
 * Constant-time on the signature.
 */
export function verifyUnsubscribeToken(token: string | null | undefined, secret: string): UnsubscribeClaim | null {
  if (!secret || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts;
  const expected = Buffer.from(sign(payload, secret), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; e?: unknown; t?: unknown };
    if (typeof parsed.u !== "string" || !parsed.u || parsed.u.length > 200) return null;
    if (!isNotificationEvent(parsed.e)) return null;
    const issuedAt = typeof parsed.t === "number" && Number.isFinite(parsed.t) ? parsed.t : 0;
    return { userId: parsed.u, event: parsed.e, issuedAt };
  } catch {
    return null;
  }
}

/** `AUTH_SECRET`, read at call time. Empty when sign-in is not set up. */
export function unsubscribeSecret(env: Record<string, string | undefined> = process.env): string {
  return env.AUTH_SECRET || "";
}
