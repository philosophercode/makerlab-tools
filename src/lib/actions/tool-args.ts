import { z } from "zod";

/**
 * Argument pieces the generated tools share (assistant–GUI parity spec §3.4):
 * the model writes these, so they are capped and described, and a list is a
 * batch of at most 20 — one proposal row each.
 */

/** The most subjects one proposal holds (§8.3). */
export const MAX_BATCH = 20;

/** A person's `user.id`: Better Auth's own ids are not uuids. */
export const PERSON_ID = z.string().min(1).max(64).describe("The person's id, from find_people");

export const PERSON_IDS = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(MAX_BATCH)
  .describe("The people's ids, from find_people — one for one person, several to give them all the same change");

/** A list of uuids from a read tool or the page's selection. */
export function recordIds(what: string) {
  return z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_BATCH)
    .describe(`The ${what}' ids, from the list tool or the page's selection — several to make the same change to each`);
}
