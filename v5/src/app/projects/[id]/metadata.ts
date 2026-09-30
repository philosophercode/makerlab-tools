import type { Metadata } from "next";
import { getProject } from "../../../lib/projects";
import { recordShareMetadata, shareDescription } from "../../../lib/share/metadata";
import { siteConfig } from "../../../lib/site-config";

/**
 * A project page's title and link preview: its title, the start of its
 * write-up and its cover photo (or the site card when it has none).
 *
 * Read through the cached, **published-only** `getProject` the page uses; an
 * unpublished or unknown project gets `{}` — the site's own title and card.
 */
export async function projectPageMetadata(idOrSlug: string): Promise<Metadata> {
  const project = await getProject(idOrSlug);
  if (!project) return {};

  const byline = project.author ? `A project by ${project.author}` : "A project";
  const description =
    shareDescription(project.body) || shareDescription(`${byline}, made in the ${siteConfig.institution} MakerLAB.`);

  return recordShareMetadata({
    title: project.title,
    description,
    path: `/projects/${project.slug}`,
    photo: project.photos[0],
    photoAlt: project.title,
  });
}
