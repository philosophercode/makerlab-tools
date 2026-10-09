import type { QueueActionResult } from "../../../../lib/admin/queue-write";

/**
 * What `/admin/inventory/lab-notes`' server action answers, and where the page
 * lives. Directive-free, like every admin surface's result module: a
 * `"use server"` module may export only async functions, and the island
 * renders these codes.
 */

/** The lab-wide notes' page (identity spec amendment "Lab notes"). */
export const LAB_NOTES_PATH = "/admin/inventory/lab-notes";

/** Why saving the lab-wide notes did not land: over the length cap. Has an `admin.errors.<code>` message. */
export type LabNotesError = "invalid_field";

export type LabNotesResult = QueueActionResult<LabNotesError>;
