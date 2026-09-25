import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "../../../components/account/ConnectedApps";
import { TokenManager } from "../../../components/account/TokenManager";
import { toConnectedAppRow, toTokenRow } from "../../../lib/account/token-rows";
import { authBaseUrl } from "../../../lib/auth/config";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { listApiTokens, listConnectedApps } from "../../../lib/data/api-tokens";
import { siteConfig } from "../../../lib/site-config";
import { createTokenAction, revokeAppAction, revokeTokenAction } from "./actions";
import "../../../styles/account.css";

/**
 * `/account/tokens` — "Connect an AI assistant" (MCP access spec §5.1, §6).
 *
 * Token management. The addresses, the sign-in setup for each client and the
 * tool list moved to the public `/mcp` page (amendment 2026-09-25), which this
 * page links to first. Open to anybody; a visitor who is not signed in is told
 * a token needs sign-in. A signed-in person gets the token list, the create
 * form, the one-time reveal with ready-to-paste setup, and their connected apps
 * (OAuth grants). Reached from the profile menu.
 *
 * Reads the session, so everything that depends on it sits inside a Suspense
 * boundary; the shell above it stays static under `cacheComponents`.
 */

export const metadata = {
  title: `Connect an AI assistant — ${siteConfig.name}`,
};

export default async function AccountTokensPage() {
  const t = await getTranslations("account");
  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("lede")}</p>
        <p>
          {t("mcpPageBody")} <Link href="/mcp">{t("mcpPageLink")}</Link>
        </p>
        <Suspense fallback={<p>{t("loading")}</p>}>
          <AccountTokens />
        </Suspense>
      </section>
    </main>
  );
}

async function AccountTokens() {
  const t = await getTranslations("account");
  const identity = await resolveIdentityFromHeaders();
  const baseUrl = authBaseUrl();

  if (identity.role === "anonymous" || !identity.userId) {
    return <p className="account-status">{t("signedOut")}</p>;
  }

  const [tokens, apps] = await Promise.all([
    listApiTokens(identity.userId).catch(() => null),
    listConnectedApps(identity.userId).catch(() => null),
  ]);

  return (
    <>
      <section className="account-section">
        <h2>{t("tokens.heading")}</h2>
        <p>{t("tokens.lede")}</p>
        {tokens === null ? (
          <p className="account-status is-error">{t("unavailable")}</p>
        ) : (
          <TokenManager
            initialTokens={tokens.map(toTokenRow)}
            baseUrl={baseUrl}
            createAction={createTokenAction}
            revokeAction={revokeTokenAction}
          />
        )}
      </section>
      {apps === null ? null : <ConnectedApps initialApps={apps.map(toConnectedAppRow)} revokeAction={revokeAppAction} />}
      <section className="account-section">
        <h2>{t("safetyHeading")}</h2>
        <p>{t("safetyBody")}</p>
      </section>
    </>
  );
}
