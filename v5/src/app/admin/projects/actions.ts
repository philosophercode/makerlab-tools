"use server";

import { performAction } from "../../../lib/actions/perform";
import { PROJECTS_SET_PUBLISHED } from "../../../lib/actions/projects";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { type ProjectActionResult } from "./action-result";

/**
 * The moderation gate (spec §5.6, §4.10, Article 5) — a one-line wrapper over
 * `projects.set_published` (`src/lib/actions/projects.ts`).
 *
 * The one queue action that is not an ordinary edit: `projects.moderate` (not
 * `tools.publish`), audited as `project.published` / `project.unpublished` (a
 * lost event is a warning on a success), the gallery cache invalidated, and
 * the Notion mirror told — all after the write committed. Both directions
 * through one action, because they are one decision made twice.
 */
export async function setPublished(input: { projectId: string; published: boolean }): Promise<ProjectActionResult> {
  return performAction(PROJECTS_SET_PUBLISHED, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
