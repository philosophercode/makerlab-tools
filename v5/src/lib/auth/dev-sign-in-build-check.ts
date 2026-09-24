/**
 * The build-time half of "development-only sign-in can never be on in
 * production" (auth spec amendment 2026-09-24). Called from `next.config.ts`.
 *
 * The route and the Better Auth endpoint already refuse unless `NODE_ENV` is
 * `development`, so `DEV_AUTO_SIGN_IN` in a production build is inert. It is
 * still a mistake worth stopping loudly where it matters:
 *
 * - **On Vercel it fails the build.** A Vercel project with the variable set is
 *   a misconfiguration somebody should remove, not something to ship.
 * - **In a local production build it warns.** `next build` reads `.env.local`,
 *   so the owner's own opt-in would otherwise break `npm run build` and the
 *   E2E servers for no gain — the flag does nothing there.
 *
 * No imports, so `next.config.ts` can load it without pulling the app in.
 */
export type DevSignInBuildVerdict = "ok" | "warn" | "fail";

export function devSignInBuildVerdict(env: Record<string, string | undefined>): DevSignInBuildVerdict {
  if (!env.DEV_AUTO_SIGN_IN) return "ok";
  if (env.VERCEL) return "fail";
  if (env.NODE_ENV === "production") return "warn";
  return "ok";
}

export const DEV_SIGN_IN_BUILD_MESSAGE =
  "DEV_AUTO_SIGN_IN is set. Development-only sign-in must never be configured on a deployment — remove it from this environment.";
