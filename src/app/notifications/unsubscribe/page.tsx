import { Suspense } from "react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { UnsubscribeView, type UnsubscribeState } from "../../../components/notifications/UnsubscribeView";
import { NOTIFICATION_EVENT_DEFS } from "../../../lib/notifications/events";
import { allowUnsubscribeRequest } from "../../../lib/notifications/unsubscribe-limit";
import { unsubscribeSecret, verifyUnsubscribeToken } from "../../../lib/notifications/unsubscribe";

/**
 * `/notifications/unsubscribe?t=<token>` — where an email's "Turn off these
 * emails" link lands (email notifications spec §5.4, §6).
 *
 * **Opening it never changes anything.** Microsoft Safe Links and other
 * scanners fetch every link in a message, so the page only shows what will
 * stop and a **Turn off** button; the button POSTs to
 * `/api/notifications/unsubscribe`, which redirects back here with
 * `state=done`. Works signed out: the signed token names the person and the
 * email, and can only turn it off.
 *
 * States: confirm, done, invalid link, a save that failed, and too many
 * tries (the limiter runs before the token is read).
 */

export const metadata = {
  title: "Email settings",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("unsubscribe");
  return (
    <Suspense fallback={<p className="px-4 pt-8 text-sm text-muted-foreground sm:px-8">{t("loading")}</p>}>
      <Unsubscribe searchParams={searchParams} />
    </Suspense>
  );
}

async function Unsubscribe({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : "";
  const requested = typeof params.state === "string" ? params.state : "";

  let state: UnsubscribeState;
  if (!(await allowUnsubscribeRequest(await headers()))) {
    state = { kind: "rate_limited" };
  } else {
    const claim = verifyUnsubscribeToken(token, unsubscribeSecret());
    if (!claim || requested === "invalid") state = { kind: "invalid" };
    else {
      const stops = NOTIFICATION_EVENT_DEFS[claim.event].stops;
      if (requested === "done") state = { kind: "done", stops };
      else state = { kind: "confirm", stops, token, failed: requested === "failed" };
    }
  }

  return <UnsubscribeView state={state} />;
}
