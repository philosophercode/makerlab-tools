"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectModerationEntry } from "../../lib/data/projects";
import type { SetProjectPublishedAction } from "../../app/admin/projects/action-result";
import { QueueList } from "../system/queue/QueueList";
import { ReviewCard } from "../system/review/ReviewCard";
import { PublishToggle } from "./PublishToggle";
import { personLabel } from "./person-label";

/**
 * The moderation queue on `/admin/projects` (spec §5.6, §5.5, Article 5), on
 * the shared `QueueList` (UI system phase 4): search, submissions waiting on
 * the page, published ones behind the disclosure — unpublishing is the other
 * half of the gate, so they stay reachable from the page that governs them.
 *
 * **The card shows the whole submission, because there is nowhere else to see
 * it.** `/projects/<slug>` is published-only by design, so a project waiting
 * for a decision has no public page to preview. Every card carries the photos,
 * the write-up, the link and the materials — what the gallery would show.
 */

export interface ProjectQueueProps {
  projects: ProjectModerationEntry[];
  action: SetProjectPublishedAction;
}

export function ProjectQueue({ projects, action }: ProjectQueueProps) {
  const t = useTranslations("admin.projects");

  return (
    <QueueList
      items={projects}
      getId={(project) => project.id}
      isOpen={(project) => !project.published}
      searchText={(project) => [project.title, project.authorName, project.body, project.materials.join(" ")].join(" ")}
      labels={{
        list: t("queueLabel"),
        filters: t("filtersLabel"),
        search: t("search"),
        searchPlaceholder: t("searchPlaceholder"),
        settled: (count) => t("publishedToggle", { count }),
        empty: t("empty"),
        emptyOpen: t("emptyWaiting"),
      }}
      renderItem={(project) => <ProjectCard project={project} action={action} />}
    />
  );
}

function ProjectCard({ project, action }: { project: ProjectModerationEntry; action: SetProjectPublishedAction }) {
  const t = useTranslations("admin.projects");
  const tPeople = useTranslations("admin.people");
  const author = personLabel(tPeople, project.authorName, project.authorRemoved);

  return (
    <ReviewCard
      label={project.title}
      headingLevel={3}
      tone={project.published ? "settled" : "default"}
      meta={
        <>
          <span>{author ? t("by", { name: author }) : t("byAnonymous")}</span>
          <span className="tabular-nums">{t("submittedOn", { date: new Date(project.createdAt).toISOString().slice(0, 10) })}</span>
          {project.published ? (
            // Published rows have a page; the ones being judged deliberately
            // do not, which is why the card carries everything below.
            <Link className="text-primary-ink hover:underline" href={`/projects/${project.slug}`}>
              {t("openInGallery")}
            </Link>
          ) : null}
        </>
      }
    >
      {project.published ? null : <p className="m-0 text-xs text-muted-foreground">{t("notPublicYet")}</p>}

      {project.photos.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("photosFor", { title: project.title })}>
          {project.photos.map((photo, index) => (
            <li key={`${photo}-${index}`} className="relative size-24 overflow-hidden border border-border bg-muted">
              {/* `unoptimized`, like every admin thumbnail: Blob URLs on a page
                  nobody browses for pleasure (Article 4). This is the picture
                  the decision is made on, so it is bigger than a row's. */}
              <Image src={photo} alt="" fill sizes="96px" style={{ objectFit: "cover" }} unoptimized />
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-muted-foreground">{t("noPhotos")}</p>
      )}

      <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">{project.body}</p>

      {project.link ? (
        // Somebody else's URL, opened from an admin page: `noreferrer` as well
        // as `noopener`, the way every outbound link in the app is.
        <p className="m-0 text-xs">
          <a className="text-primary-ink break-all hover:underline" href={project.link} target="_blank" rel="noopener noreferrer">
            {project.link}
          </a>
        </p>
      ) : null}

      {project.materials.length > 0 ? (
        <p className="m-0 text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">{t("materials")}</strong> {project.materials.join(", ")}
        </p>
      ) : null}

      <PublishToggle projectId={project.id} title={project.title} published={project.published} action={action} />
    </ReviewCard>
  );
}
