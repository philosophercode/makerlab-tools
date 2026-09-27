import "server-only";

import { getAuth, READ_ONLY_SCOPE } from "../auth/config";
import { oauthClientName } from "../data/api-tokens";
import { audit, authorizeAccountAction, type AccountActionError, type AccountActionWarning } from "./token-actions";

/**
 * The OAuth consent page's decision (MCP access spec §3.4): "*Claude* wants to
 * access MakerLab as *you*", Allow or Deny, with read-only as an option.
 *
 * The `mcp` plugin parks an authorization that needs consent as a
 * verification row keyed by a one-time consent code, and finishes it through
 * its `oauth2/consent` endpoint. This module is the server side of the page's
 * buttons:
 *
 * 1. **Gate** — signed in, rate-limited (`authorizeAccountAction`).
 * 2. **Ownership** — the pending authorization must belong to the person
 *    deciding it. A consent code from somebody else's screen is "expired".
 * 3. **Read-only** — when chosen, the `read_only` scope is added to the
 *    pending authorization before it is accepted, so every access token the
 *    grant issues carries it and `resolveMcpCaller` withholds write tools.
 *    A grant never carries more than the role; this only ever narrows it.
 * 4. **Finish** through the plugin (`auth.api.oAuthConsent`), and audit an
 *    accepted grant as `token.created` with `detail.kind: "oauth"`.
 */

export type ConsentResult =
  | { ok: true; redirectURI: string; warning?: AccountActionWarning }
  | { ok: false; error: AccountActionError | "expired" };

interface PendingAuthorization {
  clientId: string;
  userId: string;
  scope: string[];
  requireConsent?: boolean;
}

export async function decideConsent(
  input: { consentCode: string; accept: boolean; readOnly: boolean },
  requestHeaders: Headers
): Promise<ConsentResult> {
  const gate = await authorizeAccountAction();
  if (!gate.ok) return gate;
  if (typeof input?.consentCode !== "string" || !input.consentCode || input.consentCode.length > 200) {
    return { ok: false, error: "expired" };
  }

  const auth = await getAuth();
  if (!auth) return { ok: false, error: "failed" };

  try {
    const context = await auth.$context;
    const verification = await context.internalAdapter.findVerificationValue(input.consentCode);
    if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) {
      return { ok: false, error: "expired" };
    }
    const pending = JSON.parse(verification.value) as PendingAuthorization;
    if (pending.userId !== gate.identity.userId || !pending.requireConsent) return { ok: false, error: "expired" };

    if (input.accept && input.readOnly && !pending.scope.includes(READ_ONLY_SCOPE)) {
      await context.internalAdapter.updateVerificationByIdentifier(input.consentCode, {
        value: JSON.stringify({ ...pending, scope: [...pending.scope, READ_ONLY_SCOPE] }),
      });
    }

    const result = (await auth.api.oAuthConsent({
      body: { accept: Boolean(input.accept), consent_code: input.consentCode },
      headers: requestHeaders,
    })) as { redirectURI?: string } | null;
    if (!result?.redirectURI) return { ok: false, error: "failed" };

    if (!input.accept) return { ok: true, redirectURI: result.redirectURI };

    const name = (await oauthClientName(pending.clientId).catch(() => null)) ?? null;
    const warning = await audit(gate.identity.userId, "token.created", "oauth_client", pending.clientId, {
      kind: "oauth",
      name,
      readOnly: Boolean(input.readOnly) || pending.scope.includes(READ_ONLY_SCOPE),
    });
    return { ok: true, redirectURI: result.redirectURI, ...(warning ? { warning } : {}) };
  } catch (err) {
    console.error("[oauth] consent failed", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "failed" };
  }
}
