import "server-only";

import { DbUnavailableError } from "../db/client";
import { getClientIp } from "../rate-limit";
import { getAuth } from "./config";
import { isAllowedEmail, storedRoleOr, type Role } from "./roles";
import { isSuperAdminFloor } from "./super-admins";

/**
 * `resolveIdentity(req)` — the one module everything else uses to learn who is
 * making a request (data platform design spec §3.4).
 *
 * Since Phase 4 this is a thin wrapper over `auth.api.getSession()`, which
 * reads the session **row** the cookie's token addresses. That is the whole
 * point: the role is looked up per request, so a change made on `/admin/users`
 * lands on the person's next page load and a ban takes effect immediately.
 * Before Phase 4 the identity travelled inside a self-describing signed cookie
 * and a role change waited 30 days for it to expire.
 *
 * Identity is **context, not a capability**: it is resolved once per request and
 * handed to whatever needs it. Nothing here is an authorization decision —
 * those are `can()` calls against the declaration in `permissions.ts`.
 *
 * **It never throws.** No cookie, an expired or revoked session, a tampered
 * signature, a banned user, an address outside the domain, or a database that
 * cannot be reached — all of them yield the anonymous identity, because
 * anonymous is a first-class state and not a failure. A public page must not
 * 500 because a session lookup did (Article 4).
 */

export interface Identity {
  role: Role;
  /** `user.id`, or null when anonymous. */
  userId: string | null;
  email: string | null;
  name: string | null;
  /** Stable key for rate limiting: user id when signed in, hashed IP otherwise. */
  rateLimitKey: string;
}

export type { Role };

/**
 * One session lookup per request, not one per caller.
 *
 * The spec suggested React's `cache()`. It only memoizes inside a React render
 * scope: in a Route Handler and under Vitest it silently does nothing, which
 * would turn a route that asks three times into three database round trips. A
 * `WeakMap` keyed by the `Request` is deterministic everywhere and is collected
 * with the request itself.
 */
const perRequest = new WeakMap<Request, Promise<Identity>>();

/** Resolve a request to an {@link Identity}. Never rejects. */
export function resolveIdentity(req: Request): Promise<Identity> {
  const memoized = perRequest.get(req);
  if (memoized) return memoized;
  const promise = resolveUncached(req);
  perRequest.set(req, promise);
  return promise;
}

async function resolveUncached(req: Request): Promise<Identity> {
  try {
    const auth = await getAuth();
    // No `AUTH_SECRET`: sign-in is not set up, so nobody is signed in. That is
    // the correct degraded behaviour, not an error (Article 4).
    if (!auth) return anonymousIdentity(req);

    const result = await auth.api.getSession({ headers: toHeaders(req.headers) });
    const identity = identityFromSession(result);
    return identity ?? anonymousIdentity(req);
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    if (err instanceof DbUnavailableError) {
      // Neon is configured but unreachable. Serving the catalogue anonymously
      // is right; 500ing a public page because the session store blinked is not.
      console.warn("[auth] session store unavailable, treating as anonymous", err);
    } else {
      // A silently anonymous population is a symptom worth seeing.
      console.warn("[auth] identity resolution failed, treating as anonymous", err);
    }
    return anonymousIdentity(req);
  }
}

/**
 * The same, for server components, which have no `Request` to hand.
 *
 * Not memoized: `next/headers` returns a fresh object per call, so there is
 * nothing stable to key on. Server components should resolve once in the page
 * or layout and pass the result down, which is what `/admin/*` does.
 */
export async function resolveIdentityFromHeaders(): Promise<Identity> {
  try {
    const auth = await getAuth();
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    if (!auth) return anonymousIdentityFromHeaders(requestHeaders);

    const result = await auth.api.getSession({ headers: toHeaders(requestHeaders) });
    const identity = identityFromSession(result);
    return identity ?? anonymousIdentityFromHeaders(requestHeaders);
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    console.warn("[auth] identity resolution failed, treating as anonymous", err);
    return systemAnonymousIdentity();
  }
}

/** What Better Auth hands back. Typed structurally so no library type leaks out. */
interface SessionResult {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
    banned?: boolean | null;
  };
}

/**
 * Turn a resolved session into an {@link Identity}, or null when it must not
 * count as one. Four ways it must not:
 *
 * - **No session.** Nobody is signed in.
 * - **Out of domain.** The create hook refuses such a row, so one existing is a
 *   bug, a restored backup, or a reconfigured domain — never a reason to trust it.
 * - **Banned**, unless the floor names them. The person still holds a valid
 *   cookie; a ban has to bite on the next request, which is only true if it is
 *   checked on every one.
 * - **A role outside the vocabulary**, which `storedRoleOr` maps to anonymous.
 */
