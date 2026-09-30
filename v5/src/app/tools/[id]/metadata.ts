import type { Metadata } from "next";
import { getCatalogTool } from "../../../lib/catalog";
import { recordShareMetadata, shareDescription } from "../../../lib/share/metadata";
import { siteConfig } from "../../../lib/site-config";

/**
 * A tool page's title and link preview: the tool's name, one line of its
 * description and its photo (or the site card when it has none).
 *
 * Read through the same cached, **published-only** `getCatalogTool` the page
 * uses, so it costs no extra query. A draft, an archived tool, a legacy Notion
 * id and a slug nobody owns all get `{}` — the site's own title and card — so
 * a shared draft link says nothing about the draft, exactly as the page's 404
 * says nothing (`DraftToolView`).
 */
export async function toolPageMetadata(idOrSlug: string): Promise<Metadata> {
  const tool = await getCatalogTool(idOrSlug);
  if (!tool) return {};

  const description =
    shareDescription(tool.shortDescription) ||
    shareDescription(tool.description) ||
    shareDescription(
      tool.category
        ? `${tool.category} at the ${siteConfig.institution} MakerLAB.`
        : `Equipment at the ${siteConfig.institution} MakerLAB.`
    );

  return recordShareMetadata({
    title: tool.name,
    description,
    path: `/tools/${tool.slug}`,
    photo: tool.imageSrc,
    photoSize: tool.thumbnails ?? null,
    photoAlt: tool.name,
  });
}
