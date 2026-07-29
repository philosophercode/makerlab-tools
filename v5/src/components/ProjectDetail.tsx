import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MakerLabProject } from "./catalog-types";

interface ProjectDetailProps {
  project: MakerLabProject;
}

function formatDate(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function ProjectDetail({ project }: ProjectDetailProps) {
  const t = await getTranslations("projectDetail");
  const formattedDate = formatDate(project.date);
  const [cover, ...rest] = project.photos;

  return (
    <main className="tool-detail">
      <div className="td-breadcrumbs">
        <div>
          <Link href="/projects">{t("breadcrumbProjects")}</Link>
          <span aria-hidden="true">›</span>
          <span>{project.title}</span>
        </div>
      </div>

      <section className="td-panel project-detail-head">
        <h1>{project.title}</h1>
        <p className="project-detail-meta">
          {t("by", { author: project.author })}
          {formattedDate ? ` · ${formattedDate}` : ""}
        </p>
        {project.link ? (
          <a
            className="td-button"
            href={project.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("viewLink")}
          </a>
        ) : null}
      </section>

      {cover ? (
        <section className="project-detail-gallery" aria-label={t("photosLabel")}>
          <div className="project-detail-cover">
            <Image
              src={cover}
              alt=""
              fill
              sizes="(min-width: 980px) 60vw, 100vw"
              style={{ objectFit: "contain" }}
              priority
            />
          </div>
          {rest.length > 0 ? (
            <div className="project-detail-thumbs">
              {rest.map((photo, index) => (
                <div className="project-detail-thumb" key={`${photo}-${index}`}>
                  <Image
                    src={photo}
                    alt=""
                    fill
                    sizes="(min-width: 980px) 20vw, 50vw"
                    style={{ objectFit: "cover" }}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="td-panel td-prose project-detail-body">
        <div className="chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.body}</ReactMarkdown>
        </div>
      </section>

      {project.tools.length > 0 ? (
        <section className="td-panel">
          <header className="td-section-title td-section-title-bordered">
            <h2>{t("toolsUsed")}</h2>
          </header>
          <div className="td-chip-row">
            {project.tools.map((tool) => (
              <Link className="td-chip td-chip-link" href={`/tools/${tool.slug}`} key={tool.id}>
                {tool.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {project.materials.length > 0 ? (
        <section className="td-panel">
          <header className="td-section-title td-section-title-bordered">
            <h2>{t("materials")}</h2>
          </header>
          <div className="td-chip-row">
            {project.materials.map((material) => (
              <span className="td-chip" key={material}>
                {material}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <Link className="td-back" href="/projects">
        {t("back")}
      </Link>
    </main>
  );
}
