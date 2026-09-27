import "server-only";

import { z } from "zod";
import { ADMIN_PROJECTS_PATH, type ProjectWriteError } from "../../app/admin/projects/action-result";
import { record } from "../admin/audit-warning";
import { setProjectPublished } from "../data/projects";
import { requestMirrorPush } from "../mirror/trigger";
import { invalidateProjects } from "../revalidate";
import { defineAction } from "./define";

/**
 * The project moderation gate (spec §4.6 #43, Article 5): publish or unpublish
 * one submission.
 *
 * The one queue action that is not an ordinary edit: it checks
 * `projects.moderate` (not `tools.publish`), it is **audited**
 * (`project.published` / `project.unpublished`; a lost event is a warning on a
 * success), it **invalidates** the published-only gallery, and it tells the
 * Notion mirror, which carries published projects only. In that order, and
 * only after the write committed.
 */
export const PROJECTS_SET_PUBLISHED = defineAction<
  { projectId: string; published: boolean },
  object,
  ProjectWriteError
>({
  id: "projects.set_published",
  toolName: "set_project_published",
  description: "Publish one submitted project to the public gallery, or unpublish it.",
  permission: "projects.moderate",
  risk: "catalog",
  input: z.object({ projectId: z.string(), published: z.boolean() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "project", id: input.projectId }),
  run: async (input, ctx) => {
    const outcome = await setProjectPublished(input.projectId, input.published, { actorUserId: ctx.identity.userId });
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, committed: true };
  },
  afterCommit: async (input, _committed, ctx) => {
    const recorded = await record(
      {
        actorUserId: ctx.identity.userId,
        action: input.published ? "project.published" : "project.unpublished",
        subjectType: "project",
        subjectId: input.projectId,
      },
      "admin/projects"
    );
    // After the commit and after the event, never before either: a rolled-back
    // write has nothing to show, and busting the gallery for it costs a re-read.
    invalidateProjects();
    await requestMirrorPush();
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [ADMIN_PROJECTS_PATH],
});
