import type { Role } from "../auth/roles";

/**
 * Which demo admin mode is on (demo admin spec 2026-10-11, and its amendment
 * "A read-only public admin", 2026-10-22):
 *
 * - `"booth"` (`DEMO_ADMIN=1` or `true`): a visitor nobody is signed in as is
 *   the demo identity — they see the admin surface as a director does, and may
 *   add equipment and report a problem, nothing else. For a supervised booth.
 * - `"view"` (`DEMO_ADMIN=view`): the same identity and the same pages, but
 *   `can()` grants it nothing, so nothing can be added, researched or
 *   published. For a site shared openly.
 * - `"off"`: anything else, unset included. A typo leaves the app as it was.
 *
 * Read at **call time**, like every env switch in `lib/auth/`, so turning it
 * off is a redeploy with the variable removed and tests can `vi.stubEnv`.
 *
 * Client-safe: in a browser bundle `process.env.DEMO_ADMIN` is undefined, so
 * this answers `"off"` there — the browser learns the role from
 * `/api/identity`, never from this.
 */
export function demoAdminMode(): "off" | "view" | "booth" {
  const raw = (process.env.DEMO_ADMIN || "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return "booth";
  if (raw === "view") return "view";
  return "off";
}

/** True in either demo mode: a visitor with no session is the demo identity. */
export function demoAdminEnabled(): boolean {
  return demoAdminMode() !== "off";
}

/** True when the demo is the read-only public one (`DEMO_ADMIN=view`): it may look, never write. */
export function demoAdminReadOnly(): boolean {
  return demoAdminMode() === "view";
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
