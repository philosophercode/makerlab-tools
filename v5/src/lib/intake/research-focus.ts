/**
 * What a **Research again** press asks research to redo (amendment "Guided redo
 * (focus + guidance)"): everything, as before, or only some of the listing.
 *
 * - `description` — the paragraph a student reads;
 * - `specs` — the spec list;
 * - `links` — "Links & manuals": the verified resources (and the dropped ones);
 * - `image` — the product image.
 *
 * **Everything is not a field.** It is the absence of a focus — `null` here,
 * nothing in the request — so a row, a request or a workflow run from before
 * this existed means exactly what it meant then. A focus is the fields in
 * {@link RESEARCH_FOCUS_FIELDS} order, each once, never empty.
 *
 * Client-safe and plain Node, no imports: the dialog, the route, the workflow's
 * steps and the stored result all use the same list.
 */

export const RESEARCH_FOCUS_FIELDS = ["description", "specs", "links", "image"] as const;
export type ResearchFocusField = (typeof RESEARCH_FOCUS_FIELDS)[number];

/** A scoped redo's fields; `null` is "everything". */
export type ResearchFocus = readonly ResearchFocusField[] | null;

/** What a request may carry: the fields, or `"everything"` (the dialog's default chip). */
export const RESEARCH_FOCUS_CHOICES = [...RESEARCH_FOCUS_FIELDS, "everything"] as const;
export type ResearchFocusChoice = (typeof RESEARCH_FOCUS_CHOICES)[number];

export function isResearchFocusField(value: unknown): value is ResearchFocusField {
  return typeof value === "string" && (RESEARCH_FOCUS_FIELDS as readonly string[]).includes(value);
}

/**
 * A request's `focus`, normalised: `null` (everything) when absent, empty, or
 * naming `"everything"` at all; otherwise its fields in canonical order, once
 * each; `"invalid"` for anything that is not a list of known choices.
 */
export function parseResearchFocus(raw: unknown): ResearchFocusField[] | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return "invalid";
  if (!raw.every((entry) => typeof entry === "string" && (RESEARCH_FOCUS_CHOICES as readonly string[]).includes(entry))) {
    return "invalid";
  }
  if (raw.length === 0 || raw.includes("everything")) return null;
  return RESEARCH_FOCUS_FIELDS.filter((field) => raw.includes(field));
}

/** Only the image — the run that is **Find a different image**, not search and read. */
export function isImageOnlyFocus(focus: ResearchFocus): boolean {
  return focus !== null && focus.length === 1 && focus[0] === "image";
}

/** Whether a scoped redo touches `field`. Everything touches every field. */
export function focusIncludes(focus: ResearchFocus | undefined, field: ResearchFocusField): boolean {
  return !focus || focus.includes(field);
}
