import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorColumns, notionPageId, timestamps, userReference } from "./helpers.ts";
import { categories, locations } from "./taxonomy.ts";

/**
 * Tools (data platform design spec 2026-09-14 §4.4).
 *
 * - `slug` is derived from the name once, at creation, and never changes on a
 *   rename, so `/tools/<slug>` links stay valid.
 * - `notion_page_id` keeps the legacy URL key: printed QR labels and old links
 *   of the form `/tools/<notion-page-id>` redirect through it (spec Goal 2).
 * - Tools are archived (`archived_at`), never deleted, because maintenance
 *   history refers to them.
 * - The trigram index backs the duplicate check when equipment is added.
 */
export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    materials: text("materials").array().notNull().default(sql`'{}'::text[]`),
    ppeRequired: text("ppe_required").array().notNull().default(sql`'{}'::text[]`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    trainingRequired: boolean("training_required").notNull().default(false),
    useRestrictions: text("use_restrictions"),
    emergencyStop: text("emergency_stop"),
    notes: text("notes"),
    published: boolean("published").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    lastReviewedBy: userReference("last_reviewed_by"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    index("tools_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("tools_category_idx").on(t.categoryId),
    index("tools_location_idx").on(t.locationId),
  ]
);
