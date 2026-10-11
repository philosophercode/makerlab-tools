import type { Role } from "../auth/roles";

/**
 * Demo admin mode (demo admin spec 2026-10-11): while `DEMO_ADMIN=1`, a
 * visitor nobody is signed in as is the demo identity — they see the admin
 * surface as a director does, and may add equipment and report a problem,
 * nothing else.
 *
 * Read at **call time**, like every env switch in `lib/auth/`, so turning it
 * off is a redeploy with the variable removed and tests can `vi.stubEnv`.
 * Only `1` or `true` turns it on: a typo leaves the app exactly as it was.
 *
 * Client-safe: in a browser bundle `process.env.DEMO_ADMIN` is undefined, so
 * this answers false there — the browser learns the role from
 * `/api/identity`, never from this.
 */
export function demoAdminEnabled(): boolean {
  const raw = (process.env.DEMO_ADMIN || "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** The display name the demo identity carries: the header, a ticket's reporter. */
export const DEMO_ADMIN_NAME = "Demo visitor";

/**
 * The one `user` row the demo's writes are attributed to (`actor.ts` makes
 * sure it exists). Here, not there, so the client-safe intake rules can ask
 * {@link isDemoOwned} without importing the database.
 */
export const DEMO_ACTOR_ID = "demo-admin-actor";

/** True when `item` was added by the demo — the only pending items the demo may work or publish. */
export function isDemoOwned(item: { createdBy: string | null }): boolean {
  return item.createdBy === DEMO_ACTOR_ID;
}

/** True when `subject` is the demo identity. */
export function isDemoAdmin(subject: { role: Role | null | undefined } | null | undefined): boolean {
  return subject?.role === "demo_admin";
}

/**
 * True for demo traffic: a demo pass (demo pass spec 2026-10-07) or the demo
 * identity. Its tickets land flagged `demo` and its chat turns count in the
 * `demo` audience, out of the lab's own numbers.
 */
export function isDemoTraffic(subject: { role: Role | null | undefined; demoPass?: unknown } | null | undefined): boolean {
  return Boolean(subject?.demoPass) || isDemoAdmin(subject);
}

/**
 * True when nobody is signed in — anonymous, or the demo identity, which is
 * also nobody. What "offer sign-in" and "read a demo pass" ask.
 */
export function hasNoSession(subject: { role: Role | null | undefined } | null | undefined): boolean {
  return subject?.role === "anonymous" || subject?.role === "demo_admin";
}
