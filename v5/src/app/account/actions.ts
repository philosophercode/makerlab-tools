"use server";

import { updateOwnName, type UpdateOwnNameResult } from "../../lib/account/name-actions";

/**
 * `/account`'s one server action: change your own name. It gates itself —
 * identity, limiter, signed in — in `lib/account/name-actions.ts`, because a
 * server action is reachable without the page that offers it, and it only
 * ever renames the caller.
 */
export async function updateOwnNameAction(input: { name: string }): Promise<UpdateOwnNameResult> {
  return updateOwnName(input);
}
