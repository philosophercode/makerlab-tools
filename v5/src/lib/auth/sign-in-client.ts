import type { Role } from "./roles";

/**
 * The browser side of sign-in (auth design spec 2026-07-29 §5, §6).
 *
 * Deliberately three small functions rather than a hook or a client SDK: the
 * header and the chat both need the same three moves — ask who I am, start the
 * Google flow, end the session — and duplicating a `fetch` in two components is
 * how the two surfaces drift apart.
 *
 * Nothing here throws. Every failure resolves to "nobody is signed in", which is
 * the same state a signed-out visitor is in and a state the whole app already
 * handles: browsing and asking questions never require an account.
 */

/** Better Auth's social sign-in endpoint. It answers `{ url }`, it does not redirect. */
export const SIGN_IN_ENDPOINT = "/api/auth/sign-in/social";

/** Better Auth's sign-out endpoint. Its after-hook also clears our session cookie. */
export const SIGN_OUT_ENDPOINT = "/api/auth/sign-out";

/** Read-only projection of `resolveIdentity` for the browser. */
export const IDENTITY_ENDPOINT = "/api/identity";

const PROVIDER = "google";

/** What `/api/identity` tells the browser. Deliberately no email — see §8 (PII). */
export interface ClientIdentity {
  role: Role;
  /** Display name from Google, or null when anonymous (or when Google had none). */
  name: string | null;
}

/** True when this identity may show a name and a sign-out control. */
export function isSignedIn(identity: ClientIdentity | null): boolean {
  return Boolean(identity && identity.role !== "anonymous");
}

/** The part of a display name a header should show. "" when there is none. */
export function firstNameOf(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

/**
 * Who the server thinks is calling, or `null` when it cannot say.
 *
 * The header renders inside a statically-shelled layout, so it cannot read the
 * session cookie during render — it asks after mount instead. A failure here is
 * not worth surfacing: the visitor simply sees the sign-in control they would
 * have seen anyway.
 */
export async function fetchIdentity(
  signal?: AbortSignal
): Promise<ClientIdentity | null> {
  try {
    const res = await fetch(IDENTITY_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ClientIdentity> | null;
    if (!body || typeof body.role !== "string") return null;
    return {
      role: body.role as Role,
      name: typeof body.name === "string" && body.name ? body.name : null,
    };
  } catch {
    return null;
  }
}

/**
 * Start the Google flow and hand the browser to Google.
 *
 * `callbackURL` is where the user comes back to — the page they were on, never
 * `/`, which is on the spec's list of things that would embarrass us (§10).
 * Returns `false` when sign-in is not configured or the request failed, so the
 * caller can stop showing a spinner.
 */
export async function startGoogleSignIn(callbackURL: string): Promise<boolean> {
  try {
    const res = await fetch(SIGN_IN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER, callbackURL: callbackURL || "/" }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { url?: string } | null;
    if (!body?.url) return false;
    window.location.assign(body.url);
    return true;
  } catch {
    return false;
  }
}

/**
 * End the session and reload so every server-rendered surface re-resolves.
 *
 * The reload happens even when the request fails: there is nothing useful to
 * say about a failed sign-out, and a reload re-reads whatever the truth is.
 */
export async function signOutAndReload(): Promise<void> {
  try {
    await fetch(SIGN_OUT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    // Ignored on purpose — the reload below reflects whatever actually happened.
  }
  window.location.reload();
}
