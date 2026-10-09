import { Suspense } from "react";
import { RefusedSignInView } from "../../../components/account/RefusedSignIn";
import { allowedEmailDomain } from "../../../lib/auth/roles";
import { readRefusedSignIn } from "../../../lib/auth/refused-sign-in-cookie";

/**
 * `/auth/rejected` — where a Google account outside the allowed domain lands
 * (auth design spec §5, §6; amendment 2026-10-07). `DOMAIN_REJECTED_PATH` in
 * `lib/auth/config.ts` points here.
 *
 * The one rule for this page: **it must not dead-end.** Someone who just picked
 * the wrong Google account has done nothing wrong and loses nothing. The page
 * names the address that was refused, offers "Use a different Google account"
 * (Google's chooser, after signing this browser out), and links back to the
 * catalog, which is open to anonymous visitors.
 *
 * The address is read from a cookie, which makes the page dynamic, so it sits
 * in a Suspense boundary; the fallback is the same page without the address.
 */

export const metadata = {
  title: "Sign-in",
};

export default function AuthRejectedPage() {
  const domain = allowedEmailDomain();
  return (
    <Suspense fallback={<RefusedSignInView reason="domain" refused={null} domain={domain} />}>
      <Rejected domain={domain} />
    </Suspense>
  );
}

async function Rejected({ domain }: { domain: string }) {
  const refused = await readRefusedSignIn();
  return <RefusedSignInView reason="domain" refused={refused} domain={domain} />;
}
