import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Prose, PublicPage } from "../system/PublicPage";
import { UseDifferentAccount } from "./UseDifferentAccount";
import { siteConfig } from "../../lib/site-config";
import type { RefusedSignIn as Refused } from "../../lib/auth/refused-sign-in";

/**
 * The two refusal pages, `/auth/rejected` (outside the allowed domain) and
 * `/auth/blocked` (an address a super admin blocked). One shape (auth spec §5,
 * amendments 2026-09-25 and 2026-10-07):
 *
 * 1. **Which address, and why, in one line.** On a phone signed into a personal
 *    Gmail the person may not know which account Google used. The address comes
 *    from the short-lived cookie the refusal left (`refused-sign-in.ts`); when
 *    there is none, the line says "This Google account".
 * 2. **Use a different Google account** — the way out that fixes it.
 * 3. **Browse the catalog**, and the reminder that nothing is locked.
 *
 * The rule from the original page stands: it must not dead-end.
 */
export function RefusedSignInView({
  reason,
  refused,
  domain,
}: {
  reason: "domain" | "blocked";
  refused: Refused | null;
  /** The allowed email domain, for the domain refusal's line. */
  domain: string;
}) {
  const t = useTranslations("auth");
  const site = siteConfig.name;
  const institution = siteConfig.institution;
  const address = (chunks: React.ReactNode) => <strong className="font-semibold break-all text-foreground">{chunks}</strong>;

  const title = reason === "domain" ? t("title", { institution }) : t("blockedTitle", { site });
  let line: React.ReactNode;
  if (reason === "domain") {
    line = refused
      ? t.rich("refusedAddress", { email: refused.email, site, institution, domain, address })
      : t("refusedUnknown", { site, institution, domain });
  } else {
    line = refused
      ? t.rich("blockedAddress", { email: refused.email, site, address })
      : t("blockedBody", { site });
  }

  return (
    <PublicPage width="narrow" crumbs={[{ label: t("eyebrow") }]} title={title}>
      <Prose className="pt-2">
        <p data-testid="refused-line">{line}</p>
      </Prose>
      <div className="flex flex-col items-stretch gap-2 pt-6 sm:flex-row sm:items-start">
        <UseDifferentAccount retryPath={refused?.retryPath ?? "/"} />
        <Button asChild variant="quiet" className="h-10 w-full sm:h-8 sm:w-auto">
          <Link href="/">{t("browseTools")}</Link>
        </Button>
      </div>
      <p className="pt-4 text-sm leading-normal text-muted-foreground">{t("stillWorks")}</p>
    </PublicPage>
  );
}
