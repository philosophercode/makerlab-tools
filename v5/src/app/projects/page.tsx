import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../../components/system/EmptyState";
import { PublicPage } from "../../components/system/PublicPage";
import { siteConfig } from "../../lib/site-config";
import { getPublishedProjects } from "../../lib/projects";

export const metadata = {
  title: `Projects — ${siteConfig.name}`,
};

/**
 * `/projects` — the published projects (UI system phase 5a): `PublicPage` at
 * the page width with "Submit a project" as the one filled action, a facts
 * line with the count, and a grid of plates (cover, title, byline, up to four
 * tools as labels). An empty gallery says so and offers the same action.
 */
export default async function ProjectsPage() {
  const t = await getTranslations("projects");
  const projects = await getPublishedProjects();
  const submit = (
    <Button asChild variant="default">
      <Link href="/projects/new">{t("submit")}</Link>
    </Button>
  );

  return (
    <PublicPage
      width="wide"
      titleId="projects-title"
      title={t("title")}
      lede={t("lede", { institution: siteConfig.institution })}
      facts={projects.length > 0 ? t("count", { count: projects.length }) : undefined}
      actions={projects.length > 0 ? submit : undefined}
    >
      <section aria-label={t("galleryLabel")} className="pt-4">
        {projects.length > 0 ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <li key={project.id} className="min-w-0">
                <Link
                  href={`/projects/${project.slug}`}
                  className="group flex h-full flex-col border border-border bg-card transition-colors duration-150 hover:bg-accent"
                >
                  <span aria-hidden="true" className="relative block aspect-[4/3] bg-muted">
                    {project.photos[0] ? (
                      <Image
                        src={project.photos[0]}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center font-mono text-2xl text-muted-foreground">
                        {"{ }"}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col gap-1.5 p-3">
                    <strong className="font-heading text-base leading-tight font-medium uppercase group-hover:text-primary-ink">
                      {project.title}
                    </strong>
                    <span className="text-xs text-muted-foreground">{t("by", { author: project.author })}</span>
                    {project.tools.length > 0 ? (
                      <span className="flex flex-wrap gap-1 pt-1">
                        {project.tools.slice(0, 4).map((tool) => (
                          <Badge key={tool.id}>{tool.name}</Badge>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState action={submit}>{t("empty")}</EmptyState>
        )}
      </section>
    </PublicPage>
  );
}
