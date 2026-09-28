import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, notionPageId, timestamps, userReference } from "./helpers.ts";
import { CATEGORY_PROPOSAL_KIND, CATEGORY_PROPOSAL_SOURCE, CATEGORY_PROPOSAL_STATUS } from "./vocabulary.ts";

/**
 * Categories and locations (data platform design spec 2026-09-14 §4.3).
 *
 * `categories` is unique on `(lower(name), lower(coalesce(group, '')),
 * parent_id)`, not on the name alone: the live workspace had three
 * case-insensitive name collisions across different groups, and a name-only
 * constraint would refuse the import.
 *
 * **Taxonomy v2** (spec 2026-09-28, migration `0022`): a two-level tree.
 *
 * - `slug` — stable, unique, what research answers with and what matching
 *   compares (exactly). A row inserted without one gets one from its name
 *   (and group) by the `categories_default_slug` trigger, so the Notion
 *   import and older code keep working.
 * - `parent_id` — the top-level category a second-level one sits under; it
 *   replaces the free-text `group` for new data. `group` is still read while
 *   old rows exist (`categoryPath` in `lib/taxonomy/path.ts`).
 * - `description` — what belongs and what does not, shown to research and on
 *   `/admin/taxonomy`.
 * - `retired_at` / `merged_into_id` — a category is never deleted: tools and
 *   proposals point at it. A merged one names where its tools went.
 * - `gallery_hidden` — set on a top-level category the public gallery leaves
 *   out by default (Shop Infrastructure & Supplies); children inherit it.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    group: text("group"),
    slug: text("slug").notNull().default(""),
    description: text("description"),
    parentId: uuid("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    galleryHidden: boolean("gallery_hidden").notNull().default(false),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("categories_name_group_parent_key").on(
      sql`lower(${t.name})`,
      sql`lower(coalesce(${t.group}, ''))`,
      sql`coalesce(${t.parentId}::text, '')`
    ),
    uniqueIndex("categories_slug_key").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "categories_parent_id_fk" }).onDelete("set null"),
    foreignKey({ columns: [t.mergedIntoId], foreignColumns: [t.id], name: "categories_merged_into_id_fk" }).onDelete("set null"),
  ]
);

/**
 * `category_proposals` — a category somebody (research, refresh, the
 * assistant, an MCP client or the consolidation audit) thinks the lab should
 * have or should reconsider, waiting for a person holding `taxonomy.manage`
 * (taxonomy v2 spec §4). **Nothing creates a category but accepting one of
 * these** (or the one-off `taxonomy:migrate`).
 *
 * - `kind` — `new_category` (create `name` under `parent_id`) or
 *   `review_category` (the audit's flag on an existing category, `subject`).
 * - `subject_type` / `subject_id` — what prompted it: the tool research
 *   approved into its best existing category (accepting moves it into the new
 *   one), or the category the audit flagged. Text, not a foreign key, like
 *   `action_proposals.subject_id`.
 * - `nearest_existing_id` — research's best existing slug, resolved; the
 *   queue's default "merge into" target.
 * - `flag` — the audit's reason code (`sparse`, `crowded`, `duplicate_name`),
 *   which with the subject keeps a re-run from writing the same proposal twice.
 * - `resulting_category_id` — the category an accept created, or a merge chose.
 */
export const categoryProposals = pgTable(
  "category_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("new_category"),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
    description: text("description"),
    reason: text("reason"),
    source: text("source").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    flag: text("flag"),
    nearestExistingId: uuid("nearest_existing_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    resultingCategoryId: uuid("resulting_category_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
    decidedBy: userReference("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("category_proposals_kind_check", "kind", CATEGORY_PROPOSAL_KIND),
    inListCheck("category_proposals_source_check", "source", CATEGORY_PROPOSAL_SOURCE),
    inListCheck("category_proposals_status_check", "status", CATEGORY_PROPOSAL_STATUS),
    index("category_proposals_status_idx").on(t.status),
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
