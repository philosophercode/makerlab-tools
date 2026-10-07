import "server-only";

import { cookies } from "next/headers";

import { decodeRefusedSignIn, REFUSED_SIGN_IN_COOKIE, type RefusedSignIn } from "./refused-sign-in";

/**
 * The refused sign-in this browser's cookie names, for the refusal pages
 * (auth spec amendment 2026-10-07). `null` when there is none, it has expired,
 * or this app did not sign it. Reading cookies makes the caller dynamic, so the
 * pages call it inside a Suspense boundary.
 */
export async function readRefusedSignIn(): Promise<RefusedSignIn | null> {
  try {
    const jar = await cookies();
    return decodeRefusedSignIn(jar.get(REFUSED_SIGN_IN_COOKIE)?.value, process.env.AUTH_SECRET);
  } catch {
    return null;
  }
}
