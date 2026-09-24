import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { OAuthConsent } from "../../../components/account/OAuthConsent";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { oauthClientName } from "../../../lib/data/api-tokens";
import { siteConfig } from "../../../lib/site-config";
import { decideConsentAction } from "./actions";
import "../../../styles/account.css";

/**
 * `/oauth/consent` — "*Claude* wants to access MakerLab as *you*" (MCP access
 * spec §3.4). The `mcp` plugin sends every authorization here (the auth route
 * forces `prompt=consent`), with a one-time `consent_code`. The page names the
 * app as it registered itself and the role it would act with, and offers
 * read-only. Nothing is granted until Allow; Deny sends the browser back to the
 * app with `access_denied`.
 */

export const metadata = {
  title: `Connect an app — ${siteConfig.name}`,
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OAuthConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <Suspense fallback={<p>{t("loading")}</p>}>
          <Consent searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}

async function Consent({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  const tRoles = await getTranslations("admin.roles");
  const params = await searchParams;
  const consentCode = typeof params.consent_code === "string" ? params.consent_code : "";
  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const identity = await resolveIdentityFromHeaders();

  if (identity.role === "anonymous") {
    return (
      <>
        <h1>{t("consentTitleGeneric")}</h1>
        <p>{t("consentSignedOut")}</p>
      </>
    );
  }
  if (!consentCode || !clientId) {
    return (
      <>
        <h1>{t("consentTitleGeneric")}</h1>
        <p>{t("expired")}</p>
      </>
    );
  }

  const registered = await oauthClientName(clientId).catch(() => undefined);
  if (registered === undefined) {
    return (
      <>
        <h1>{t("consentTitleGeneric")}</h1>
        <p>{t("expired")}</p>
      </>
    );
  }
  const client = (registered || t("unknownClient")).slice(0, 80);

  return (
    <>
      <h1>{t("consentTitle", { client })}</h1>
      <p>{t("consentBody", { role: tRoles(identity.role), name: identity.name || identity.email || "" })}</p>
      <p>{t("consentSafety")}</p>
      <OAuthConsent consentCode={consentCode} action={decideConsentAction} />
    </>
  );
}
