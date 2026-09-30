import { getTranslations } from "next-intl/server";
import { isDemoCatalog } from "../lib/catalog";
import { siteConfig } from "../lib/site-config";

/**
 * Says out loud that the catalogue is the built-in demo seed rather than the
 * lab's real inventory (operational-hardening spec §6).
 *
 * The seed itself is deliberate and load-bearing: an unset `DATABASE_URL` runs
 * the app on an in-process Postgres, which is why `npm run dev` and the whole
 * test suite work with no credentials. What was dangerous was that it happened
 * *silently* — a deploy missing the variable served equipment the lab does not
 * own and looked perfectly healthy.
 *
 * `/api/health` reports the same state as a 503 for monitors. This is the half
 * a person standing in front of the page can see.
 *
 * Keyed on the substrate, not on a failure that already happened: a configured
 * database that is unreachable is a different case, and one the catalogue
 * surfaces by failing rather than by quietly showing sample data (Article 4).
 */
export async function DemoDataBanner() {
  if (!isDemoCatalog()) return null;

  const t = await getTranslations("demoBanner");

  return (
    <div className="demo-banner" role="status">
      <strong>{t("label")}</strong>
      <span>{t("body", { institution: siteConfig.institution })}</span>
    </div>
  );
}
