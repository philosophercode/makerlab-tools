import { z } from "zod";
import { isUuid } from "../data/uuid";

/**
 * The review queue's input shapes (spec §5.4 steps 10–12), moved verbatim
 * from `app/admin/intake/actions.ts` when its exports became wrappers over
 * `lib/actions/intake.ts`. **Every input is parsed**, because a server
 * action's arguments are whatever the POST body said, not what the form's
 * TypeScript promised; a shape that does not parse is `invalid_field`.
 */

/** Text a person typed into one line: trimmed, capped like the data layer caps it. */
const MAX_LINE = 200;

/** A description is Markdown and may be long; a runaway paste may not. */
const MAX_DESCRIPTION = 20_000;

/** The "I've checked this" note (§5.4 step 12). */
const MAX_OVERRIDE_NOTE = 1000;

export const pendingId = z.string().refine(isUuid);

/** Trimmed, capped, and "" becomes null — an empty box means "not set". */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));
}

const list = z.array(z.string().trim().min(1).max(MAX_LINE)).max(50);

/**
 * The product image (gateway spec §4.3). Strict: a `candidateUrl` on a choice
 * that is not `original` is a shape error, not something to ignore. Whether the
 * URL is one research recorded is decided by `intake/approval-image.ts`, which
 * refuses anything else before fetching.
 */
const imageChoice = z.discriminatedUnion("choice", [
  z.strictObject({ choice: z.literal("cleaned") }),
  z.strictObject({ choice: z.literal("original"), candidateUrl: z.string().min(1).max(2048) }),
  // One of the item's own uploaded photos; which ones are its own is decided by `approval-image.ts`.
  z.strictObject({ choice: z.literal("upload"), attachmentId: pendingId, removeBackground: z.boolean() }),
  z.strictObject({ choice: z.literal("none") }),
]);

export const approvalFields = z.strictObject({
  // The display name; over its 40-character cap the approval itself refuses (`invalid_field`).
  name: z.string().trim().min(1).max(MAX_LINE),
  // The official name (tool display names spec §5.3); blank is none.
  officialName: optionalText(MAX_LINE).optional(),
  description: optionalText(MAX_DESCRIPTION),
  categoryId: pendingId.nullable(),
  newCategory: z
    .strictObject({
      name: z.string().trim().min(1).max(MAX_LINE),
      group: optionalText(MAX_LINE),
    })
    .nullable()
    .optional(),
  locationId: pendingId.nullable(),
  materials: list,
  ppeRequired: list,
  tags: list,
  trainingRequired: z.boolean(),
  useRestrictions: optionalText(2000),
  serialNumber: optionalText(MAX_LINE),
  resourceUrls: z.array(z.string().max(2048)).max(50).optional(),
  // An imported item's own links the reviewer kept (bulk intake spec §3.4).
  importLinkUrls: z.array(z.string().max(2048)).max(50).optional(),
  image: imageChoice.optional(),
});

/**
 * **Approve** and **Approve as draft**: the form, and which button. The two
 * server actions set `publish` themselves, after the body — a body cannot
 * choose it.
 */
export const approveInput = z.strictObject({
  id: pendingId,
  fields: approvalFields,
  overrideNote: z.string().max(MAX_OVERRIDE_NOTE).nullable().optional(),
  publish: z.boolean(),
});

export const addUnitInput = z.strictObject({
  id: pendingId,
  serialNumber: optionalText(MAX_LINE),
});

export const discardInput = z.strictObject({ id: pendingId });

/**
 * **Find a different image**. The note is parsed again by `parseReviewerNote`
 * — one line, at most `REVIEWER_NOTE_MAX_CHARS` once cleaned — and a longer
 * one is `invalid_field`, never silently cut.
 */
export const differentImageInput = z.strictObject({
  id: pendingId,
  note: z.string().max(4000).nullable().optional(),
});

export const identityInput = z.strictObject({
  id: pendingId,
  name: z.string().trim().min(1).max(MAX_LINE),
  brand: optionalText(MAX_LINE),
});
