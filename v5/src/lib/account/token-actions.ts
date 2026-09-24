import "server-only";

import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { displayPrefix } from "../auth/api-token-format";
import {
  createApiToken,
  revokeApiToken,
  revokeConnectedApp,
  TOKEN_EXPIRY_CHOICES,
  type ApiTokenSummary,
  type TokenExpiryChoice,
} from "../data/api-tokens";
import { recordAuditEvent } from "../data/audit";
import { checkRateLimit } from "../rate-limit";

/**
 * What `/account/tokens` does (MCP access spec §5.1, §6), behind its server
 * actions. The actions are one line each; this module holds the gate, the
 * write and the audit event so they are testable without a page.
 *
 * **Every action gates itself** — a server action is a POST endpoint with a
 * generated name, reachable without the page that offers it: the identity is
 * resolved from the session cookie, the limiter runs (`account`, per person),
 * and an anonymous caller is refused. Nobody acts on anybody else's token:
 * the owner is part of every `where` in `data/api-tokens.ts`.
 *
 * **Audited** (`token.created`, `token.revoked`, §4.2) with the display
 * prefix and never the token. A lost audit event is a warning on a success,
 * never a failure — the token exists, and saying otherwise would hide a live
 * credential from its owner (the shape every admin write uses).
 *
 * **The token is returned once**, by `createToken`, to the person who made it.
 * It is not logged and not stored; the page shows it until they leave.
 */

export type AccountActionError =
  | "not_signed_in"
  | "rate_limited"
  | "invalid_field"
  | "too_many_tokens"
  | "not_found"
  | "already_revoked"
  | "failed";

export type AccountActionWarning = "audit_unavailable";

export type CreateTokenResult =
  | { ok: true; token: string; summary: ApiTokenSummary; warning?: AccountActionWarning }
  | { ok: false; error: AccountActionError };

export type RevokeResult =
  | { ok: true; warning?: AccountActionWarning }
  | { ok: false; error: AccountActionError };

type Gate = { ok: true; identity: Identity & { userId: string } } | { ok: false; error: AccountActionError };

/** Identity, limiter, signed in — in that order (Article 4: the limiter before anything else). */
export async function authorizeAccountAction(resolved?: Identity): Promise<Gate> {
  const identity = resolved ?? (await resolveIdentityFromHeaders());
  const { allowed } = await checkRateLimit("account", identity);
  if (!allowed) return { ok: false, error: "rate_limited" };
  if (identity.role === "anonymous" || !identity.userId) return { ok: false, error: "not_signed_in" };
  return { ok: true, identity: identity as Identity & { userId: string } };
}

export async function createToken(input: {
  name: string;
  expiry: string;
  readOnly: boolean;
}): Promise<CreateTokenResult> {
  const gate = await authorizeAccountAction();
  if (!gate.ok) return gate;
  if (typeof input?.name !== "string" || !(TOKEN_EXPIRY_CHOICES as readonly string[]).includes(input.expiry)) {
    return { ok: false, error: "invalid_field" };
  }

  let created;
  try {
    created = await createApiToken({
      userId: gate.identity.userId,
      name: input.name,
      readOnly: Boolean(input.readOnly),
      expiry: input.expiry as TokenExpiryChoice,
    });
  } catch (err) {
    console.error("[account] creating a token failed", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "failed" };
  }
  if (!created.ok) return { ok: false, error: created.reason };

  const { summary } = created;
  console.info(`[account] token ${displayPrefix(summary.prefix)} created`);
  const warning = await audit(gate.identity.userId, "token.created", "api_token", summary.id, {
    kind: "token",
    name: summary.name,
    prefix: summary.prefix,
    readOnly: summary.readOnly,
    expiresAt: summary.expiresAt ? summary.expiresAt.toISOString() : null,
  });
  return { ok: true, token: created.token, summary, ...(warning ? { warning } : {}) };
}

export async function revokeToken(tokenId: string): Promise<RevokeResult> {
  const gate = await authorizeAccountAction();
  if (!gate.ok) return gate;
  if (typeof tokenId !== "string") return { ok: false, error: "not_found" };

  let result;
  try {
    result = await revokeApiToken(gate.identity.userId, tokenId);
  } catch (err) {
    console.error("[account] revoking a token failed", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return { ok: false, error: result.reason };

  console.info(`[account] token ${displayPrefix(result.summary.prefix)} revoked`);
  const warning = await audit(gate.identity.userId, "token.revoked", "api_token", result.summary.id, {
    kind: "token",
    name: result.summary.name,
    prefix: result.summary.prefix,
  });
  return { ok: true, ...(warning ? { warning } : {}) };
}

export async function revokeApp(clientId: string): Promise<RevokeResult> {
  const gate = await authorizeAccountAction();
  if (!gate.ok) return gate;
  if (typeof clientId !== "string" || !clientId || clientId.length > 200) return { ok: false, error: "not_found" };

  let result;
  try {
    result = await revokeConnectedApp(gate.identity.userId, clientId);
  } catch (err) {
    console.error("[account] revoking a connected app failed", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return { ok: false, error: result.reason };

  const warning = await audit(gate.identity.userId, "token.revoked", "oauth_client", clientId, {
    kind: "oauth",
    name: result.name,
  });
  return { ok: true, ...(warning ? { warning } : {}) };
}

/** Record one event; a failure is the `audit_unavailable` warning, never a throw. */
export async function audit(
  actorUserId: string,
  action: "token.created" | "token.revoked",
  subjectType: string,
  subjectId: string,
  detail: Record<string, unknown>
): Promise<AccountActionWarning | undefined> {
  try {
    await recordAuditEvent({ actorUserId, action, subjectType, subjectId, detail });
    return undefined;
  } catch (err) {
    console.error(`[account] ${action} landed but was not audited`, err instanceof Error ? err.message : "unknown error");
    return "audit_unavailable";
  }
}
