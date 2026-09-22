import type { AdminActionWarning } from "../admin/action-result";
import type { Revision } from "../data/revision";
import type { WriteRefusal } from "../data/write-result";

/**
 * What an inventory write answers (spec §5.3).
 *
 * `src/lib/inventory/` is the layer between the data modules and the server
 * actions Phase 5 part 2 adds. It exists because the two things every write has
 * to do besides writing — bust the cache, and record the security-relevant ones
 * — cannot live in `src/lib/data/`: those modules are loaded by `scripts/`
 * under plain Node, where `next/cache` does not exist.
 *
 * This module has no directive, so a client island can import the result shape
 * without dragging `server-only`, the database and `next/cache` into its graph.
 */

/**
 * Why a write did nothing.
 *
 * `error` here, `reason` in `src/lib/data/` — the same set of codes, renamed
 * once at this boundary on purpose. Below, a refusal is a fact about a
 * statement; here it is a string the panel looks up as `admin.errors.<code>`
 * and shows to a person. `failed` is this layer's own: the data layer throws on
 * a database failure, and an action may not.
 */
export type InventoryWriteError = WriteRefusal | "failed";

/**
 * A change that landed with less than the full guarantee behind it.
 *
 * - `audit_unavailable` — the row changed and `audit_events` did not record it
 *   (§4.11), shared with every admin surface.
 * - `photos_not_attached` — the write landed and some of its photos did not.
 *   A claim only takes *unowned* rows and the daily cron sweeps uploads after
 *   24 hours, so a panel left open overnight submits ids nobody can claim any
 *   more. The counts are in the result too; this is the code that makes them
 *   hard to ignore.
 * - `files_not_attached` — the same failure, one section over: a resource's
 *   PDF. It is a **second code rather than the photo one reused**, because the
 *   codes are message keys and the message is the whole point of raising one.
 *   "Some photos did not attach" told about a manual is a sentence that sends
 *   somebody looking through the Photos section for a file that was never
 *   there — a small lie, and the kind Article 4 is about.
 *
 * All of them ride on `ok: true`, because in every case the change is in the
 * database.
 */
export type InventoryWriteWarning =
  | AdminActionWarning
  | "photos_not_attached"
  | "files_not_attached";

/**
 * The shape every write answers with.
 *
 * **A success always carries a revision**, because the panel stays open: the
 * token it handed in is spent, and without the new one its next save would
 * report a conflict against itself. `T` is whatever else the particular write
 * has to say — the id of a unit it created, how many photos actually attached.
 */
export type InventoryWriteResult<T = unknown> =
  | ({ ok: true; revision: Revision; warning?: InventoryWriteWarning } & T)
  | { ok: false; error: InventoryWriteError };
