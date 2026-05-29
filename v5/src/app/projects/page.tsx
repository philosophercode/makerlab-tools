import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { siteConfig } from "../../lib/site-config";
import { getPublishedProjects } from "../../lib/projects";

export const metadata = {
  title: `Projects — ${siteConfig.name}`,
};

export default async function ProjectsPage() {
  const t = await getTranslations("projects");
  const projects = await getPublishedProjects();

  return (
    <main className="page-shell">
      <section className="gallery-header" aria-labelledby="projects-title">
        <div className="title-row">
          <span className="target-glyph" aria-hidden="true">
            +
          </span>
          <h1 id="projects-title">{t("title")}</h1>
        </div>
        <div className="projects-header-actions">
          <p className="projects-lede">{t("lede")}</p>
          <Link className="td-button td-button-primary" href="/projects/new">
            {t("submit")}
          </Link>
        </div>
      </section>

      <section className="project-grid" aria-label={t("galleryLabel")}>
        {projects.length > 0 ? (
          projects.map((project) => (
            <Link
              className="project-card"
              href={`/projects/${project.id}`}
              key={project.id}
            >
              <span className="project-card-cover" aria-hidden="true">
                {project.photos[0] ? (
                  <Image
                    src={project.photos[0]}
                    alt=""
                    fill
                    sizes="(min-width: 980px) 30vw, 100vw"
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  <span className="project-card-cover-fallback">{"{ }"}</span>
                )}
              </span>
              <span className="project-card-body">
                <strong>{project.title}</strong>
                <span className="project-card-author">
                  {t("by", { author: project.author })}
                </span>
                {project.tools.length > 0 ? (
                  <span className="project-card-tools">
                    {project.tools.slice(0, 4).map((tool) => (
                      <span className="td-chip" key={tool.id}>
                        {tool.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </Link>
          ))
        ) : (
          <div className="project-empty">
            <p className="empty-state">{t("empty")}</p>
            <Link className="td-button td-button-primary" href="/projects/new">
              {t("submit")}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
