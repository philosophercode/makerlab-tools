import { createHash, randomBytes } from "node:crypto";

/**
 * The shape of a personal access token (MCP access spec §3.1, §4.1).
 *
 * `mlt_` followed by 32 random bytes as base64url — 43 characters, ~256 bits.
 * The prefix makes a leaked token recognisable to a secret scanner and tells
 * the MCP route which kind of bearer it is holding before any database read.
 *
 * **Only the hash is ever stored.** `hashApiToken` is plain SHA-256: the token
 * is random and long, so there is nothing for a slow hash to protect, and a
 * fast one keeps the lookup a single indexed equality. `displayPrefix` is the
 * one part of a token that may appear in a log line or on a page.
 *
 * No `"server-only"`: tests and the data module load it under plain Node.
 */

export const API_TOKEN_PREFIX = "mlt_";

/** Characters of the random part kept for display (§4.1: "first 8 characters after `mlt_`"). */
export const DISPLAY_PREFIX_LENGTH = 8;

/** base64url of 32 bytes, unpadded. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiToken {
  /** The whole token. Shown once, never stored, never logged. */
  token: string;
  /** SHA-256 of {@link token}, hex — what `api_tokens.token_hash` holds. */
  hash: string;
  /** The first eight characters after `mlt_`. */
  prefix: string;
}

/** A fresh token, its hash and its display prefix. */
export function generateApiToken(): GeneratedApiToken {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashApiToken(token), prefix: prefixOf(token) };
}

/** SHA-256 of the whole token, hex. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True when `value` looks like one of ours — the route's first, free check. */
export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX) && TOKEN_BODY.test(value.slice(API_TOKEN_PREFIX.length));
}

/** The eight characters after `mlt_`. */
export function prefixOf(token: string): string {
  return token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH);
}

/** `mlt_ab12cd34…` — how a token is named anywhere a person or a log reads it. */
export function displayPrefix(prefix: string): string {
  return `${API_TOKEN_PREFIX}${prefix}…`;
}
