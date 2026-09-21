import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { actorColumns, notionPageId, timestamps } from "./helpers.ts";

/**
 * Categories and locations (data platform design spec 2026-09-14 §4.3).
 *
 * `categories` is unique on `(lower(name), lower(coalesce(group, '')))`, not on
 * the name alone: the live workspace has three case-insensitive name collisions
 * across different groups, and a name-only constraint would refuse the import.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    group: text("group"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("categories_name_group_key").on(
      sql`lower(${t.name})`,
      sql`lower(coalesce(${t.group}, ''))`
    ),
  ]
);

/**
 * `map_tag` is the printed label on the floor map (Notion's location title,
 * e.g. `ML-RESIN-01`). Unique when present; Postgres lets several rows hold
 * null, so no partial index is needed.
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    room: text("room").notNull(),
    zone: text("zone").notNull(),
    mapTag: text("map_tag").unique(),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("locations_room_zone_key").on(sql`lower(${t.room})`, sql`lower(${t.zone})`)]
);
