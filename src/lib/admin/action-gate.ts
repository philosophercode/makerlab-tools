import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { can, type Permission } from "../auth/permissions";
import { ADMIN_ACTION_TIER, rateLimitAsync } from "../rate-limit";
import type { AdminGateError } from "./action-result";

/**
 * The preamble every admin server action runs before it does anything
 * (spec §8).
 *
 * **A server action is a POST endpoint with a generated name.** It is reachable
 * without ever rendering the page that offers the control, so the page's own
 * gate is evidence of nothing: the identity is resolved here, the limiter runs
 * here, and the permission is checked here. A control hidden in the DOM is
 * hidden for exactly as long as nobody opens the console.
 *
 * Phase 4 wrote this sequence inside `app/admin/users/actions.ts`. Phase 5 adds
 * four surfaces and a dozen more actions, so it moved here with the permission
 * as a parameter — one order of checks, one set of codes, one place to change
 * them. What stayed behind in `/admin/users` is the super-admin floor
 * reconciliation, which is that page's own and must not be generalised: it
 * writes to the caller's row, which is not something a tool edit should do.
 */

/** What the gate answers. A refusal is a value the island can render. */
export type AdminGate =
  | { ok: true; identity: Identity }
  | { ok: false; error: AdminGateError };

/**
 * Resolve the caller, bound their attempts, and check one permission.
 *
 * **The limiter runs before the permission check**, as it does on every route
 * in the app (Article 4, §8): an anonymous prodder must spend their own key
 * rather than discovering that a refusal is free. It is keyed on
 * `rateLimitKey` — the user id when signed in, a hashed IP when not — so one
 * person hammering an action cannot exhaust an admin's allowance.
 *
 * `not_signed_in` and `not_permitted` are told apart on purpose: one is
 * actionable and the other is not, and showing the wrong one is how a page
 * feels broken.
 */
export async function authorizeAdminAction(
  permission: Permission,
  /**
   * An identity the caller already resolved — the MCP route's, from a bearer
   * token (MCP access spec §3.2, `update_ticket`). Omitted, the session cookie
   * on the request is read, as every server action does.
   */
  resolved?: Identity
): Promise<AdminGate> {
  const identity = resolved ?? (await resolveIdentityFromHeaders());

  const { allowed } = await rateLimitAsync(
    `admin-action:${identity.rateLimitKey}`,
    ADMIN_ACTION_TIER
  );
  if (!allowed) return { ok: false, error: "rate_limited" };

  if (identity.role === "anonymous") return { ok: false, error: "not_signed_in" };
  if (!can(identity, permission)) return { ok: false, error: "not_permitted" };

  return { ok: true, identity };
}
