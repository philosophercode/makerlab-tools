import { Suspense } from "react";
import { RefusedSignInView } from "../../../components/account/RefusedSignIn";
import { allowedEmailDomain } from "../../../lib/auth/roles";
import { readRefusedSignIn } from "../../../lib/auth/refused-sign-in-cookie";

/**
 * `/auth/blocked` — where a blocked address lands when it tries to sign up
 * (auth spec amendment 2026-09-25, "Remove a person, and block an address").
 * `BLOCKED_SIGN_IN_PATH` in `lib/auth/blocked-sign-in.ts` points here.
 *
 * The twin of `/auth/rejected`, in its shape and under the same rule: **it must
 * not dead-end.** No account was created. It names the refused address and
 * offers another Google account (amendment 2026-10-07); the catalogue and the
 * assistant are open to anonymous visitors, and the page says so.
 */

export const metadata = {
  title: "Sign-in",
};

export default function AuthBlockedPage() {
  const domain = allowedEmailDomain();
  return (
    <Suspense fallback={<RefusedSignInView reason="blocked" refused={null} domain={domain} />}>
      <Blocked domain={domain} />
    </Suspense>
  );
}

async function Blocked({ domain }: { domain: string }) {
  const refused = await readRefusedSignIn();
  return <RefusedSignInView reason="blocked" refused={refused} domain={domain} />;
}
