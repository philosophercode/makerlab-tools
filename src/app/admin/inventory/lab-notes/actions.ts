"use server";

import { LAB_SET_NOTES } from "../../../../lib/actions/lab-notes";
import { performAction } from "../../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import type { LabNotes } from "../../../../lib/lab-notes/setting";
import type { LabNotesResult } from "./action-result";

/**
 * The lab-wide notes (identity spec amendment "Lab notes"): a one-line
 * wrapper over `lab.set_notes` (`src/lib/actions/lab-notes.ts`), gated on
 * `tools.edit` by `performAction`.
 */
export async function saveLabNotes(input: LabNotes): Promise<LabNotesResult> {
  return performAction(LAB_SET_NOTES, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
