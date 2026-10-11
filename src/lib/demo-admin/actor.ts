import "server-only";

import type { Identity } from "../auth/identity";
import { getDb } from "../db/client";
import { user } from "../db/schema/index";
import { DEMO_ACTOR_ID, DEMO_ADMIN_NAME, isDemoAdmin, isDemoOwned } from "./config";

/**
 * Who the demo's writes are attributed to (demo admin spec 2026-10-11 §5).
 *
 * Adding equipment records a person at every step — the pending item's
 * `created_by`, the upload's `uploaded_by`, the research allowance's ledger,
 * the approval's audit event — and each is a foreign key to `user`. So the
 * demo has **one** row of its own, shared by every demo visitor:
 *
 * - **It holds nothing.** Its stored role is `user`, the least there is; the
 *   demo's grants come from the identity's `demo_admin` role, never this row.
 * - **Nobody can be it.** Its address is on `.invalid` (RFC 2606), outside the
 *   sign-in domain, so `evaluateUser` refuses any session or token that ever
 *   named it, and Google cannot sign in as it. It has no `account` row.
 * - **It is only attached where the demo may write.** The demo identity
 *   carries `userId: null`, so every path that needs a person refuses it; the
 *   intake paths the demo may use call {@link withDemoActor} themselves.
 *
 * The row is created on first use (an idempotent insert), not by a migration:
 * a deployment that never turns the demo on never has it, and one a super
 * admin removed comes back on the next demo write.
 */
export { DEMO_ACTOR_ID, isDemoOwned };
export const DEMO_ACTOR_EMAIL = "demo-admin@demo.invalid";

/** Make sure the demo actor's row exists. Answers its id, or null when it could not. */
export async function ensureDemoActor(): Promise<string | null> {
  try {
    const db = await getDb();
    await db
      .insert(user)
      .values({
        id: DEMO_ACTOR_ID,
        email: DEMO_ACTOR_EMAIL,
        name: DEMO_ADMIN_NAME,
        emailVerified: false,
        role: "user",
        // Never signed in, and never will.
        firstSignedInAt: null,
      })
      .onConflictDoNothing({ target: user.id });
    return DEMO_ACTOR_ID;
  } catch (err) {
    // No row, no write: the caller refuses as it would for anyone with no id.
    console.error("[demo-admin] could not ensure the demo actor", err);
    return null;
  }
}

/**
 * `identity` with the demo actor attached when it is the demo identity, and
 * unchanged otherwise. A real person's identity is never touched; the demo's
 * role stays `demo_admin`, so `can()` still decides exactly what it did.
 */
export async function withDemoActor(identity: Identity): Promise<Identity> {
  if (!isDemoAdmin(identity)) return identity;
  const userId = await ensureDemoActor();
  return userId ? { ...identity, userId } : identity;
}
