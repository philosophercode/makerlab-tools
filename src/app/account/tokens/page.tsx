import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "../../../components/account/ConnectedApps";
import { TokenManager } from "../../../components/account/TokenManager";
import { EmptyState } from "../../../components/system/EmptyState";
import { PageSection, Prose, PublicPage } from "../../../components/system/PublicPage";
import { toConnectedAppRow, toTokenRow } from "../../../lib/account/token-rows";
import { authBaseUrl } from "../../../lib/auth/config";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { listApiTokens, listConnectedApps } from "../../../lib/data/api-tokens";
import { siteConfig } from "../../../lib/site-config";
import { createTokenAction, revokeAppAction, revokeTokenAction } from "./actions";

/**
 * `/account/tokens` — "Connect an AI assistant" (MCP access spec §5.1, §6).
 *
 * Token management. The addresses, the sign-in setup for each client and the
 * tool list moved to the public `/mcp` page (amendment 2026-09-25), which this
 * page links to first. Open to anybody; a visitor who is not signed in is told
 * a token needs sign-in. A signed-in person gets the create form, the one-time
 * reveal with ready-to-paste setup and a setup prompt for their assistant, the
 * token list, and their connected apps (OAuth grants). Reached from the
 * profile menu.
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
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={t("title")} lede={t("lede")}>
      <Prose className="pt-2 text-sm">
        <p>
          {t("mcpPageBody")} <Link href="/mcp">{t("mcpPageLink")}</Link>
        </p>
      </Prose>
      <Suspense fallback={<p className="pt-8 text-sm text-muted-foreground">{t("loading")}</p>}>
        <AccountTokens />
      </Suspense>
    </PublicPage>
  );
}

async function AccountTokens() {
  const t = await getTranslations("account");
  const identity = await resolveIdentityFromHeaders();
  const baseUrl = authBaseUrl();

  if (identity.role === "anonymous" || !identity.userId) {
    return (
      <PageSection id="tokens-heading" title={t("tokens.heading")}>
        <EmptyState>{t("signedOut")}</EmptyState>
      </PageSection>
    );
  }

  const [tokens, apps] = await Promise.all([
    listApiTokens(identity.userId).catch(() => null),
    listConnectedApps(identity.userId).catch(() => null),
  ]);

  return (
    <>
      <PageSection id="tokens-heading" title={t("tokens.heading")} lede={t("tokens.lede")}>
        {tokens === null ? <EmptyState tone="bad">{t("unavailable")}</EmptyState> : null}
      </PageSection>
      {tokens === null ? null : (
        <TokenManager
          initialTokens={tokens.map(toTokenRow)}
          baseUrl={baseUrl}
          createAction={createTokenAction}
          revokeAction={revokeTokenAction}
        />
      )}
      {apps === null ? null : <ConnectedApps initialApps={apps.map(toConnectedAppRow)} revokeAction={revokeAppAction} />}
      <PageSection id="token-safety-heading" title={t("safetyHeading")}>
        <Prose className="text-sm">
          <p>{t("safetyBody")}</p>
        </Prose>
      </PageSection>
    </>
  );
}
