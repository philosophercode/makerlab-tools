import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { OwnNameEditor } from "../../components/account/OwnNameEditor";
import { EmptyState } from "../../components/system/EmptyState";
import { PageSection, Prose, PublicPage } from "../../components/system/PublicPage";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { siteConfig } from "../../lib/site-config";
import { updateOwnNameAction } from "./actions";

/**
 * `/account` — "Your account": your name, which you may change, and your
 * address, which you may not. Reached from the profile menu. Everybody signed
 * in may rename themselves (`updateOwnName`, audited as `user.name_changed`);
 * a super admin renames anybody else on the People page. A name set here is
 * not overwritten by Google at a later sign-in (`lib/auth/provider-name.ts`).
 *
 * Reads the session, so everything that depends on it sits inside a Suspense
 * boundary; the shell above it stays static under `cacheComponents`, as on
 * `/account/tokens`.
 */

export const metadata = {
  title: `Your account — ${siteConfig.name}`,
};

export default async function AccountPage() {
  const t = await getTranslations("account");
  return (
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={t("profile.title")} lede={t("profile.lede")}>
      <Suspense fallback={<p className="pt-8 text-sm text-muted-foreground">{t("loading")}</p>}>
        <AccountProfile />
      </Suspense>
    </PublicPage>
  );
}

async function AccountProfile() {
  const t = await getTranslations("account.profile");
  const identity = await resolveIdentityFromHeaders();

  if (identity.role === "anonymous" || !identity.userId) {
    return (
      <PageSection id="name-heading" title={t("nameHeading")}>
        <EmptyState>{t("signedOut")}</EmptyState>
      </PageSection>
    );
  }

  return (
    <>
      <PageSection id="name-heading" title={t("nameHeading")} lede={t("nameLede")}>
        <OwnNameEditor name={identity.name || identity.email || ""} action={updateOwnNameAction} />
        <dl className="m-0 mt-2 flex flex-col gap-0.5 text-sm">
          <dt className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("email")}</dt>
          <dd className="m-0 font-mono text-xs">{identity.email}</dd>
          <dd className="m-0 text-xs text-muted-foreground">{t("emailNote")}</dd>
        </dl>
      </PageSection>
      <PageSection id="assistant-heading" title={t("assistantHeading")}>
        <Prose className="text-sm">
          <p>
            {t("assistantBody")} <Link href="/account/tokens">{t("assistantLink")}</Link>
          </p>
        </Prose>
      </PageSection>
    </>
  );
}
