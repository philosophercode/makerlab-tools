import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectModerationEntry } from "../../lib/data/projects";
import type { SetProjectPublishedAction } from "../../app/admin/projects/action-result";
import { PublishToggle } from "./PublishToggle";

/**
 * The moderation queue on `/admin/projects` (spec §5.6, §5.5, Article 5).
 *
 * A server component with no `async`, everything in props — `UsersTable`'s
 * shape, and what makes it mountable in a component test.
 *
 * **The card shows the whole submission, because there is nowhere else to see
 * it.** `/projects/<slug>` is published-only by design, so a project waiting
 * for a decision has no public page to preview — the moderator would be judging
 * a title. Every card therefore carries the photos, the write-up, the link and
 * the materials, which is exactly what the gallery would show if this were
 * approved.
 *
 * **Waiting first, published folded away.** Unpublishing is the other half of
 * the gate rather than a different job, so published submissions stay reachable
 * behind a disclosure instead of disappearing from the page that governs them.
 */

export interface ProjectQueueProps {
  projects: ProjectModerationEntry[];
  action: SetProjectPublishedAction;
}

export function ProjectQueue({ projects, action }: ProjectQueueProps) {
  const t = useTranslations("admin.projects");

  if (projects.length === 0) {
    return <p className="admin-empty td-empty">{t("empty")}</p>;
  }

  const waiting = projects.filter((project) => !project.published);
  const published = projects.filter((project) => project.published);

  return (
    <div className="admin-queue">
      {waiting.length === 0 ? (
        <p className="admin-empty td-empty">{t("emptyWaiting")}</p>
      ) : (
        <ul className="admin-queue-list" aria-label={t("queueLabel")}>
          {waiting.map((project) => (
            <ProjectCard key={project.id} project={project} action={action} />
          ))}
        </ul>
      )}

      {published.length > 0 ? (
        <details className="admin-queue-settled">
          <summary>{t("publishedToggle", { count: published.length })}</summary>
          <ul className="admin-queue-list">
            {published.map((project) => (
              <ProjectCard key={project.id} project={project} action={action} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ProjectCard({
  project,
  action,
}: {
  project: ProjectModerationEntry;
  action: SetProjectPublishedAction;
}) {
  const t = useTranslations("admin.projects");

  return (
    <li className="admin-queue-card">
      <header className="admin-queue-card-head">
        <h3>{project.title}</h3>
      </header>

      <p className="admin-queue-meta">
        <span>
          {project.authorName
            ? t("by", { name: project.authorName })
            : t("byAnonymous")}
        </span>
        <span className="admin-date">
          {t("submittedOn", { date: project.createdAt.toISOString().slice(0, 10) })}
        </span>
        {project.published ? (
          // Published rows have a page; the ones being judged deliberately do
          // not, which is why the card carries everything below.
          <Link href={`/projects/${project.slug}`}>{t("openInGallery")}</Link>
        ) : (
          <span>{t("notPublicYet")}</span>
        )}
      </p>

      {project.photos.length > 0 ? (
        <ul className="admin-project-photos" aria-label={t("photosFor", { title: project.title })}>
          {project.photos.map((photo, index) => (
            <li className="admin-thumb is-project" key={`${photo}-${index}`}>
              {/* `unoptimized`, like the review table's thumbnails: these are
                  Blob URLs on an admin page nobody browses for pleasure, and
                  an optimizer pass per photo per moderation is a bill for
                  nothing (Article 4). */}
              <Image src={photo} alt="" fill sizes="96px" style={{ objectFit: "cover" }} unoptimized />
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-cell-note">{t("noPhotos")}</p>
      )}

      <p className="admin-queue-body">{project.body}</p>

      {project.link ? (
        <p className="admin-queue-meta">
          {/* Somebody else's URL, opened from an admin page: `noreferrer` as
              well as `noopener`, the way every outbound link in the app is. */}
          <a href={project.link} target="_blank" rel="noopener noreferrer">
            {project.link}
          </a>
        </p>
      ) : null}

      {project.materials.length > 0 ? (
        <p className="admin-queue-meta">
          <strong>{t("materials")}</strong> {project.materials.join(", ")}
        </p>
      ) : null}

      <PublishToggle
        projectId={project.id}
        title={project.title}
        published={project.published}
        action={action}
      />
    </li>
  );
}
