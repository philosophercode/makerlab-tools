/**
 * The demo pass cookie's value (demo pass spec 2026-10-07 §5.2):
 *
 *     v1.<passId>.<expiresAtSeconds>.<signature>
 *
 * The signature is HMAC-SHA256 over everything before it, keyed by
 * `AUTH_SECRET` with a label of its own ({@link KEY_LABEL}), so this key signs
 * nothing else the app signs. Verification goes through `crypto.subtle.verify`,
 * which compares in constant time, and comes **before** any database read: a
 * forged or garbled cookie costs one HMAC and never a query.
 *
 * The value only *names* a row. Whether the pass is still good is the row's
 * call (`pass_expires_at`, read on every turn); the expiry here is a shortcut
 * that lets an old cookie be refused without asking. This is deliberately not
 * the retired `makerlab.identity` cookie or its module: that one *was* the
 * session and nothing could revoke it.
 *
 * Nothing here throws. Every failure — absent, malformed, tampered, expired, no
 * secret — is `null`. Pure WebCrypto: no `server-only`, so tests run it as is.
 */

const VERSION = "v1";
const KEY_LABEL = "makerlab-demo-pass";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();

export interface DemoPassClaim {
  passId: string;
  /** When the pass ends, as the row said when the cookie was set. */
  expiresAt: Date;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`${KEY_LABEL}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The cookie value for a pass, or null with no secret to sign it with. */
export async function signDemoPass(claim: DemoPassClaim, secret: string | null | undefined): Promise<string | null> {
  if (!secret || !UUID.test(claim.passId)) return null;
  const body = `${VERSION}.${claim.passId.toLowerCase()}.${Math.floor(claim.expiresAt.getTime() / 1000)}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

/** The pass a cookie value names, or null for every way it can be wrong. */
export async function verifyDemoPass(
  value: string | null | undefined,
  secret: string | null | undefined,
  now: Date = new Date()
): Promise<DemoPassClaim | null> {
  if (!value || !secret || value.length > 256) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, passId, expires, signature] = parts;
  if (version !== VERSION || !UUID.test(passId) || !/^\d{1,12}$/.test(expires)) return null;
  const bytes = fromBase64Url(signature);
  if (!bytes) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), bytes as BufferSource, encoder.encode(`${version}.${passId}.${expires}`));
    if (!valid) return null;
  } catch {
    return null;
  }
  const expiresAt = new Date(Number(expires) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { passId: passId.toLowerCase(), expiresAt };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
