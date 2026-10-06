import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { OAuthConsent } from "../../../components/account/OAuthConsent";
import { EmptyState } from "../../../components/system/EmptyState";
import { Prose, PublicPage } from "../../../components/system/PublicPage";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { pendingConsentFor } from "../../../lib/account/oauth-consent";
import { oauthClientName } from "../../../lib/data/api-tokens";
import { decideConsentAction } from "./actions";

/**
 * `/oauth/consent` — "*Claude* wants to access MakerLab as *you*" (MCP access
 * spec §3.4). The `mcp` plugin sends every authorization here (the auth route
 * forces `prompt=consent`), with a one-time `consent_code`. The page names the
 * app as it registered itself and the role it would act with, and offers
 * read-only. Nothing is granted until Allow; Deny sends the browser back to the
 * app with `access_denied`.
 */

export const metadata = {
  title: "Connect an app",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OAuthConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  return (
    <Suspense fallback={<p className="px-4 pt-8 text-sm text-muted-foreground sm:px-8">{t("loading")}</p>}>
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

async function Consent({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  const tRoles = await getTranslations("admin.roles");
  const params = await searchParams;
  const consentCode = typeof params.consent_code === "string" ? params.consent_code : "";
  const identity = await resolveIdentityFromHeaders();

  const crumbs = [{ label: t("eyebrow") }];
  const refusal = (sentence: string) => (
    <PublicPage width="narrow" crumbs={crumbs} title={t("consentTitleGeneric")}>
      <EmptyState className="mt-4">{sentence}</EmptyState>
    </PublicPage>
  );

  if (identity.role === "anonymous") return refusal(t("consentSignedOut"));
  // The client and where the code goes come from the pending authorization
  // the consent code names, never from the query string (security fix
  // 2026-10-05).
  const pending = await pendingConsentFor(consentCode, identity.userId);
  if (!pending) return refusal(t("expired"));

  const registered = await oauthClientName(pending.clientId).catch(() => undefined);
  if (registered === undefined) return refusal(t("expired"));
  const client = (registered || t("unknownClient")).slice(0, 80);

  return (
    <PublicPage width="narrow" crumbs={crumbs} title={t("consentTitle", { client })}>
      <Prose className="pt-2">
        <p>{t("consentBody", { role: tRoles(identity.role), name: identity.name || identity.email || "" })}</p>
        <p>
          {t.rich("consentRedirect", {
            host: pending.redirectHost,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p>{t("consentSafety")}</p>
      </Prose>
      <OAuthConsent consentCode={consentCode} action={decideConsentAction} />
    </PublicPage>
  );
}
