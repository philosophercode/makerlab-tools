import { getTranslations } from "next-intl/server";
import { hasNotionCatalogEnv } from "../lib/catalog";
import { siteConfig } from "../lib/site-config";

/**
 * Says out loud that the catalogue is built-in demo data rather than the lab's
 * real inventory (operational-hardening spec §6).
 *
 * The fallback itself is deliberate and load-bearing: it is why `npm run dev`
 * and the whole test suite work with no credentials. What was dangerous was
 * that it happened *silently* — a deploy missing one `NOTION_DB_*` variable
 * served invented equipment and looked perfectly healthy, and the only way to
 * find out was to recognise machines the lab does not own.
 *
 * `/api/health` reports the same state as a 503 for monitors. This is the half
 * a person standing in front of the page can see.
 *
 * Keyed on the env contract rather than on a fallback that already happened,
 * because a server component renders before any catalogue fetch it does not
 * itself perform — and a missing variable is the case that actually reaches
 * production. A transient fetch failure is caught by the health endpoint.
 */
export async function DemoDataBanner() {
  if (hasNotionCatalogEnv()) return null;

  const t = await getTranslations("demoBanner");

  return (
    <div className="demo-banner" role="status">
      <strong>{t("label")}</strong>
      <span>{t("body", { institution: siteConfig.institution })}</span>
    </div>
  );
}
