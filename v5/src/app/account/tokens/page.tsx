import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "../../../components/account/ConnectedApps";
import { CopyableCode } from "../../../components/account/CopyableCode";
import { SignInSetup } from "../../../components/account/SignInSetup";
import { TokenManager } from "../../../components/account/TokenManager";
import { mcpSnippets } from "../../../lib/account/mcp-snippets";
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
 * Open to anybody: the MCP address and the public, read-only access need no
 * account, so a visitor who is not signed in still gets the addresses and is
 * told a token needs sign-in. **Sign in with Google comes first** — the
 * default for every client that supports OAuth (amendment 2026-09-24) — and
 * personal access tokens are the fallback for clients or scripts that cannot.
 * A signed-in person gets the token list, the create form, the one-time reveal
 * with ready-to-paste setup, and their connected apps (OAuth grants). Reached
 * from the profile menu.
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
  const snippets = mcpSnippets(baseUrl);

  // Sign in with Google first — the default for every client that can (amendment 2026-09-24);
  // browsing without an account next; personal tokens last, as the fallback.
  const endpoints = (
    <>
      <SignInSetup snippets={snippets} />
      <section className="account-section" aria-labelledby="endpoint-heading">
        <h2 id="endpoint-heading">{t("endpointHeading")}</h2>
        <p>{t("endpointBody")}</p>
        <CopyableCode label={t("endpointHeading")} value={snippets.url} />
      </section>
    </>
  );

  if (identity.role === "anonymous" || !identity.userId) {
    return (
      <>
        {endpoints}
        <p className="account-status">{t("signedOut")}</p>
      </>
    );
  }

  const [tokens, apps] = await Promise.all([
    listApiTokens(identity.userId).catch(() => null),
    listConnectedApps(identity.userId).catch(() => null),
  ]);

  return (
    <>
      {endpoints}
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
