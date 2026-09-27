import type { AdminGateError } from "../../../lib/admin/action-result";
import type { QueueActionResult } from "../../../lib/admin/queue-write";

/**
 * What `/admin/projects`' server action answers, and where it lives.
 *
 * Directive-free for the reason every admin surface's result module is: a
 * `"use server"` module may export only async functions, and the client island
 * has to render these codes without importing the endpoint to get at its shape.
 */

/** The page this action belongs to, and the path it refreshes. */
export const ADMIN_PROJECTS_PATH = "/admin/projects";

/**
 * Why a project did not change.
 *
 * Only one code of its own: publishing takes no input but a boolean, so there
 * is no field to be invalid. `not_found` means the submission is gone —
 * somebody deleted it, or the page has been open since before it was.
 */
export type ProjectWriteError = "not_found";

export type ProjectActionError = AdminGateError | ProjectWriteError;

/** One declaration of the codes, two shapes built from it — see `/admin/maintenance`. */
export type ProjectActionResult = QueueActionResult<ProjectWriteError>;

/** The shape `ProjectQueue` hands its island, and the page hands the queue. */
export type SetProjectPublishedAction = (input: {
  projectId: string;
  published: boolean;
}) => Promise<ProjectActionResult>;
