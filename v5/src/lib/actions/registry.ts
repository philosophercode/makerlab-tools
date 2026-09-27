import "server-only";

import { CORRECTIONS_SET_STATUS } from "./corrections";
import type { ActionDefinition, ActionMeta } from "./define";
import { TICKETS_LOG_COMPLETED } from "./maintenance-log";
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
];

/** Every definition, runnable. */
export const ACTION_DEFINITIONS: readonly AnyActionDefinition[] = DEFINITIONS as unknown as AnyActionDefinition[];

export const ACTIONS: readonly ActionMeta[] = ACTION_DEFINITIONS;

/** One action by its dotted id, or undefined. */
export function actionById(id: string): AnyActionDefinition | undefined {
  return ACTION_DEFINITIONS.find((action) => action.id === id);
}
