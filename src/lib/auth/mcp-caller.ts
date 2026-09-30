import "server-only";

import { timingSafeEqual } from "node:crypto";
import { API_TOKEN_PREFIX, displayPrefix, hashApiToken } from "./api-token-format";
import { READ_ONLY_SCOPE } from "./config";
import { anonymousIdentity, evaluateUser, type Identity } from "./identity";
import { findApiTokenByHash, findOAuthAccessToken, touchApiToken, type BearerUser } from "../data/api-tokens";

/**
 * Who is calling `/api/mcp` (MCP access spec §3.1).
 *
 * The MCP route's counterpart of `resolveIdentity`, with the bearer branch the
 * spec adds, tried before anything else:
 *
 * ```text
 * Authorization: Bearer mlt_…              → a personal access token
 * Authorization: Bearer <MCP_TOKEN value>  → the retired shared secret (deprecated)
 * Authorization: Bearer <anything else>    → an OAuth access token from the `mcp` plugin
 * (no Authorization header)                → anonymous: the public reads
 * ```
 *
 * **Scoped to MCP on purpose.** `resolveIdentity` — what every other route
 * uses — still reads only the session cookie. A token is made for an MCP
 * client, and honouring it on `/api/chat`, the upload route or the research
 * route would let a leaked read-only token spend money and a token carry
 * permissions onto surfaces its owner never connected (spec amendment
 * "Bearer tokens are honoured on the MCP route only").
 *
 * **A bearer that does not resolve is refused, never downgraded to
 * anonymous** (§3.1). A client that meant to act as somebody must be told it
 * is not, or the first write it tries fails with a message about permissions
 * rather than about the token.
 *
 * The same ban, floor and domain rules as a session apply (`evaluateUser`), so
 * a banned person's tokens stop at once and a demotion lands on the next call.
 * The token itself never reaches a log line; only its display prefix does.
 */

export type McpCredential = "anonymous" | "token" | "oauth" | "legacy_token";

export interface McpCaller {
  identity: Identity;
  /** A read-only token or grant: `kind: "write"` tools are neither listed nor callable. */
  readOnly: boolean;
  via: McpCredential;
  /** `api_tokens.id`, for a personal access token. */
  tokenId?: string;
}

export type McpAuthRefusal =
  | "unknown_token"
  | "token_revoked"
  | "token_expired"
  | "account_suspended"
  | "unavailable";

export type McpAuthResult = { ok: true; caller: McpCaller } | { ok: false; reason: McpAuthRefusal };


/** Resolve the caller. Never throws. */
export async function resolveMcpCaller(req: Request): Promise<McpAuthResult> {
  const bearer = bearerOf(req);
  if (bearer === null) {
    return { ok: true, caller: { identity: await anonymousIdentity(req), readOnly: false, via: "anonymous" } };
  }
  if (!bearer) return { ok: false, reason: "unknown_token" };

  if (isLegacyToken(bearer)) {
    warnLegacyTokenOnce();
    // "A read-only, no-role identity" (§5.3): exactly what an anonymous
    // caller gets, keyed by IP like one, and never a write.
    return { ok: true, caller: { identity: await anonymousIdentity(req), readOnly: true, via: "legacy_token" } };
  }

  try {
    return bearer.startsWith(API_TOKEN_PREFIX) ? await resolvePersonalToken(bearer) : await resolveOAuthToken(bearer);
  } catch (err) {
    // The database the token lives in is unreachable. Not the caller's fault
    // and not a reason to act as nobody: say so and let them retry.
    console.warn("[mcp] could not resolve a bearer token", err instanceof Error ? err.message : "unknown error");
    return { ok: false, reason: "unavailable" };
  }
}

async function resolvePersonalToken(token: string): Promise<McpAuthResult> {
  const found = await findApiTokenByHash(hashApiToken(token));
  if (!found.found) return { ok: false, reason: "unknown_token" };
  if (found.revoked) return { ok: false, reason: "token_revoked" };
  if (found.expired) return { ok: false, reason: "token_expired" };

  const identity = identityFor(found.user, `token:${found.tokenId}`);
  if (!identity.ok) {
    console.info(`[mcp] token ${displayPrefix(found.prefix)} refused: ${identity.reason}`);
    return { ok: false, reason: identity.reason };
  }
  await touchApiToken(found.tokenId);
  return {
    ok: true,
    caller: { identity: identity.identity, readOnly: found.readOnly, via: "token", tokenId: found.tokenId },
  };
}

async function resolveOAuthToken(token: string): Promise<McpAuthResult> {
  const found = await findOAuthAccessToken(token);
  if (!found.found || !found.user) return { ok: false, reason: "unknown_token" };
  if (found.expired) return { ok: false, reason: "token_expired" };

  const identity = identityFor(found.user, `user:${found.user.id}`);
  if (!identity.ok) return { ok: false, reason: identity.reason };
  return {
    ok: true,
    caller: { identity: identity.identity, readOnly: found.scopes.includes(READ_ONLY_SCOPE), via: "oauth" },
  };
}

function identityFor(
  user: BearerUser,
  rateLimitKey: string
): { ok: true; identity: Identity } | { ok: false; reason: "account_suspended" | "unknown_token" } {
  const verdict = evaluateUser(user);
  if (!verdict.ok) return { ok: false, reason: verdict.reason === "banned" ? "account_suspended" : "unknown_token" };
  return {
    ok: true,
    identity: {
      role: verdict.role,
      userId: user.id,
      email: user.email,
      name: user.name ?? null,
      image: user.image || null,
      rateLimitKey,
    },
  };
}

/**
 * The bearer credential, `""` for a `Bearer` header with nothing after it, or
 * null when the request carries none — the anonymous case.
 */
function bearerOf(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.trim()) return null;
  const match = /^bearer\s+(.*)$/i.exec(header.trim());
  if (!match) return "";
  return match[1].trim();
}

/** The retired shared secret, compared in constant time. */
function isLegacyToken(bearer: string): boolean {
  const expected = legacyMcpToken();
  if (!expected) return false;
  const a = Buffer.from(bearer, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `MCP_TOKEN`, read at call time. Deprecated for one release (§5.3). */
export function legacyMcpToken(): string {
  return (process.env.MCP_TOKEN || "").trim();
}

/** True while the deprecated `MCP_TOKEN` is still set — `/admin` says so. */
export function isLegacyMcpTokenSet(): boolean {
  return Boolean(legacyMcpToken());
}

let warnedLegacy = false;

function warnLegacyTokenOnce(): void {
  if (warnedLegacy) return;
  warnedLegacy = true;
  console.warn(
    "[mcp] MCP_TOKEN is deprecated: callers using it now get the public read-only tools only. Create a personal access token on /account/tokens and unset MCP_TOKEN."
  );
}

/** Test-only: forget that the deprecation warning was printed. */
export function resetLegacyWarningForTests(): void {
  warnedLegacy = false;
}
