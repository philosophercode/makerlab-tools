import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MakerLabProject } from "./catalog-types";
import { PageSection, PublicPage } from "./system/PublicPage";
import { Markdown } from "./system/Markdown";

interface ProjectDetailProps {
  project: MakerLabProject;
}

/** An ISO day (DESIGN.md §2: dates are ISO, comparable, locale-neutral), or nothing. */
function isoDay(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

/**
 * One published project (UI system phase 5a): `PublicPage` with the
 * `// PROJECTS / TITLE` crumb, the byline and date as the facts line, the
 * photos, the write-up, and the tools and materials as labels.
 */
export async function ProjectDetail({ project }: ProjectDetailProps) {
  const t = await getTranslations("projectDetail");
  const date = isoDay(project.date);
  const [cover, ...rest] = project.photos;

  return (
    <PublicPage
      crumbs={[{ label: t("breadcrumbProjects"), href: "/projects" }, { label: project.title }]}
      title={project.title}
      facts={
        <span>
          {t("by", { author: project.author })}
          {date ? ` · ${date}` : ""}
        </span>
      }
      actions={
        project.link ? (
          <Button asChild variant="outline">
            <a href={project.link} target="_blank" rel="noopener noreferrer">
              {t("viewLink")}
            </a>
          </Button>
        ) : null
      }
    >
      {cover ? (
        <section data-slot="project-photos" aria-label={t("photosLabel")} className="flex flex-col gap-2 pt-4">
          <div className="relative aspect-[4/3] w-full bg-muted">
            <Image src={cover} alt="" fill sizes="(min-width: 980px) 880px, 100vw" style={{ objectFit: "contain" }} priority />
          </div>
          {rest.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rest.map((photo, index) => (
                <div data-slot="project-thumb" className="relative aspect-square bg-muted" key={`${photo}-${index}`}>
                  <Image src={photo} alt="" fill sizes="(min-width: 980px) 220px, 33vw" style={{ objectFit: "cover" }} />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div data-slot="project-body" className="max-w-[72ch] pt-6 text-[15px]">
        <Markdown>{project.body}</Markdown>
      </div>

      {project.tools.length > 0 ? (
        <PageSection id="project-tools" title={t("toolsUsed")}>
          <div className="flex flex-wrap gap-2">
            {project.tools.map((tool) => (
              <Badge asChild key={tool.id} className="text-label">
                <Link href={`/tools/${tool.slug}`}>{tool.name}</Link>
              </Badge>
            ))}
          </div>
        </PageSection>
      ) : null}

      {project.materials.length > 0 ? (
        <PageSection id="project-materials" title={t("materials")}>
          <div className="flex flex-wrap gap-2">
            {project.materials.map((material) => (
              <Badge key={material} className="text-label">
                {material}
              </Badge>
            ))}
          </div>
        </PageSection>
      ) : null}

      <div className="pt-8">
        <Button asChild variant="ghost">
          <Link href="/projects">{t("back")}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
