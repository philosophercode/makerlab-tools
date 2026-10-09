import "server-only";

import { LAB_NOTES_PATH, type LabNotesError } from "../../app/admin/inventory/lab-notes/action-result";
import { LAB_NOTES_SETTING, setLabSetting } from "../data/lab-settings";
import { labNotesSchema, normalizeLabNotes, type LabNotes } from "../lab-notes/setting";
import { invalidateCatalog } from "../revalidate";
import { defineAction } from "./define";

/**
 * The lab-wide notes (identity spec amendment "Lab notes", 2026-10-06): the
 * lab's own rules the assistant knows in every conversation. One JSON setting
 * per deployment (`lab_settings.lab_notes`), saved whole from
 * `/admin/inventory/lab-notes`. Gated on **`tools.edit`**, the inventory's
 * permission: the SuperMakers who write a tool's lab notes write the lab's
 * too.
 *
 * GUI only (`assistant: "never"`): the notes are instructions the assistant
 * reads on every turn, so it never proposes its own — a page or a manual it
 * read could otherwise word them. A tool's lab notes are `tools.notes`,
 * written by the editor's save, which is GUI only for the same family of
 * reasons (`exempt.ts`).
 *
 * The row records who changed it last (`updated_by`), which the page shows.
 * No audit event, like the value report's assumptions: the setting is state,
 * and the row says who set it. A save drops the catalogue's cache tag, which
 * the chat's cached read of the notes carries, so the next turn has them.
 */
const NEVER_REASON =
  "The lab-wide notes are instructions the assistant reads on every turn, so it never proposes its own; staff write them on /admin/inventory/lab-notes";

export const LAB_SET_NOTES = defineAction<LabNotes, object, LabNotesError>({
  id: "lab.set_notes",
  toolName: "set_lab_notes",
  description: "Set the lab-wide notes: the lab's own rules and tips, one per line, which the assistant knows in every conversation.",
  permission: "tools.edit",
  risk: "catalog",
  assistant: "never",
  neverReason: NEVER_REASON,
  input: labNotesSchema,
  invalidInput: "invalid_field",
  subject: () => ({ type: "lab_setting", id: LAB_NOTES_SETTING }),
  run: async (input, ctx) => {
    const outcome = await setLabSetting(LAB_NOTES_SETTING, normalizeLabNotes(input), ctx.identity.userId);
    return { ok: true, value: {}, ...(outcome.changed ? { committed: true } : {}) };
  },
  afterCommit: async () => {
    invalidateCatalog();
    return undefined;
  },
  revalidate: [LAB_NOTES_PATH],
});
