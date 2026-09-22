import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
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

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("projectsTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments, and a next-intl placeholder with no argument
            renders literally (Article 6 — this has been a real bug here). */}
        <p className="admin-lede">{t("projectsLede")}</p>
      </header>

      <ProjectQueue projects={projects} action={setPublished} />
    </section>
  );
}
