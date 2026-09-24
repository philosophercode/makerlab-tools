"use server";

import { record } from "../../../lib/admin/audit-warning";
import { runQueueWrite } from "../../../lib/admin/queue-write";
import { setProjectPublished } from "../../../lib/data/projects";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import { invalidateProjects } from "../../../lib/revalidate";
import { ADMIN_PROJECTS_PATH, type ProjectActionResult } from "./action-result";

/**
 * The moderation gate (spec §5.6, §4.10, Article 5).
 *
 * This is the one queue action that is *not* an ordinary edit, and it shows in
 * all three ways:
 *
 * - **It is audited.** `project.published` and `project.unpublished` are in
 *   `AUDIT_ACTIONS` (§4.11) because deciding what the public gallery shows is
 *   exactly the kind of act the trail exists for. A lost audit event is still a
 *   **warning on a success**, never a failure: the row has already changed by
 *   the time the event is written, and answering `{ ok: false }` would make the
 *   island restore the previous value and assert a state the database no longer
 *   holds (Article 4). That channel is `src/lib/admin/audit-warning.ts`, shared
 *   with `/admin/users` and the tool editor.
 * - **It invalidates.** `invalidateProjects()` — the cached gallery is
 *   published-only, and this write is the only thing that changes which rows
 *   that means. `createProjectSubmission` deliberately invalidates nothing and
 *   says why; do not copy that reasoning here, it is the opposite case.
 * - **It checks `projects.moderate`**, which is its own permission and not
 *   `tools.publish`. Publishing a machine and publishing somebody's write-up
 *   are different jobs, and the declaration already says so.
 * - **It tells the Notion mirror.** The mirror carries published projects only
 *   (§3.8), so both directions change what it should hold, and
 *   `requestMirrorPush()` runs after the invalidation (§3.8 trigger 1). It
 *   never throws; a refused write never reaches it.
 */

/** Names this surface in the console line a missing audit event leaves behind. */
const SURFACE = "admin/projects";

/**
 * Publish or unpublish one submission.
 *
 * Both directions through one action, because they are one decision made twice:
 * "this belongs in the gallery" and "on reflection it does not". The audit
 * vocabulary has a separate action for each, so the trail reads as two events
 * rather than one with a flag — unlike `tool.archived`, which has no
 * counterpart to pair with.
 */
export async function setPublished(input: {
  projectId: string;
  published: boolean;
}): Promise<ProjectActionResult> {
  return runQueueWrite({
    permission: "projects.moderate",
    path: ADMIN_PROJECTS_PATH,
    surface: SURFACE,
    write: (identity) =>
      setProjectPublished(input.projectId, input.published, { actorUserId: identity.userId }),
    afterCommit: async (identity) => {
      const recorded = await record(
        {
          actorUserId: identity.userId,
          action: input.published ? "project.published" : "project.unpublished",
          subjectType: "project",
          subjectId: input.projectId,
        },
        SURFACE
      );

      // After the commit and after the event, never before either: a rolled-back
      // write has nothing to show, and busting the gallery for it would cost a
      // full re-read for free.
      invalidateProjects();
      await requestMirrorPush();

      return recorded ? undefined : "audit_unavailable";
    },
  });
}
