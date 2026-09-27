import "server-only";

import { CORRECTIONS_SET_STATUS } from "./corrections";
import type { ActionMeta } from "./define";
import { PEOPLE_SET_NAME, PEOPLE_SET_ROLE, PEOPLE_SET_TITLE } from "./people";
import { PEOPLE_GRANT_ALLOWANCE } from "./people-allowance";
import { PEOPLE_ADD, PEOPLE_REMOVE, PEOPLE_UNBLOCK_EMAIL } from "./people-roster";
import { PROJECTS_SET_PUBLISHED } from "./projects";
import { TICKETS_UPDATE } from "./tickets";

/**
 * Every registered action, in one ordered array (assistant–GUI parity spec
 * §3.1). Phase 1 holds the People page, the maintenance, corrections and
 * projects queues; later phases add the catalogue, intake, import, refresh and
 * mirror areas, and the parity guard (`parity.test.ts`) keeps a server action
 * nobody registered from landing quietly.
 *
 * Typed as the metadata only: the generated tools (phase 2), `/mcp` and the
 * guard read the data; running one goes through the definition itself and
 * `performAction`.
 */
export const ACTIONS: readonly ActionMeta[] = [
  PEOPLE_SET_ROLE,
  PEOPLE_SET_TITLE,
  PEOPLE_SET_NAME,
  PEOPLE_ADD,
  PEOPLE_REMOVE,
  PEOPLE_UNBLOCK_EMAIL,
  PEOPLE_GRANT_ALLOWANCE,
  TICKETS_UPDATE,
  CORRECTIONS_SET_STATUS,
  PROJECTS_SET_PUBLISHED,
];

/** One action by its dotted id, or undefined. */
export function actionById(id: string): ActionMeta | undefined {
  return ACTIONS.find((action) => action.id === id);
}
