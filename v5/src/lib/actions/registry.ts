import "server-only";

import { TOOLS_ARCHIVE, TOOLS_MARK_REVIEWED, TOOLS_RESTORE, TOOLS_SET_PUBLISHED } from "./catalog";
import { CORRECTIONS_SET_STATUS } from "./corrections";
import type { ActionDefinition, ActionMeta } from "./define";
import {
  IMPORTS_CONFIRM_COLUMNS,
  IMPORTS_DECIDE_SUGGESTIONS,
  IMPORTS_EDIT_ROW,
  IMPORTS_MERGE_ROW,
  IMPORTS_REMOVE_ROWS,
  IMPORTS_REQUEST_SUGGESTIONS,
  IMPORTS_SET_HINTS,
} from "./imports";
import {
  PENDING_ADD_UNIT,
  PENDING_APPROVE,
  PENDING_DIFFERENT_IMAGE,
  PENDING_DISCARD,
  PENDING_EDIT,
  PENDING_RESEARCH,
  PENDING_SAVE_IDENTITY,
} from "./intake";
import { INSIGHTS_DISMISS_GAP, INSIGHTS_FILE_CORRECTION } from "./insights";
import { TICKETS_LOG_COMPLETED } from "./maintenance-log";
import { MANUALS_REPROCESS, MANUALS_REPROCESS_LIBRARY } from "./manuals";
import { MIRROR_DISCONNECT, MIRROR_SET_PAUSED, MIRROR_SYNC_NOW } from "./mirror";
import { PEOPLE_SET_NAME, PEOPLE_SET_ROLE, PEOPLE_SET_TITLE } from "./people";
import { PEOPLE_GRANT_ALLOWANCE } from "./people-allowance";
import { PEOPLE_ADD, PEOPLE_REMOVE, PEOPLE_UNBLOCK_EMAIL } from "./people-roster";
import { PROJECTS_SET_PUBLISHED } from "./projects";
import { REFRESH_QUEUE } from "./refresh";
import { RESOURCES_ADD, RESOURCES_EDIT, RESOURCES_REMOVE } from "./resources";
import {
  TAXONOMY_DECIDE_PROPOSAL,
  TAXONOMY_EDIT_CATEGORY,
  TAXONOMY_MERGE,
  TAXONOMY_PROPOSE_CATEGORY,
  TAXONOMY_RECATEGORIZE_TOOL,
  TAXONOMY_SET_RETIRED,
} from "./taxonomy";
import { TICKETS_UPDATE } from "./tickets";
import { UNITS_ADD, UNITS_DELETE, UNITS_EDIT, UNITS_RETIRE } from "./units";

/**
 * Every registered action, in one ordered array (assistant–GUI parity spec
 * §3.1): the People page, the maintenance, corrections and projects queues
 * (phase 1), the catalogue (phase 4), intake, imports and the spend actions
 * (phase 5), the mirror's running controls (phase 6). The parity guard (`parity.test.ts`) keeps a server action
 * nobody registered from landing quietly.
 *
 * Typed as the metadata only: the generated tools (phase 2), `/mcp` and the
 * guard read the data; running one goes through the definition itself and
 * `performAction`.
 */
/**
 * A definition with its types erased, for the code that handles every action
 * alike — the generated tools and the confirm route. Each of those parses the
 * stored or model-written input with the definition's own schema before any
 * step reads it, so the erasure never reaches a `run()` unchecked.
 */
export type AnyActionDefinition = ActionDefinition<unknown, object, string, unknown>;

const DEFINITIONS = [
  PEOPLE_SET_ROLE,
  PEOPLE_SET_TITLE,
  PEOPLE_SET_NAME,
  PEOPLE_ADD,
  PEOPLE_REMOVE,
  PEOPLE_UNBLOCK_EMAIL,
  PEOPLE_GRANT_ALLOWANCE,
  TICKETS_UPDATE,
  TICKETS_LOG_COMPLETED,
  CORRECTIONS_SET_STATUS,
  PROJECTS_SET_PUBLISHED,
  // Phase 4: the catalogue (§4.4).
  TOOLS_SET_PUBLISHED,
  TOOLS_MARK_REVIEWED,
  TOOLS_ARCHIVE,
  TOOLS_RESTORE,
  UNITS_ADD,
  UNITS_EDIT,
  UNITS_RETIRE,
  UNITS_DELETE,
  RESOURCES_ADD,
  RESOURCES_EDIT,
  RESOURCES_REMOVE,
  // Phase 5: intake, imports, and the spend actions (§4.2, §4.3, §4.5).
  PENDING_APPROVE,
  PENDING_ADD_UNIT,
  PENDING_DISCARD,
  PENDING_SAVE_IDENTITY,
  PENDING_EDIT,
  PENDING_DIFFERENT_IMAGE,
  PENDING_RESEARCH,
  IMPORTS_CONFIRM_COLUMNS,
  IMPORTS_EDIT_ROW,
  IMPORTS_SET_HINTS,
  IMPORTS_REMOVE_ROWS,
  IMPORTS_MERGE_ROW,
  IMPORTS_DECIDE_SUGGESTIONS,
  IMPORTS_REQUEST_SUGGESTIONS,
  MANUALS_REPROCESS,
  MANUALS_REPROCESS_LIBRARY,
  REFRESH_QUEUE,
  // Phase 6: the mirror's running controls (§4.8).
  MIRROR_SYNC_NOW,
  MIRROR_SET_PAUSED,
  MIRROR_DISCONNECT,
  // Taxonomy v2 (spec 2026-09-28 §4.6).
  TAXONOMY_PROPOSE_CATEGORY,
  TAXONOMY_DECIDE_PROPOSAL,
  TAXONOMY_MERGE,
  TAXONOMY_EDIT_CATEGORY,
  TAXONOMY_SET_RETIRED,
  TAXONOMY_RECATEGORIZE_TOOL,
  // Usage insight: the Unanswered queue's decisions (usage insight spec §7).
  INSIGHTS_DISMISS_GAP,
  INSIGHTS_FILE_CORRECTION,
];

/** Every definition, runnable. */
export const ACTION_DEFINITIONS: readonly AnyActionDefinition[] = DEFINITIONS as unknown as AnyActionDefinition[];

export const ACTIONS: readonly ActionMeta[] = ACTION_DEFINITIONS;

/** One action by its dotted id, or undefined. */
export function actionById(id: string): AnyActionDefinition | undefined {
  return ACTION_DEFINITIONS.find((action) => action.id === id);
}
