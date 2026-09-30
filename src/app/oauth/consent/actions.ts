"use server";

import { decideConsent, type ConsentResult } from "../../../lib/account/oauth-consent";

/**
 * The consent page's one server action (MCP access spec §3.4). It gates
 * itself in `lib/account/oauth-consent.ts`: signed in, rate-limited, and the
 * pending authorization must be the caller's own.
 */
export async function decideConsentAction(input: {
  consentCode: string;
  accept: boolean;
  readOnly: boolean;
}): Promise<ConsentResult> {
  const { headers } = await import("next/headers");
  const incoming = await headers();
  // Only the cookie: the session is all the plugin's consent endpoint reads.
  const forwarded = new Headers();
  const cookie = incoming.get("cookie");
  if (cookie) forwarded.set("cookie", cookie);
  return decideConsent(input, forwarded);
}
