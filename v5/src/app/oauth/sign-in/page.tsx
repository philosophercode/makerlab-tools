import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { OAuthSignIn } from "../../../components/account/OAuthSignIn";
import { AUTH_BASE_PATH } from "../../../lib/auth/config";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { oauthClientName } from "../../../lib/data/api-tokens";
import { siteConfig } from "../../../lib/site-config";
import "../../../styles/account.css";

/**
 * `/oauth/sign-in` — where an MCP client's OAuth authorization sends somebody
 * who is not signed in yet (MCP access spec §3.4; the `mcp` plugin's
 * `loginPage`). The plugin appends the authorization's own query string; this
 * page signs the person in with Google and returns them to that same
 * authorization, which then asks for consent.
 */

export const metadata = {
  title: `Sign in to connect an app — ${siteConfig.name}`,
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OAuthSignInPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <Suspense fallback={<p>{t("loading")}</p>}>
          <SignIn searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}

/** The authorization to resume, rebuilt from the query the plugin passed along. */
function resumeUrlFor(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }
  return `${AUTH_BASE_PATH}/mcp/authorize?${query.toString()}`;
}

async function SignIn({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("account.oauth");
  const params = await searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const registered = clientId ? await oauthClientName(clientId).catch(() => undefined) : undefined;
  const client = (registered || t("unknownClient")).slice(0, 80);
  const resumeUrl = resumeUrlFor(params);
  const identity = await resolveIdentityFromHeaders();

  if (identity.role !== "anonymous") {
    return (
      <>
        <h1>{t("signInTitle", { client })}</h1>
        <p>{t("alreadySignedIn")}</p>
        <p>
          <a className="account-button is-primary" href={resumeUrl}>
            {t("continue")}
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{t("signInTitle", { client })}</h1>
      <p>{t("signInBody", { client, institution: siteConfig.institution })}</p>
      <OAuthSignIn resumeUrl={resumeUrl} />
    </>
  );
}
