import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PhotoOption } from "../../photo-options/types.ts";
import { inListCheck, timestamps, userReference } from "./helpers.ts";
import { tools } from "./tools.ts";
import { PHOTO_SEARCH_STATUS } from "./vocabulary.ts";

/**
 * **Photo options** for a catalogue tool (photo options spec 2026-10-29;
 * migration `0036`).
 *
 * One row per press of **Find photo options**: the search runs in the
 * background (`src/workflows/photo-options.ts`) and writes the ranked
 * pictures it found into `options` — URLs and what the ranking said about
 * each, never bytes. Nothing is downloaded or stored until an admin picks one;
 * the pick is recorded in `chosen_url` and the picture becomes the tool's
 * cover through the editor's own photo write.
 *
 * The latest row is what the editor shows; older rows are history (and the
 * pictures a "Find more" leaves out). At most one `searching` row per tool:
 * the partial unique index. Deleting the tool cascades.
 *
 * Relative imports with `.ts` extensions: the workflow's steps load the schema
 * under plain Node.
 */
export const toolPhotoSearches = pgTable(
  "tool_photo_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("searching"),
    /** The admin's note for the search ("the white-background shot from the maker's site"), cleaned and capped. */
    note: text("note"),
    options: jsonb("options").$type<PhotoOption[]>().notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    requestedBy: userReference("requested_by"),
    /** The picture an admin made the cover from these options, by its URL. */
    chosenUrl: text("chosen_url"),
    chosenBy: userReference("chosen_by"),
    chosenAt: timestamp("chosen_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    inListCheck("tool_photo_searches_status_check", "status", PHOTO_SEARCH_STATUS),
    uniqueIndex("tool_photo_searches_one_running_idx")
      .on(t.toolId)
      .where(sql`${t.status} = 'searching'`),
    index("tool_photo_searches_tool_idx").on(t.toolId, t.createdAt),
  ]
);
