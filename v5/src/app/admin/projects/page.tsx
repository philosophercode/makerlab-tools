import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { ProjectQueue } from "../../../components/admin/ProjectQueue";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listProjectsForModeration } from "../../../lib/data/projects";
import { siteConfig } from "../../../lib/site-config";
import { setPublished } from "./actions";

/**
 * `/admin/projects` — the moderation gate (spec §5.6, §5.5, Article 5).
 *
 * Requires `projects.moderate`. This is the page Article 5 names: a submission
 * is written unpublished and stays invisible until a person with the permission
 * says otherwise, in the app, and it is recorded. Nothing else in the codebase
 * can publish a project — `createProjectSubmission` takes no `published`
 * parameter at all.
 *
 * **Nothing here is cached**, and the action invalidates the *gallery's* cache
 * when it lands, because publishing is precisely the event that changes what
 * the cached gallery should show (§3.9).
 *
 * The action travels down as a prop and re-checks its own permission — a server
 * action is a POST endpoint reachable without this page (§8).
 */

export const metadata = {
  title: `Projects — ${siteConfig.name}`,
};

export default async function AdminProjectsPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "projects.moderate")) return <AdminNotice kind="forbidden" />;

  const projects = await listProjectsForModeration();

  const waiting = projects.filter((project) => !project.published).length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="projects"
        title={t("projectsTitle")}
        lede={t("projectsLede")}
        facts={[
          t("facts.waiting", { count: waiting }),
          t("facts.published", { count: projects.length - waiting }),
        ]}
      />

      <ProjectQueue projects={projects} action={setPublished} />
    </section>
  );
}
