import { getTranslations } from "next-intl/server";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { getCatalogTools } from "../../lib/catalog";
import { canSeeMap } from "../../lib/map/access";
import { STUDIO_101 } from "../../lib/map/studio-101";
import { EmptyState } from "../system/EmptyState";
import { PublicPage } from "../system/PublicPage";
import { MapExplorer } from "./MapExplorer";

/**
 * `/map`'s body: the explorer for a signed-in person, the site's sign-in
 * notice for everyone else (map access, PR #98). The plan and the catalogue
 * are read only after the identity check, so a signed-out response carries
 * no plan data in its HTML or RSC payload.
 */
export async function MapGate() {
  const identity = await resolveIdentityFromHeaders();
  if (!canSeeMap(identity)) {
    const t = await getTranslations("map");
    return (
      <PublicPage crumbs={[{ label: t("crumb") }]} title={t("title")} lede={t("signedOutLede")}>
        <EmptyState>{t("signedOut")}</EmptyState>
      </PublicPage>
    );
  }
  const tools = await getCatalogTools();
  return <MapExplorer plan={STUDIO_101} tools={tools} />;
}
