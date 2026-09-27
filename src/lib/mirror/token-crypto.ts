import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * A mirror's Notion token at rest (spec §8 "Secrets at rest", open question 5
 * as answered on 2026-09-23).
 *
 * AES-256-GCM under a key derived from `AUTH_SECRET` with HKDF-SHA256, a fixed
 * salt and a fixed info string, so no new environment variable is needed. The
 * trade is named in the spec: rotating `AUTH_SECRET` ends every session **and**
 * makes every stored token unreadable, and the mirror page then asks for the
 * token again.
 *
 * Layout of the stored value: `0x01 | iv (12) | tag (16) | ciphertext`. The
 * leading version byte leaves room for a different key or cipher later without
 * guessing at what an old row holds.
 *
 * **No error thrown here carries the token, the secret or the key** — not in
 * its message and not as a `cause` — because an error message is exactly the
 * thing that ends up in a log line (§10: "a mirror token shows up in a log line
 * or an error message").
 *
 * Plain Node (`node:crypto`), no `server-only`, no `@/` alias: workflow step
 * code decrypts the token from an esbuild bundle.
 */

export const MIRROR_TOKEN_KEY_INFO = "makerlab-tools/notion-mirror-token/v1";

const SALT = "makerlab-tools-mirror";
const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** `AUTH_SECRET` is unset or empty, so no key can be derived. */
export class MirrorKeyUnavailableError extends Error {
  constructor() {
    super("The mirror token key is unavailable: AUTH_SECRET is not set.");
    this.name = "MirrorKeyUnavailableError";
  }
}

/** The stored value does not decrypt under the current key — rotated secret, or tampered bytes. */
export class MirrorTokenUnreadableError extends Error {
  constructor() {
    super("The stored mirror token cannot be decrypted with the current AUTH_SECRET.");
    this.name = "MirrorTokenUnreadableError";
  }
}

/** True when a key can be derived — `AUTH_SECRET` (or `secret`) is set and not blank. */
export function mirrorKeyAvailable(secret: string | undefined = process.env.AUTH_SECRET): boolean {
  return typeof secret === "string" && secret.trim().length > 0;
}

function deriveKey(secret: string): Buffer {
  if (!mirrorKeyAvailable(secret)) throw new MirrorKeyUnavailableError();
  return Buffer.from(hkdfSync("sha256", secret, SALT, MIRROR_TOKEN_KEY_INFO, 32));
}

/** Encrypt `token` for `notion_mirrors.token_ciphertext`. Two calls never produce the same bytes. */
export function encryptMirrorToken(token: string, secret: string = process.env.AUTH_SECRET ?? ""): Uint8Array {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]));
}

/**
 * Decrypt a stored token.
 *
 * @throws MirrorKeyUnavailableError when there is no secret to derive a key from.
 * @throws MirrorTokenUnreadableError for a wrong key, a tampered or truncated
 *   value, or an unknown version byte. Deliberately the same error for all of
 *   them: the remedy is the same (connect again), and the difference is not
 *   something to show anybody.
 */
export function decryptMirrorToken(
  ciphertext: Uint8Array,
  secret: string = process.env.AUTH_SECRET ?? ""
): string {
  const key = deriveKey(secret);
  const bytes = Buffer.from(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength);
  if (bytes.length <= HEADER_BYTES || bytes[0] !== VERSION) throw new MirrorTokenUnreadableError();

  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, HEADER_BYTES);
  const body = bytes.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Node's own message ("Unsupported state or unable to authenticate data")
    // says nothing secret, but nothing is gained by passing it on either.
    throw new MirrorTokenUnreadableError();
  }
}