function identityFromSession(result: SessionResult | null | undefined): Identity | null {
  const user = result?.user;
  if (!user) return null;
  if (!isAllowedEmail(user.email)) return null;

  // The floor (§3.4): a listed address resolves `super_admin` whatever its row
  // says, so a mistaken demotion or ban cannot lock the lab out of its own
  // admin surface. It is the only place the environment still names a role.
  //
  // **Read before the ban check, not after, and that ordering is the whole
  // point.** `banned` is part of what "whatever its row says" means: a floor
  // address whose row is banned used to resolve anonymous, which made the
  // environment variable a recovery for exactly half of what this module and
  // `super-admins.ts` both promise. The app refuses to ban a floor address
  // (`app/admin/users/actions.ts`), so a banned one means a restored backup, a
  // manual `UPDATE`, or an address added to the list after the ban — none of
  // which delete the person's sessions, so the session they still hold now
  // resolves and `/admin/users` opens.
  //
  // It does not rescue a sign-in: the admin plugin refuses to create a session
  // for a banned row (`session.create.before`, thrown as `BANNED_USER`), and
  // that hook runs ahead of anything this app can register. What closes the
  // gap is `reconcileSuperAdminFloor`, which lifts the ban off the row on the
  // first write the recovered director performs — after which the row and the
  // running app agree again and an ordinary sign-in works.
  const onFloor = isSuperAdminFloor(user.email);
  if (user.banned && !onFloor) return null;

  const role = onFloor ? "super_admin" : storedRoleOr(user.role);
  if (role === "anonymous") return null;

  return {
    role,
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    rateLimitKey: `user:${user.id}`,
  };
}

/** The anonymous identity for a request, keyed by a hash of its client IP. */
export async function anonymousIdentity(req: Request): Promise<Identity> {
  let ip = "unknown";
  try {
    ip = getClientIp(req);
  } catch (err) {
    // A request without usable headers still gets a (shared) bucket.
    if (isFrameworkSignal(err)) throw err;
  }
  return anonymousFor(ip);
}

/** The anonymous identity for a server component's headers. */
async function anonymousIdentityFromHeaders(headers: {
  get(name: string): string | null;
}): Promise<Identity> {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : headers.get("x-real-ip") || "unknown";
  return anonymousFor(ip);
}

async function anonymousFor(ip: string): Promise<Identity> {
  return {
    role: "anonymous",
    userId: null,
    email: null,
    name: null,
    rateLimitKey: `ip:${await hashIp(ip)}`,
  };
}

/** The identity used when no request is available (background jobs, tests). */
export function systemAnonymousIdentity(): Identity {
  return {
    role: "anonymous",
    userId: null,
    email: null,
    name: null,
    rateLimitKey: "ip:unknown",
  };
}

/**
 * Better Auth wants a `Headers` carrying the session cookie. This builds a
 * plain one holding exactly that, whatever it is handed.
 *
 * **It used to pass a Route Handler's own `Headers` straight through, and that
 * is not safe.** `auth.api.getSession` copies what it is given
 * (`better-auth/dist/api/dispatch.mjs`: `new Headers(input.headers)`), and a
 * `Request`'s headers are a *guarded* list. Copying one whose `content-type`
 * was set implicitly by its body — which is every `multipart/form-data`
 * request, so every upload — can drop `cookie` from the copy. The session then
 * resolves to anonymous for somebody who is plainly signed in, silently,
 * because `resolveIdentity` treats "no session" as a first-class state rather
 * than an error. It is observable under the test harness and depends on the
 * runtime's `fetch` implementation, which is not a thing to be at the mercy of.
 *
 * The cookie is all `getSession` reads — `requestHeaders()` in
 * `app/admin/users/actions.ts` says the same and has always done this — so
 * building the object here costs nothing and removes the question.
 */
function toHeaders(source: Headers | { get(name: string): string | null }): Headers {
  const copy = new Headers();
  const cookie = source.get("cookie");
  if (cookie) copy.set("cookie", cookie);
  return copy;
}

/**
 * `sha256(ip + AUTH_SECRET)`, hex. The rate-limit store therefore holds no
 * personal data (spec §8) while still bucketing one visitor to one key.
 *
 * Falls back to a non-cryptographic hash if WebCrypto is unavailable — still no
 * raw IP in the store, and still deterministic, which is what the limiter needs.
 */
export async function hashIp(
  ip: string,
  secret: string = authSecret()
): Promise<string> {
  const input = `${ip}${secret}`;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input)
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return fallbackHash(input);
  }
}

/**
 * Next signals control flow with thrown errors carrying a `digest` — reading
 * request headers during a prerender raises `NEXT_PRERENDER_INTERRUPTED` to mark
 * the route dynamic. Those are not failures and must never be swallowed: doing
 * so would silently prerender a route that has to run per request.
 */
function isFrameworkSignal(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

/** FNV-1a, used only when WebCrypto is missing. */
function fallbackHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * `AUTH_SECRET`, read at call time. Absent in local/mock deployments, where no
 * session can exist and everyone is anonymous — which is the correct degraded
 * behaviour, not an error.
 */
export function authSecret(): string {
  return process.env.AUTH_SECRET || "";
}
