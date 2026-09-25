/**
 * Why an inventory write did nothing (spec §5.3).
 *
 * One vocabulary for every write under the tool editor, so the panel has one
 * set of messages to render and the codes cannot drift table by table. Each one
 * is a *refusal*: the statement ran or was never sent, and nothing changed.
 * A database failure is not in here — that throws, because the caller has to
 * tell the difference between "we declined" and "we do not know".
 *
 * - `conflict` — the row moved since the panel read it (§5.3(4)). The one code
 *   the editor answers with an offer to reload rather than an apology.
 * - `not_found` — no such row, or not one belonging to the tool being edited.
 *   The two are deliberately the same answer: a unit id from another tool is
 *   not a thing this tool has.
 * - `invalid_field` — a value outside its vocabulary, an empty name, a date
 *   that is not a date. Refused here rather than handed to Postgres, whose
 *   CHECK constraint rejects the whole statement with a message no page can
 *   render.
 * - `duplicate_serial` — `units_tool_serial_key`, the "is this a second unit?"
 *   index (§4.5), surfaced as a named refusal instead of a raw constraint error.
 * - `unit_has_history` — the unit has maintenance logs, so it is retired, never
 *   deleted (§5.3 "Deleting").
 * - `not_editable` — a pending tool has moved on to a state this write does not
 *   apply to: researching, approved or discarded (§5.4). Not a conflict — there
 *   is no newer version of the same edit to reload, the item is simply past it.
 * - `low_confidence` — research could not confirm the item, and approval needs
 *   the person's "I've checked this" and a note first (§5.4 step 12).
 * - `duplicate_name` — another tool already has that display name, compared
 *   case- and punctuation-insensitively (display names amendment 2026-09-25).
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */
export const WRITE_REFUSALS = [
  "conflict",
  "not_found",
  "invalid_field",
  "duplicate_serial",
  "unit_has_history",
  "not_editable",
  "low_confidence",
  "duplicate_name",
] as const;

export type WriteRefusal = (typeof WRITE_REFUSALS)[number];

/** A write that declined, with the reason. Never thrown — always returned. */
export interface Refused<R extends WriteRefusal = WriteRefusal> {
  ok: false;
  reason: R;
}
