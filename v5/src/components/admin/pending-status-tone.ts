import type { StatusTone } from "../system/StatusGlyph";
import type { PendingStatus } from "../../lib/intake/types";

/**
 * A pending item's status as a glyph tone (DESIGN.md §8.5), shared by the
 * intake queue, the chat's intake table and the import review: nothing is
 * running yet or it is running (○), it is waiting on *you* (◆), it failed (■),
 * it made it (●), it left (–).
 */
export const PENDING_STATUS_TONE: Record<PendingStatus, StatusTone> = {
  identified: "idle",
  queued: "idle",
  researching: "idle",
  researched: "active",
  failed: "bad",
  approved: "ok",
  discarded: "muted",
};
