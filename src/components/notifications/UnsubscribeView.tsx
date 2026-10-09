import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Prose, PublicPage } from "../system/PublicPage";
import { siteConfig } from "../../lib/site-config";

/**
 * What `/notifications/unsubscribe` shows (email notifications spec §6): a
 * `PublicPage` in the narrow column, one decision. Everything is a prop, so a
 * component test mounts each state.
 *
 * The **Turn off** button is a plain HTML form POST to
 * `/api/notifications/unsubscribe` with the token in its URL and
 * `from=page`, so it works before hydration and without JavaScript; the route
 * answers with a redirect to the done state.
 */

export type UnsubscribeStops = "ticketFiled" | "maintenanceDue";

export type UnsubscribeState =
  | { kind: "confirm"; stops: UnsubscribeStops; token: string; failed?: boolean }
  | { kind: "done"; stops: UnsubscribeStops }
  | { kind: "invalid" }
  | { kind: "rate_limited" };

export function UnsubscribeView({ state }: { state: UnsubscribeState }) {
  const t = useTranslations("unsubscribe");
  const crumbs = [{ label: t("eyebrow") }];
  const home = (
    <Button asChild variant="quiet">
      <Link href="/">{t("home", { site: siteConfig.name })}</Link>
    </Button>
  );

  if (state.kind === "rate_limited") {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("rateLimitedTitle")}>
        <Prose className="pt-2">
          <p>{t("rateLimitedBody")}</p>
        </Prose>
        <div className="pt-6">{home}</div>
      </PublicPage>
    );
  }

  if (state.kind === "invalid") {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("invalidTitle")}>
        <Prose className="pt-2">
          <p>{t("invalidBody")}</p>
        </Prose>
        <div className="pt-6">{home}</div>
      </PublicPage>
    );
  }

  if (state.kind === "done") {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("doneTitle")}>
        <Prose className="pt-2">
          <p role="status">{t(`done.${state.stops}`)}</p>
          <p>{t("doneUndo")}</p>
        </Prose>
        <div className="pt-6">{home}</div>
      </PublicPage>
    );
  }

  return (
    <PublicPage width="narrow" crumbs={crumbs} title={t("confirmTitle")}>
      <Prose className="pt-2">
        <p>{t(`confirm.${state.stops}`)}</p>
        <p>{t("confirmScope")}</p>
      </Prose>
      {state.failed ? (
        <p role="alert" className="pt-4 text-sm text-destructive">
          {t("failed")}
        </p>
      ) : null}
      <form
        method="post"
        action={`/api/notifications/unsubscribe?t=${encodeURIComponent(state.token)}`}
        className="flex flex-wrap items-center gap-3 pt-6"
      >
        <input type="hidden" name="from" value="page" />
        <Button type="submit" variant="default">
          {t("turnOff")}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">{t("keep")}</Link>
        </Button>
      </form>
    </PublicPage>
  );
}
